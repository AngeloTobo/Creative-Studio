// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

// The Local Runner is intentionally plain ESM so Windows can launch it directly with Node.
// @ts-expect-error TypeScript does not emit declarations for the runtime-only runner module.
import { executeOvernightPlanBundle, executePromptEnhancementBundle, executeVideoScriptDraftBundle } from "../../runner/index.mjs";

const config = {
  apiBase: "https://runner.example.test",
  token: `csr_${"a".repeat(43)}`,
  comfyUrl: "http://127.0.0.1:8188",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const overnightSlots = [1, 2, 3].map((ordinal) => ({
  ordinal,
  storyIndex: 1,
  role: "scene-image",
  modality: "image",
}));

const overnightBundle = {
  session: {
    id: "overnight_cleanup_test",
    storySeed: "A glass organism follows a signal through three nocturnal rooms.",
    storyCount: 1,
    outputCount: 3,
    exploration: "exploratory",
    workflowSelections: [{ modality: "image", targetModel: "Local image model" }],
  },
  slots: overnightSlots,
  context: { project: null, creativeDna: null, world: null },
};

const overnightOutput = JSON.stringify({
  schemaVersion: "creative-studio-overnight-plan/1.0",
  title: "Signal Rooms",
  logline: "A glass organism follows one changing signal through a sequence of tactile nocturnal spaces.",
  stories: [{
    index: 1,
    title: "Signal Rooms",
    premise: "A glass organism crosses three rooms while the light it follows changes material and intent.",
  }],
  outputs: overnightSlots.map((slot) => ({
    ordinal: slot.ordinal,
    storyIndex: slot.storyIndex,
    sceneIndex: slot.ordinal,
    title: `Signal room ${slot.ordinal}`,
    role: slot.role,
    modality: slot.modality,
    prompt: `A translucent organism enters nocturnal room ${slot.ordinal}, following a narrow cyan signal through tactile glass surfaces and controlled shadow.`,
  })),
});

const cases = [
  {
    name: "video prompt enhancement",
    completePath: "/api/creative-studio/runner/prompt-enhancements/promptenh_cleanup_test/complete",
    releaseReason: "video prompt enhancement promptenh_cleanup_test",
    output: "A translucent figure turns toward a moving cyan reflection while the camera drifts closer and the room settles into a clear final silhouette.",
    run: (options: Record<string, unknown>) => executePromptEnhancementBundle(config, {
      promptEnhancement: {
        id: "promptenh_cleanup_test",
        sourcePrompt: "A glass figure follows a signal",
        inputMode: "text-to-video",
        videoDurationSeconds: 5,
        promptProfileId: "ltx-2.5-motion/1.0",
        outputFormat: "natural-language",
        targetModel: "LTX 2.5",
      },
      source: null,
    }, options),
  },
  {
    name: "video script generation",
    completePath: "/api/creative-studio/runner/video-scripts/videoscript_cleanup_test/complete",
    releaseReason: "video script generation videoscript_cleanup_test",
    output: JSON.stringify({
      schemaVersion: "creative-studio-video-script-output/1.0",
      spokenText: "We kept the quiet signal alive through midnight.",
    }),
    run: (options: Record<string, unknown>) => executeVideoScriptDraftBundle(config, {
      videoScriptDraft: {
        id: "videoscript_cleanup_test",
        scriptFormat: "dialogue-v1",
        mode: "build",
        seedPhrases: ["Keep the signal alive"],
        sourceScript: "",
        sceneDirection: "",
        videoDurationSeconds: 10,
        inputMode: "text-to-video",
      },
      source: null,
    }, options),
  },
  {
    name: "overnight planning",
    completePath: "/api/creative-studio/runner/overnight/overnight_cleanup_test/complete",
    releaseReason: "overnight planning overnight_cleanup_test",
    output: overnightOutput,
    run: (options: Record<string, unknown>) => executeOvernightPlanBundle(config, overnightBundle, options),
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Local Runner standalone Gemma cleanup", () => {
  it.each(cases)("releases models only after $name is durably completed", async ({ completePath, releaseReason, output, run }) => {
    const promptId = `comfy-${releaseReason.replace(/[^a-z0-9]+/gi, "-")}`;
    const events: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === `${config.comfyUrl}/prompt`) return json({ prompt_id: promptId });
      if (url === `${config.comfyUrl}/history/${encodeURIComponent(promptId)}`) {
        return json({ [promptId]: { outputs: { "4": { text: [output] } } } });
      }
      if (url === `${config.apiBase}${completePath}`) {
        events.push("complete");
        return json({ ok: true });
      }
      if (url.startsWith(config.apiBase) && url.endsWith("/fail")) {
        events.push("fail");
        return json({ ok: true });
      }
      if (url.startsWith(config.apiBase)) return json({ ok: true, continue: true });
      throw new Error(`unexpected_fetch:${url}`);
    }));

    await run({
      freeMemory: async (_config: unknown, reason: string) => {
        events.push("free");
        expect(reason).toBe(releaseReason);
        return { released: false, status: 503, attempts: 2, error: "comfyui_free_503" };
      },
      machineHeartbeat: async () => undefined,
    });

    expect(events).toEqual(["complete", "free"]);
  });
});
