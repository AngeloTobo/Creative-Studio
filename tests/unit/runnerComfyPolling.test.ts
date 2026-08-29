// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

// The Local Runner is intentionally plain ESM so Windows can launch it directly with Node.
// @ts-expect-error TypeScript does not emit declarations for the runtime-only runner module.
import { assertPromptSchedulesMediaOutput, cancelAndDrainComfyPrompt, EXPLICIT_HEAVY_VIDEO_EXECUTION_TIMEOUT_MS, freeComfyMemory, generationExecutionTimeoutMs, observeComfyPrompt, STANDARD_MEDIA_EXECUTION_TIMEOUT_MS, STANDARD_VIDEO_EXECUTION_TIMEOUT_MS, waitForComfyPromptDrain, waitForOutput } from "../../runner/index.mjs";

const promptId = "prompt-ltx-observation-001";
const graph = { "75": { class_type: "SaveVideo", inputs: { video: ["74", 0] } } };
const config = {
  apiBase: "https://runner.example.test",
  token: `csr_${"a".repeat(43)}`,
  comfyUrl: "http://127.0.0.1:8188",
};
const bundle = { job: { id: "job-ltx-observation-001", modality: "video" }, graph };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function saveVideoHistory(filename = "CreativeStudio/LTX/output.mp4") {
  return {
    prompt: [1, promptId, graph, {}, ["75"]],
    outputs: { "75": { videos: [{ filename, subfolder: "", type: "output" }] } },
    status: { completed: true, status_str: "success", messages: [["execution_success", {}]] },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Local Runner Comfy prompt observation", () => {
  it("fails a scheduling assertion when a responsive Comfy API never exposes the prompt", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/queue")) return json({ queue_running: [], queue_pending: [] });
      if (url.includes("/history/")) return json({});
      throw new Error(`unexpected_fetch:${url}`);
    }));
    let clock = 0;

    await expect(assertPromptSchedulesMediaOutput(config, promptId, graph, "video", {
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
      pollIntervalMs: 100,
      absentGraceMs: 200,
      unreachableGraceMs: 500,
      timeoutMs: 1,
    })).rejects.toThrow("comfyui_prompt_not_observable");
  });

  it("keeps repeated Comfy API timeouts distinct from a missing prompt and never invents progress", async () => {
    let clock = 0;
    const heartbeats: Array<Record<string, unknown>> = [];
    const cancelled: string[] = [];
    const drained: string[] = [];
    const releases: string[] = [];
    const lastObserved = "2026-08-29T07:27:05.743Z";

    await expect(waitForOutput(config, bundle, promptId, {
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
      observe: async () => ({ state: "unreachable", observedAt: null, entry: null, error: "comfyui_api_unreachable" }),
      heartbeat: async (payload: Record<string, unknown>) => { heartbeats.push(payload); },
      heartbeatIntervalMs: 100,
      pollIntervalMs: 100,
      executionTimeoutMs: 250,
      initialObservationAt: lastObserved,
      cancelPrompt: async (_config: unknown, cancelledPromptId: string) => { cancelled.push(cancelledPromptId); },
      drainPrompt: async (_config: unknown, drainedPromptId: string) => {
        drained.push(drainedPromptId);
        return { promptId: drainedPromptId, drainedAt: "2026-08-29T07:28:00.000Z" };
      },
      freeMemory: async (_config: unknown, reason: string) => {
        releases.push(reason);
        return { released: true };
      },
    })).rejects.toThrow("comfyui_execution_timed_out");

    expect(heartbeats.length).toBeGreaterThan(1);
    expect(heartbeats).toEqual(heartbeats.map(() => ({
      progress: 8,
      stage: "rendering",
      comfyObservationAt: lastObserved,
    })));
    expect(cancelled).toEqual([promptId]);
    expect(drained).toEqual([promptId]);
    expect(releases).toEqual([`watchdog timeout for ${bundle.job.id}`]);
  });

  it("recovers after API timeouts and advances the successful observation timestamp", async () => {
    let clock = 0;
    const heartbeats: Array<Record<string, unknown>> = [];
    const states = [
      { state: "unreachable", observedAt: null, entry: null, error: "comfyui_api_unreachable" },
      { state: "queue", observedAt: "2026-08-29T08:00:01.000Z", entry: null, error: null },
      { state: "history", observedAt: "2026-08-29T08:00:02.000Z", entry: saveVideoHistory(), error: null },
    ];

    const output = await waitForOutput(config, bundle, promptId, {
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
      observe: async () => states.shift(),
      heartbeat: async (payload: Record<string, unknown>) => { heartbeats.push(payload); },
      heartbeatIntervalMs: 100,
      pollIntervalMs: 100,
      executionTimeoutMs: 1_000,
      initialObservationAt: "2026-08-29T08:00:00.000Z",
    });

    expect(output).toMatchObject({ filename: "CreativeStudio/LTX/output.mp4", nodeId: "75" });
    expect(heartbeats.at(-1)).toMatchObject({
      progress: 8,
      stage: "rendering",
      comfyObservationAt: "2026-08-29T08:00:01.000Z",
    });
  });

  it("hands an initially unreachable scheduling check to the durable render observer", async () => {
    let clock = 0;
    const initial = await assertPromptSchedulesMediaOutput(config, promptId, graph, "video", {
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
      pollIntervalMs: 100,
      observe: async () => ({ state: "unreachable", observedAt: null, entry: null, error: "comfyui_api_unreachable" }),
    });
    expect(initial).toMatchObject({ state: "unreachable", observedAt: null });

    const states = [
      { state: "queue", observedAt: "2026-08-29T08:05:01.000Z", entry: null, error: null },
      { state: "history", observedAt: "2026-08-29T08:05:02.000Z", entry: saveVideoHistory("video/recovered.mp4"), error: null },
    ];
    const output = await waitForOutput(config, bundle, promptId, {
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
      observe: async () => states.shift(),
      heartbeat: async () => undefined,
      heartbeatIntervalMs: 100,
      pollIntervalMs: 100,
      executionTimeoutMs: 1_000,
      initialObservationAt: initial.observedAt,
    });

    expect(output).toMatchObject({ filename: "video/recovered.mp4", nodeId: "75" });
  });

  it("fails the scheduling assertion when responsive Comfy never makes the submitted prompt observable", async () => {
    let clock = 0;
    await expect(assertPromptSchedulesMediaOutput(config, promptId, graph, "video", {
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
      pollIntervalMs: 50,
      absentGraceMs: 150,
      observe: async () => ({ state: "absent", observedAt: new Date(clock).toISOString(), entry: null, error: null }),
    })).rejects.toThrow("comfyui_prompt_not_observable");
    expect(clock).toBe(150);
  });

  it("recognizes completed SaveVideo history as an observable successful output", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/queue")) return json({ queue_running: [], queue_pending: [] });
      if (url.includes("/history/")) return json({ [promptId]: saveVideoHistory("video/final.webm") });
      throw new Error(`unexpected_fetch:${url}`);
    }));

    const observation = await observeComfyPrompt(config, promptId, graph, "video", {
      now: () => Date.parse("2026-08-29T08:10:00.000Z"),
      timeoutMs: 1,
    });

    expect(observation).toMatchObject({
      state: "history",
      observedAt: "2026-08-29T08:10:00.000Z",
      entry: { outputs: { "75": { videos: [{ filename: "video/final.webm" }] } } },
    });
  });

  it("cancels the exact Comfy prompt when Creative Studio cancels during an unresponsive poll", async () => {
    let clock = 0;
    let heartbeatCount = 0;
    let cancelRequested = false;
    const cancelledUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/creative-studio/runner/jobs/") && url.endsWith("/heartbeat")) {
        heartbeatCount += 1;
        return json({ ok: true, continue: heartbeatCount < 2 });
      }
      if (url === `${config.comfyUrl}/api/jobs/${promptId}/cancel`) {
        cancelledUrls.push(url);
        cancelRequested = true;
        return json({ ok: true });
      }
      if (url.endsWith("/queue") && cancelRequested) return json({ queue_running: [], queue_pending: [] });
      if (url.endsWith("/queue") || url.includes("/history/")) {
        throw new DOMException("Comfy did not answer", "TimeoutError");
      }
      throw new Error(`unexpected_fetch:${url}`);
    }));

    await expect(waitForOutput(config, bundle, promptId, {
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
      heartbeatIntervalMs: 100,
      pollIntervalMs: 100,
      executionTimeoutMs: 1_000,
      initialObservationAt: "2026-08-29T08:20:00.000Z",
      timeoutMs: 1,
      drainAbsentGraceMs: 0,
    })).rejects.toThrow("creative_studio_job_cancelled");

    expect(cancelledUrls).toEqual([`${config.comfyUrl}/api/jobs/${promptId}/cancel`]);
  });

  it("does not finish a targeted cancellation until that exact prompt leaves running and pending queues", async () => {
    let clock = 0;
    const otherPromptId = "prompt-other-002";
    const queueStates = [
      { queue_running: [[1, promptId]], queue_pending: [[2, otherPromptId]] },
      { queue_running: [[2, otherPromptId]], queue_pending: [[1, promptId]] },
      { queue_running: [[2, otherPromptId]], queue_pending: [] },
      { queue_running: [[2, otherPromptId]], queue_pending: [] },
    ];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === `${config.comfyUrl}/api/jobs/${promptId}/cancel`) return json({ ok: true });
      if (url.endsWith("/queue")) return json(queueStates.shift() ?? { queue_running: [[2, otherPromptId]], queue_pending: [] });
      throw new Error(`unexpected_fetch:${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await cancelAndDrainComfyPrompt(config, promptId, {
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
      drainPollIntervalMs: 50,
      drainAbsentGraceMs: 50,
      timeoutMs: 1,
    });

    expect(result).toMatchObject({ promptId, cancelError: null });
    expect(clock).toBe(150);
    expect(fetchMock).toHaveBeenCalledWith(`${config.comfyUrl}/api/jobs/${promptId}/cancel`, expect.objectContaining({ method: "POST" }));
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/queue"))).toHaveLength(4);
  });

  it("ends an unconfirmable cancellation drain at a finite deadline with an actionable error", async () => {
    let clock = 0;
    const observe = vi.fn(async () => ({ state: "unreachable", error: "comfyui_queue_unreachable" }));

    await expect(waitForComfyPromptDrain(config, promptId, {
      now: () => clock,
      sleep: async (milliseconds: number) => { clock += milliseconds; },
      drainPollIntervalMs: 100,
      drainTimeoutMs: 250,
      drainObserve: observe,
    })).rejects.toMatchObject({
      code: "comfyui_prompt_drain_unconfirmed",
      message: "comfyui_prompt_drain_unconfirmed:comfyui_queue_unreachable",
    });

    expect(clock).toBe(250);
    expect(observe).toHaveBeenCalledTimes(4);
  });
});

describe("Local Runner Comfy resource boundaries", () => {
  it("keeps images at 20 minutes, gives ordinary video two hours, and reserves 24 hours for explicit-heavy video", () => {
    expect(generationExecutionTimeoutMs({ modality: "image", settingsStamp: {} })).toBe(STANDARD_MEDIA_EXECUTION_TIMEOUT_MS);
    expect(generationExecutionTimeoutMs({
      modality: "video",
      settingsStamp: { videoPerformance: { mode: "fast-default" } },
    })).toBe(STANDARD_VIDEO_EXECUTION_TIMEOUT_MS);
    expect(generationExecutionTimeoutMs({ modality: "video", settingsStamp: {} })).toBe(STANDARD_VIDEO_EXECUTION_TIMEOUT_MS);
    expect(generationExecutionTimeoutMs({
      modality: "video",
      settingsStamp: { videoPerformance: { mode: "explicit-heavy" } },
    })).toBe(EXPLICIT_HEAVY_VIDEO_EXECUTION_TIMEOUT_MS);
    expect(generationExecutionTimeoutMs({ modality: "music", settingsStamp: {} })).toBe(EXPLICIT_HEAVY_VIDEO_EXECUTION_TIMEOUT_MS);
  });

  it("retries and reports a successful Comfy model release", async () => {
    const responses = [new Response(null, { status: 503 }), new Response(null, { status: 204 })];
    const fetchMock = vi.fn(async () => responses.shift() ?? new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const stdout = { write: vi.fn(() => true) };

    const released = await freeComfyMemory(config, "video prompt enhancement promptenh_test", {
      sleep: async () => undefined,
      retryDelayMs: 0,
      settleMs: 0,
      stdout,
    });

    expect(released).toEqual({ released: true, status: 204, attempts: 2, error: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(`${config.comfyUrl}/free`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    }));
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("models and memory released after video prompt enhancement promptenh_test"));
  });

  it("makes a non-2xx release observable without throwing or changing durable task state", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const stderr = { write: vi.fn(() => true) };

    const released = await freeComfyMemory(config, "overnight planning overnight_test", {
      sleep: async () => undefined,
      retryDelayMs: 0,
      settleMs: 0,
      stderr,
    });

    expect(released).toEqual({ released: false, status: 503, attempts: 2, error: "comfyui_free_503" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("durable task state is unchanged"));
  });
});
