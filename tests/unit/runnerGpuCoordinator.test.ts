// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error The Windows runner intentionally ships as plain ESM.
import { acquireRunnerGpuLock, acquireRunnerInstanceLock, defaultRunnerGpuLockPath, defaultRunnerInstanceLockPath, ensureLmStudioUnloaded, isForeignRunnerGpuLockContention, observeLmStudioResidency } from "../../runner/gpuCoordinator.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Local GPU coordinator", () => {
  it("treats an absent LM Studio installation as verified empty", async () => {
    await expect(observeLmStudioResidency({ cli: null })).resolves.toEqual({
      available: false,
      loadedCount: 0,
    });
    await expect(ensureLmStudioUnloaded({ cli: null })).resolves.toMatchObject({
      unloadedCount: 0,
      verified: true,
    });
  });

  it("unloads every LM Studio model and verifies residency again", async () => {
    const observations = [
      { available: true, loadedCount: 3 },
      { available: true, loadedCount: 0 },
    ];
    const observe = vi.fn(async () => observations.shift());
    const runCommand = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));

    await expect(ensureLmStudioUnloaded({ cli: "lms", observe, runCommand })).resolves.toEqual({
      available: true,
      unloadedCount: 3,
      verified: true,
    });
    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith("lms", ["unload", "--all"], expect.any(Object));
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("blocks video handoff when LM Studio remains resident", async () => {
    const observe = vi.fn(async () => ({ available: true, loadedCount: 1 }));
    const runCommand = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));

    await expect(ensureLmStudioUnloaded({ cli: "lms", observe, runCommand }))
      .rejects.toThrow("lmstudio_gpu_handoff_unconfirmed");
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("allows one runner process to own the machine GPU and recovers a stale lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "creative-studio-gpu-lock-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "gpu.lock");
    const first = await acquireRunnerGpuLock({ path, pid: 1201, processAlive: () => true });

    await expect(acquireRunnerGpuLock({ path, pid: 1202, processAlive: () => true }))
      .rejects.toThrow("runner_gpu_lock_held:1201");
    await first.release();

    const stale = await acquireRunnerGpuLock({ path, pid: 1203, processAlive: () => false });
    await stale.release();
    await expect(acquireRunnerGpuLock({ path, pid: 1204, processAlive: () => false }))
      .resolves.toMatchObject({ pid: 1204, path });
  });

  it("keeps process singleton ownership separate from the shared GPU lease", async () => {
    expect(defaultRunnerInstanceLockPath()).not.toBe(defaultRunnerGpuLockPath());
    const directory = await mkdtemp(join(tmpdir(), "creative-studio-runner-locks-"));
    temporaryDirectories.push(directory);
    const instancePath = join(directory, "runner-instance.lock");
    const gpuPath = join(directory, "gpu-owner.lock");
    const instance = await acquireRunnerInstanceLock({ path: instancePath, pid: 1301, processAlive: () => true });
    const gpu = await acquireRunnerGpuLock({ path: gpuPath, pid: 1301, processAlive: () => true });

    await expect(acquireRunnerInstanceLock({ path: instancePath, pid: 1302, processAlive: () => true }))
      .rejects.toThrow("runner_instance_lock_held:1301");
    await gpu.release();
    const nextGpu = await acquireRunnerGpuLock({ path: gpuPath, pid: 1302, processAlive: () => true });
    await nextGpu.release();
    await instance.release();
  });

  it("distinguishes foreign GPU contention from self-held and unrelated errors", () => {
    expect(isForeignRunnerGpuLockContention(new Error("runner_gpu_lock_held:1401"), 1402)).toBe(true);
    expect(isForeignRunnerGpuLockContention(new Error("runner_gpu_lock_held:initializing"), 1402)).toBe(true);
    expect(isForeignRunnerGpuLockContention(new Error("runner_gpu_lock_held:1402"), 1402)).toBe(false);
    expect(isForeignRunnerGpuLockContention(new Error("permission_denied"), 1402)).toBe(false);
  });

  it("never removes a freshly created lock before its owner record is visible", async () => {
    const directory = await mkdtemp(join(tmpdir(), "creative-studio-gpu-lock-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "gpu.lock");
    await writeFile(path, "", "utf8");

    await expect(acquireRunnerGpuLock({ path, pid: 1205, processAlive: () => false }))
      .rejects.toThrow("runner_gpu_lock_held:initializing");
  });
});
