// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

// The Local Runner is intentionally plain ESM so Windows can launch it directly with Node.
// @ts-expect-error TypeScript does not emit declarations for the runtime-only runner module.
import { observeComfyQueueState, runOnce } from "../../runner/index.mjs";

const config = {
  apiBase: "https://runner.example.test",
  token: `csr_${"a".repeat(43)}`,
  comfyUrl: "http://127.0.0.1:8188",
};
const machineState = {
  version: "1.16.0",
  comfyUrl: config.comfyUrl,
  comfyReady: true,
  comfyVersion: "0.33.0",
  device: "RTX 3090",
  activeJobId: null,
  error: null,
  modelTrainingProviders: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Local Runner pre-claim Comfy idle guard", () => {
  it.each([
    {
      label: "busy",
      observation: { state: "busy", runningCount: 1, pendingCount: 2, error: null },
      reason: "comfyui_queue_busy:running=1:pending=2",
    },
    {
      label: "unreachable",
      observation: { state: "unreachable", error: "comfyui_queue_unreachable" },
      reason: "comfyui_queue_unreachable",
    },
    {
      label: "structurally invalid",
      observation: { state: "invalid", error: "comfyui_queue_invalid" },
      reason: "comfyui_queue_invalid",
    },
  ])("does not request work while Comfy is $label", async ({ observation, reason }) => {
    const request = vi.fn(async () => ({ kind: null, bundle: null }));
    const heartbeat = vi.fn(async () => ({ ok: true }));

    await expect(runOnce(config, {
      machineState: async () => machineState,
      observeQueue: async () => observation,
      request,
      machineHeartbeat: heartbeat,
    })).resolves.toBe(false);

    expect(request).not.toHaveBeenCalled();
    expect(heartbeat).toHaveBeenCalledWith(config, null, reason);
  });

  it("requests work only after a reachable, structurally valid, empty Comfy queue", async () => {
    const request = vi.fn(async () => ({ kind: null, bundle: null }));
    const heartbeat = vi.fn(async () => ({ ok: true }));
    const observeQueue = vi.fn(async () => ({
      state: "idle",
      runningCount: 0,
      pendingCount: 0,
      queue: { queue_running: [], queue_pending: [] },
      error: null,
    }));

    await expect(runOnce(config, {
      machineState: async () => machineState,
      observeQueue,
      request,
      machineHeartbeat: heartbeat,
    })).resolves.toBe(false);

    expect(observeQueue).toHaveBeenCalledOnce();
    expect(heartbeat).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(config, "/api/creative-studio/runner/work/claim", {
      method: "POST",
      body: JSON.stringify(machineState),
    });
  });

  it("does not mistake a malformed reachable queue response for an idle queue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      queue_running: [],
      queue_pending: "not-an-array",
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(observeComfyQueueState(config, { timeoutMs: 1 })).resolves.toEqual({
      state: "invalid",
      error: "comfyui_queue_invalid",
    });
  });
});
