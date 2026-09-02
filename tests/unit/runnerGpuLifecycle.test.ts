// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

// @ts-expect-error The Windows runner intentionally ships as plain ESM.
import { createComfyModelResidencyState, createRunnerGpuCoordinationState, runCoordinatedRunnerCycle } from "../../runner/index.mjs";

const config = {
  apiBase: "https://runner.example.test",
  token: "csr_test",
  comfyUrl: "http://127.0.0.1:8188",
  comfyLogPath: null,
  pollIntervalMs: 60_000,
};

describe("runner GPU lease lifecycle", () => {
  it("holds the shared GPU lease for exactly one claim-and-execute cycle", async () => {
    const events: string[] = [];
    const release = vi.fn(async () => { events.push("release"); });
    const acquireGpuLock = vi.fn(async () => {
      events.push("acquire");
      return { release };
    });
    const execute = vi.fn(async () => {
      events.push("execute");
      return true;
    });

    await expect(runCoordinatedRunnerCycle(config, createRunnerGpuCoordinationState(), {
      acquireGpuLock,
      execute,
      observeQueue: vi.fn(async () => ({ state: "idle" })),
    })).resolves.toEqual({ didWork: true, contended: false, leaseRetained: false });
    expect(events).toEqual(["acquire", "execute", "release"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("treats a live foreign GPU owner as idle without claiming work", async () => {
    const state = createRunnerGpuCoordinationState();
    const execute = vi.fn();
    const heartbeat = vi.fn(async () => undefined);
    const acquireGpuLock = vi.fn(async () => {
      throw new Error(`runner_gpu_lock_held:${process.pid + 1}`);
    });

    await expect(runCoordinatedRunnerCycle(config, state, {
      acquireGpuLock,
      execute,
      heartbeat,
    })).resolves.toEqual({ didWork: false, contended: true, leaseRetained: false });
    expect(execute).not.toHaveBeenCalled();
    expect(heartbeat).toHaveBeenCalledWith(config, null);
    expect(state.contentionObserved).toBe(true);
  });

  it("invalidates remembered Comfy residency after reacquiring following contention", async () => {
    const state = createRunnerGpuCoordinationState();
    const modelResidencyState = createComfyModelResidencyState();
    Object.assign(modelResidencyState, {
      status: "known",
      family: "ltx",
      signature: "warm-before-contention",
      highVram: true,
    });
    const release = vi.fn(async () => undefined);
    const acquireGpuLock = vi.fn()
      .mockRejectedValueOnce(new Error(`runner_gpu_lock_held:${process.pid + 1}`))
      .mockResolvedValueOnce({ release });
    const execute = vi.fn(async (_config, options) => {
      expect(options.modelResidencyState).toEqual({
        status: "unknown",
        family: null,
        signature: null,
        highVram: null,
      });
      return false;
    });
    const observeQueue = vi.fn(async () => ({ state: "idle" }));

    await runCoordinatedRunnerCycle(config, state, {
      acquireGpuLock,
      execute,
      heartbeat: vi.fn(async () => undefined),
      modelResidencyState,
      observeQueue,
    });
    await expect(runCoordinatedRunnerCycle(config, state, {
      acquireGpuLock,
      execute,
      modelResidencyState,
      observeQueue,
    })).resolves.toEqual({ didWork: false, contended: false, leaseRetained: false });
    expect(execute).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(state.contentionObserved).toBe(false);
  });

  it("releases the GPU lease when claim execution throws", async () => {
    const release = vi.fn(async () => undefined);
    const failure = new Error("claim_failed");

    await expect(runCoordinatedRunnerCycle(config, createRunnerGpuCoordinationState(), {
      acquireGpuLock: vi.fn(async () => ({ release })),
      execute: vi.fn(async () => { throw failure; }),
      observeQueue: vi.fn(async () => ({ state: "idle" })),
    })).rejects.toBe(failure);
    expect(release).toHaveBeenCalledOnce();
  });

  it("retains an owned GPU lease until the post-cycle Comfy queue is proven idle", async () => {
    const state = createRunnerGpuCoordinationState();
    const release = vi.fn(async () => undefined);
    const acquireGpuLock = vi.fn(async () => ({ release }));
    const execute = vi.fn(async () => true);
    const observeQueue = vi.fn()
      .mockResolvedValueOnce({ state: "unreachable" })
      .mockResolvedValueOnce({ state: "idle", runningCount: 0, pendingCount: 0 });

    await expect(runCoordinatedRunnerCycle(config, state, {
      acquireGpuLock,
      execute,
      observeQueue,
    })).resolves.toEqual({ didWork: true, contended: false, leaseRetained: true });
    expect(acquireGpuLock).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();

    await expect(runCoordinatedRunnerCycle(config, state, {
      acquireGpuLock,
      execute,
      observeQueue,
    })).resolves.toEqual({ didWork: true, contended: false, leaseRetained: false });
    expect(acquireGpuLock).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(state.retainedGpuLock).toBeNull();
  });
});
