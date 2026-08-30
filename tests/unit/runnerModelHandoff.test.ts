// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

// The Local Runner is intentionally plain ESM so Windows can launch it directly with Node.
// @ts-expect-error TypeScript does not emit declarations for the runtime-only runner module.
import { createComfyModelResidencyState, enhanceSongPrompt, freeComfyMemory, generationModelResidencyProfile, prepareAceStepDataset, prepareGemmaModelHandoff, prepareGenerationGpuHandoff, prepareGenerationModelHandoff, recordGenerationModelResidency } from "../../runner/index.mjs";

const config = {
  apiBase: "https://runner.example.test",
  token: `csr_${"a".repeat(43)}`,
  comfyUrl: "http://127.0.0.1:8188",
};

function bundle(name: string, models: string[], classType: string, upstreamId: string | null = null) {
  return {
    job: {
      id: `job-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      modality: "video",
      upstreamId,
      settingsStamp: { models, workloadEvidence: { label: name } },
    },
    workflow: {
      name,
      description: `${name} production workflow`,
      sourceFileName: `${name}.json`,
      modality: "video",
      currentRevision: { models },
    },
    graph: { "1": { class_type: classType, inputs: {} } },
  };
}

const h3 = bundle("MiniMax H3 I2V", ["minimax_h3_i2v_pruned_int8.safetensors"], "MinimaxH3ImageToVideo");
const ltx = bundle("LTX 2.5 I2V", ["ltx-2.5-22b-dev-fp8.safetensors"], "LTXVImgToVideoInplace");
const idle = { state: "idle", runningCount: 0, pendingCount: 0, queue: { queue_running: [], queue_pending: [] }, error: null };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Local Runner Comfy model-family residency", () => {
  it("classifies H3 and LTX from model and workflow identity without exposing raw paths in the signature", () => {
    const h3Profile = generationModelResidencyProfile(h3);
    const ltxProfile = generationModelResidencyProfile(ltx);

    expect(h3Profile).toMatchObject({ family: "minimax-h3", highVram: true });
    expect(ltxProfile).toMatchObject({ family: "ltx", highVram: true });
    expect(h3Profile.signature).toMatch(/^[a-f0-9]{16}$/);
    expect(ltxProfile.signature).toMatch(/^[a-f0-9]{16}$/);
    expect(h3Profile.signature).not.toContain("minimax");
  });

  it("keeps an exact consecutive family and model signature warm", async () => {
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(ltx));
    const freeMemory = vi.fn();
    const observeQueue = vi.fn();
    const output: string[] = [];

    const result = await prepareGenerationModelHandoff(config, ltx, {
      modelResidencyState: state,
      freeMemory,
      observeQueue,
      stdout: { write: (value: string) => output.push(value) },
    });

    expect(result.action).toBe("warm");
    expect(freeMemory).not.toHaveBeenCalled();
    expect(observeQueue).not.toHaveBeenCalled();
    expect(output.join(" ")).toContain("reusing warm ltx model set");
  });

  it("unloads external LM Studio before reusing a warm LTX model", async () => {
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(ltx));
    const ensureLmStudioUnloaded = vi.fn(async () => ({ verified: true, unloadedCount: 1 }));
    const freeMemory = vi.fn();

    await expect(prepareGenerationGpuHandoff(config, ltx, {
      modelResidencyState: state,
      ensureLmStudioUnloaded,
      freeMemory,
      stdout: { write: () => undefined },
    })).resolves.toMatchObject({ action: "warm", profile: { family: "ltx" } });

    expect(ensureLmStudioUnloaded).toHaveBeenCalledOnce();
    expect(freeMemory).not.toHaveBeenCalled();
  });

  it("proves idle, frees warm LTX, and proves idle again before standalone Gemma", async () => {
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(ltx));
    const events: string[] = [];
    const ensureLmStudioUnloaded = vi.fn(async () => {
      events.push("lm-studio-empty");
      return { verified: true, unloadedCount: 0 };
    });
    const observeQueue = vi.fn(async () => {
      events.push("comfy-idle");
      return idle;
    });
    const freeMemory = vi.fn(async () => {
      events.push("comfy-free");
      return { released: true, status: 200 };
    });

    await expect(prepareGemmaModelHandoff(config, "promptenh-test", {
      modelResidencyState: state,
      ensureLmStudioUnloaded,
      observeQueue,
      freeMemory,
      stdout: { write: () => undefined },
    })).resolves.toMatchObject({
      action: "released",
      profile: { family: "gemma4", highVram: true },
      previous: { family: "ltx" },
    });

    expect(events).toEqual(["lm-studio-empty", "comfy-idle", "comfy-free", "comfy-idle"]);
  });

  it("never submits standalone Gemma when the warm LTX release is unconfirmed", async () => {
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(ltx));
    const freeMemory = vi.fn(async () => ({ released: false, error: "comfyui_free_failed" }));

    await expect(prepareGemmaModelHandoff(config, "promptenh-blocked", {
      modelResidencyState: state,
      ensureLmStudioUnloaded: async () => ({ verified: true }),
      observeQueue: async () => idle,
      freeMemory,
      stdout: { write: () => undefined },
    })).rejects.toThrow("comfyui_model_handoff_unconfirmed");
  });

  it("releases and verifies Comfy before switching H3 to LTX, then permits warm LTX reuse", async () => {
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(h3));
    const freeMemory = vi.fn(async (receivedConfig: typeof config, reason: string) => {
      void receivedConfig;
      void reason;
      return { released: true, status: 200, attempts: 1, error: null };
    });
    const observeQueue = vi.fn(async () => idle);
    const output: string[] = [];

    const handoff = await prepareGenerationModelHandoff(config, ltx, {
      modelResidencyState: state,
      freeMemory,
      observeQueue,
      stdout: { write: (value: string) => output.push(value) },
    });

    expect(handoff.action).toBe("released");
    expect(observeQueue).toHaveBeenCalledTimes(2);
    expect(freeMemory).toHaveBeenCalledOnce();
    expect(freeMemory.mock.calls[0]?.[1]).toContain("model handoff minimax-h3 to ltx");
    expect(state).toEqual({ status: "empty", family: null, signature: null, highVram: null });
    expect(output.join(" ")).toContain("verified ComfyUI model handoff minimax-h3 -> ltx");

    recordGenerationModelResidency(state, handoff.profile);
    await expect(prepareGenerationModelHandoff(config, ltx, {
      modelResidencyState: state,
      freeMemory,
      observeQueue,
      stdout: { write: () => undefined },
    })).resolves.toMatchObject({ action: "warm" });
    expect(freeMemory).toHaveBeenCalledOnce();
  });

  it("releases when the same family changes its heavyweight model signature", async () => {
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(ltx));
    const alternateLtx = bundle("LTX 2.5 I2V", ["ltx-2.5-22b-distilled-fp8.safetensors"], "LTXVImgToVideoInplace");
    const freeMemory = vi.fn(async () => ({ released: true, status: 200 }));

    await expect(prepareGenerationModelHandoff(config, alternateLtx, {
      modelResidencyState: state,
      freeMemory,
      observeQueue: async () => idle,
      stdout: { write: () => undefined },
    })).resolves.toMatchObject({ action: "released" });
    expect(freeMemory).toHaveBeenCalledOnce();
  });

  it("requires a verified cleanup on runner restart before the first known high-VRAM prompt", async () => {
    const state = createComfyModelResidencyState();
    const freeMemory = vi.fn(async () => ({ released: true, status: 200 }));
    const observeQueue = vi.fn(async () => idle);

    await expect(prepareGenerationModelHandoff(config, ltx, {
      modelResidencyState: state,
      freeMemory,
      observeQueue,
      stdout: { write: () => undefined },
    })).resolves.toMatchObject({ action: "released", previous: { status: "unknown" } });
    expect(observeQueue).toHaveBeenCalledTimes(2);
    expect(freeMemory).toHaveBeenCalledOnce();
  });

  it("stops before submission when a known switch cannot release stale residency", async () => {
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(h3));
    const freeMemory = vi.fn(async () => ({ released: false, status: null, attempts: 2, error: "comfyui_free_failed" }));

    await expect(prepareGenerationModelHandoff(config, ltx, {
      modelResidencyState: state,
      freeMemory,
      observeQueue: async () => idle,
      stdout: { write: () => undefined },
    })).rejects.toThrow("comfyui_model_handoff_unconfirmed:release_minimax-h3_to_ltx:comfyui_free_failed");
    expect(state).toEqual({ status: "unknown", family: null, signature: null, highVram: null });
  });

  it("does not unload while a Comfy prompt is running and retries queue proof within a bound", async () => {
    const state = createComfyModelResidencyState();
    const freeMemory = vi.fn();
    const observeQueue = vi.fn(async () => ({
      state: "busy", runningCount: 1, pendingCount: 0, error: null,
    }));

    await expect(prepareGenerationModelHandoff(config, h3, {
      modelResidencyState: state,
      freeMemory,
      observeQueue,
      queueAttempts: 2,
      queueRetryMs: 0,
      stdout: { write: () => undefined },
    })).rejects.toThrow("comfyui_model_handoff_unconfirmed:before_release:busy_running_1_pending_0");
    expect(observeQueue).toHaveBeenCalledTimes(2);
    expect(freeMemory).not.toHaveBeenCalled();
  });

  it("returns residency to unknown when post-release queue verification fails", async () => {
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(h3));
    const observations = [idle, { state: "invalid", error: "comfyui_queue_invalid" }];
    const freeMemory = vi.fn(async () => ({ released: true, status: 200 }));

    await expect(prepareGenerationModelHandoff(config, ltx, {
      modelResidencyState: state,
      freeMemory,
      observeQueue: async () => observations.shift(),
      queueAttempts: 1,
      stdout: { write: () => undefined },
    })).rejects.toThrow("comfyui_model_handoff_unconfirmed:after_release:comfyui_queue_invalid");

    expect(freeMemory).toHaveBeenCalledOnce();
    expect(state).toEqual({ status: "unknown", family: null, signature: null, highVram: null });
  });

  it("does not unload a resumed durable prompt whose upstream ID already exists", async () => {
    const resumed = bundle("LTX 2.5 I2V", ["ltx-2.5-22b-dev-fp8.safetensors"], "LTXVImgToVideoInplace", "prompt-existing");
    const freeMemory = vi.fn();
    const observeQueue = vi.fn();

    await expect(prepareGenerationModelHandoff(config, resumed, {
      modelResidencyState: createComfyModelResidencyState(),
      freeMemory,
      observeQueue,
      stdout: { write: () => undefined },
    })).resolves.toMatchObject({ action: "resume" });
    expect(freeMemory).not.toHaveBeenCalled();
    expect(observeQueue).not.toHaveBeenCalled();
  });

  it("invalidates remembered residency whenever an existing Comfy /free succeeds", async () => {
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(ltx));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    await expect(freeComfyMemory(config, "Gemma handoff", {
      attempts: 1,
      settleMs: 0,
      modelResidencyState: state,
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
    })).resolves.toMatchObject({ released: true, status: 200 });

    expect(state).toEqual({ status: "empty", family: null, signature: null, highVram: null });
    const redundantFree = vi.fn();
    await expect(prepareGenerationModelHandoff(config, ltx, {
      modelResidencyState: state,
      freeMemory: redundantFree,
      observeQueue: vi.fn(),
      stdout: { write: () => undefined },
    })).resolves.toMatchObject({ action: "cold" });
    expect(redundantFree).not.toHaveBeenCalled();
  });

  it("leaves residency unknown when an existing Comfy /free cannot be confirmed", async () => {
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(ltx));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    await expect(freeComfyMemory(config, "Gemma handoff", {
      attempts: 1,
      retryDelayMs: 0,
      settleMs: 0,
      modelResidencyState: state,
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
    })).resolves.toMatchObject({ released: false, status: 503 });

    expect(state).toEqual({ status: "unknown", family: null, signature: null, highVram: null });
  });

  it("releases inline Gemma song enhancement before the target music model can be treated as warm", async () => {
    const musicBundle = {
      job: {
        id: "job-inline-song-gemma",
        modality: "music",
        prompt: "Warm percussion moves through a rain-dark room",
        settingsStamp: {
          prompt: "Warm percussion moves through a rain-dark room",
          models: ["stable_audio_3_medium.safetensors"],
        },
      },
      workflow: {
        name: "Stable Audio 3 Medium",
        description: "Stable Audio music generation",
        sourceFileName: "audio_stable_audio_3_medium.json",
        modality: "music",
        currentRevision: { models: ["stable_audio_3_medium.safetensors"] },
      },
      graph: {},
    };
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(musicBundle));
    const promptId = "prompt-inline-song-gemma";
    const enhanced = "Warm analog percussion and tactile bass move steadily beneath glassy keys, widening into a rain-softened stereo field before resolving with one intimate metallic pulse.";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === `${config.comfyUrl}/prompt`) return new Response(JSON.stringify({ prompt_id: promptId }), { status: 200 });
      if (url === `${config.comfyUrl}/history/${promptId}`) {
        return new Response(JSON.stringify({ [promptId]: { outputs: { "4": { text: [enhanced] } } } }), { status: 200 });
      }
      if (url.startsWith(config.apiBase)) {
        return new Response(JSON.stringify({ ok: true, continue: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected_fetch:${url}`);
    }));
    const freeMemory = vi.fn(async () => ({ released: true, status: 200 }));

    await expect(enhanceSongPrompt(config, musicBundle, { id: "music::prompt" }, "", {
      modelResidencyState: state,
      freeMemory,
      ensureLmStudioUnloaded: async () => ({ verified: true }),
      observeQueue: async () => idle,
    })).resolves.toMatchObject({ enhancedPrompt: enhanced, comfyPromptId: promptId });

    expect(freeMemory).toHaveBeenCalledTimes(2);
    expect(freeMemory).toHaveBeenCalledWith(config, "model handoff stable-audio to gemma4", undefined);
    expect(freeMemory).toHaveBeenCalledWith(config, `song prompt enhancement ${musicBundle.job.id}`, undefined);
    expect(state).toEqual({ status: "empty", family: null, signature: null, highVram: null });
  });

  it("releases Gemma after ACE-Step dataset captions are durably registered", async () => {
    const state = createComfyModelResidencyState();
    recordGenerationModelResidency(state, generationModelResidencyProfile(ltx));
    const promptId = "prompt-ace-caption-cleanup";
    const events: string[] = [];
    const caption = "Measured electronic percussion supports a tactile bass pulse while processed keys widen gradually, then contract around one bright metallic accent and a quiet final decay.";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/creative-studio/runner/media/asset-audio")) {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "audio/mpeg", "content-disposition": "attachment; filename*=UTF-8''test.mp3" },
        });
      }
      if (url === `${config.comfyUrl}/upload/image`) {
        return new Response(JSON.stringify({ name: "test.mp3", subfolder: "" }), { status: 200 });
      }
      if (url === `${config.comfyUrl}/prompt`) return new Response(JSON.stringify({ prompt_id: promptId }), { status: 200 });
      if (url === `${config.comfyUrl}/history/${promptId}`) {
        return new Response(JSON.stringify({ [promptId]: { outputs: { "4": { text: [caption] } } } }), { status: 200 });
      }
      if (url.endsWith("/api/creative-studio/runner/model-training/train-ace-cleanup/dataset")) {
        events.push("dataset");
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith(config.apiBase)) {
        return new Response(JSON.stringify({ ok: true, continue: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected_fetch:${url}`);
    }));
    const freeMemory = vi.fn(async () => {
      events.push("free");
      return { released: true, status: 200 };
    });

    await prepareAceStepDataset(config, {
      modelTrainingJob: { id: "train-ace-cleanup", instrumental: true },
      assets: [{ id: "asset-audio", name: "Test track", originalFileName: "test.mp3" }],
    }, {
      modelResidencyState: state,
      freeMemory,
      ensureLmStudioUnloaded: async () => ({ verified: true }),
      observeQueue: async () => idle,
    });

    expect(events).toEqual(["free", "dataset", "free"]);
    expect(freeMemory).toHaveBeenCalledWith(config, "model handoff ltx to gemma4", undefined);
    expect(freeMemory).toHaveBeenCalledWith(config, "ACE-Step dataset captioning train-ace-cleanup", undefined);
    expect(state).toEqual({ status: "empty", family: null, signature: null, highVram: null });
  });
});
