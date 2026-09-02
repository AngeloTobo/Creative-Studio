import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const COMMAND_TIMEOUT_MS = 15_000;
const MAX_COMMAND_OUTPUT_BYTES = 256_000;

function localRunnerDirectory() {
  return process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Creative Studio Runner")
    : join(homedir(), "AppData", "Local", "Creative Studio Runner");
}

export function defaultRunnerGpuLockPath() {
  return join(localRunnerDirectory(), "gpu-owner.lock");
}

export function defaultRunnerInstanceLockPath() {
  return join(localRunnerDirectory(), "runner-instance.lock");
}

export function resolveLmStudioCli() {
  const configured = String(process.env.CS_LM_STUDIO_CLI || "").trim();
  if (configured) return configured;
  const windowsCandidate = join(homedir(), ".lmstudio", "bin", "lms.exe");
  if (existsSync(windowsCandidate)) return windowsCandidate;
  return process.platform === "win32" ? null : "lms";
}

export async function runLocalCommand(command, args, options = {}) {
  const timeoutMs = Math.max(1_000, Math.min(60_000, Number(options.timeoutMs) || COMMAND_TIMEOUT_MS));
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    let timer;
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const append = (target, chunk) => {
      if (outputBytes >= MAX_COMMAND_OUTPUT_BYTES) return;
      const buffer = Buffer.from(chunk);
      const remaining = MAX_COMMAND_OUTPUT_BYTES - outputBytes;
      target.push(buffer.subarray(0, remaining));
      outputBytes += Math.min(buffer.byteLength, remaining);
    };
    child.stdout.on("data", (chunk) => append(stdout, chunk));
    child.stderr.on("data", (chunk) => append(stderr, chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => finish(() => resolve({
      code: Number.isInteger(code) ? code : null,
      signal: signal || null,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    })));
    timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("local_command_timed_out")));
    }, timeoutMs);
  });
}

function parseLmStudioProcesses(value) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || "").replace(/^\uFEFF/, "").trim() || "[]");
  } catch {
    throw new Error("lmstudio_gpu_state_invalid");
  }
  if (!Array.isArray(parsed)) throw new Error("lmstudio_gpu_state_invalid");
  return parsed;
}

export async function observeLmStudioResidency(options = {}) {
  const cli = Object.prototype.hasOwnProperty.call(options, "cli") ? options.cli : resolveLmStudioCli();
  if (!cli) return { available: false, loadedCount: 0 };
  const run = options.runCommand || runLocalCommand;
  let result;
  try {
    result = await run(cli, ["ps", "--json"], options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "command_failed";
    throw new Error(`lmstudio_gpu_state_unconfirmed:${detail}`, { cause: error });
  }
  if (result.code !== 0) throw new Error("lmstudio_gpu_state_unconfirmed");
  return { available: true, loadedCount: parseLmStudioProcesses(result.stdout).length };
}

export async function ensureLmStudioUnloaded(options = {}) {
  const before = await (options.observe || observeLmStudioResidency)(options);
  if (!before.available || before.loadedCount === 0) {
    return { available: before.available, unloadedCount: 0, verified: true };
  }
  const cli = Object.prototype.hasOwnProperty.call(options, "cli") ? options.cli : resolveLmStudioCli();
  if (!cli) throw new Error("lmstudio_gpu_handoff_unconfirmed");
  const run = options.runCommand || runLocalCommand;
  let result;
  try {
    result = await run(cli, ["unload", "--all"], options);
  } catch {
    throw new Error("lmstudio_gpu_handoff_unconfirmed");
  }
  if (result.code !== 0) throw new Error("lmstudio_gpu_handoff_unconfirmed");
  const after = await (options.observe || observeLmStudioResidency)(options);
  if (!after.available || after.loadedCount !== 0) throw new Error("lmstudio_gpu_handoff_unconfirmed");
  return { available: true, unloadedCount: before.loadedCount, verified: true };
}

function defaultProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function existingLockOwner(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return Number(parsed?.pid) || null;
  } catch {
    return null;
  }
}

async function lockAgeMs(path) {
  try {
    return Math.max(0, Date.now() - (await stat(path)).mtimeMs);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function acquireRunnerProcessLock(options, defaults) {
  const path = options.path || defaults.path();
  const pid = Number(options.pid) || process.pid;
  const processAlive = options.processAlive || defaultProcessAlive;
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(JSON.stringify({
        pid,
        acquiredAt: new Date().toISOString(),
        owner: defaults.owner,
      }), "utf8");
      await handle.close();
      let released = false;
      return {
        path,
        pid,
        async release() {
          if (released) return;
          released = true;
          const owner = await existingLockOwner(path);
          if (owner === pid) await rm(path, { force: true });
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner = await existingLockOwner(path);
      if (!owner) {
        // Another process may have won the exclusive create and still be writing
        // its owner record. Never delete a freshly created, temporarily empty lock.
        await new Promise((resolve) => setTimeout(resolve, 100));
        owner = await existingLockOwner(path);
      }
      if (owner && processAlive(owner)) {
        const held = new Error(`${defaults.errorPrefix}_held:${owner}`, { cause: error });
        held.code = defaults.heldCode;
        held.ownerPid = owner;
        held.foreign = owner !== pid;
        throw held;
      }
      if (!owner && await lockAgeMs(path) < 30_000) {
        const held = new Error(`${defaults.errorPrefix}_held:initializing`, { cause: error });
        held.code = defaults.heldCode;
        held.ownerPid = null;
        held.foreign = true;
        throw held;
      }
      await rm(path, { force: true });
    }
  }
  throw new Error(`${defaults.errorPrefix}_unavailable`);
}

export async function acquireRunnerGpuLock(options = {}) {
  return acquireRunnerProcessLock(options, {
    path: defaultRunnerGpuLockPath,
    owner: "creative-studio-runner",
    errorPrefix: "runner_gpu_lock",
    heldCode: "RUNNER_GPU_LOCK_HELD",
  });
}

export async function acquireRunnerInstanceLock(options = {}) {
  return acquireRunnerProcessLock(options, {
    path: defaultRunnerInstanceLockPath,
    owner: "creative-studio-runner-instance",
    errorPrefix: "runner_instance_lock",
    heldCode: "RUNNER_INSTANCE_LOCK_HELD",
  });
}

export function isForeignRunnerGpuLockContention(error, pid = process.pid) {
  if (error?.code === "RUNNER_GPU_LOCK_HELD") {
    return error.ownerPid === null || error.ownerPid !== pid;
  }
  const match = /^runner_gpu_lock_held:(initializing|\d+)$/.exec(String(error?.message || ""));
  if (!match) return false;
  return match[1] === "initializing" || Number(match[1]) !== pid;
}
