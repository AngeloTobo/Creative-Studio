import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const workerOrigin = "http://127.0.0.1:8787";
const comfyOrigin = String(process.env.CS_COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
const runtimeRoot = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
const runnerConfigPath = join(runtimeRoot, "Creative Studio Runner", "local-config.json");
const wranglerBin = join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const viteBin = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const runnerBin = join(repoRoot, "runner", "index.mjs");
const children = new Set();
let stopping = false;

function fail(message) {
  throw new Error(message);
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`Local preparation failed with exit code ${result.status}.`);
}

function startNode(label, args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
    windowsHide: true,
  });
  child.creativeStudioLabel = label;
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function availableUiPort() {
  for (let port = 5173; port <= 5182; port += 1) {
    if (await portAvailable(port)) return port;
  }
  fail("No local UI port is available between 5173 and 5182.");
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${workerOrigin}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json", ...init.headers },
  });
  const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  return { response, payload };
}

async function localWorkerReady() {
  try {
    const { response, payload } = await jsonRequest("/api/creative-studio/session");
    return response.ok && payload?.ok === true && payload.session?.status === "development";
  } catch {
    return false;
  }
}

async function waitForLocalWorker() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await localWorkerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail("The local Creative Studio BFF did not become ready on http://127.0.0.1:8787.");
}

function readLocalRunnerConfig() {
  if (!existsSync(runnerConfigPath)) return null;
  try {
    const value = JSON.parse(readFileSync(runnerConfigPath, "utf8").replace(/^\uFEFF/, ""));
    if (value.apiBase !== workerOrigin || !/^csr_[A-Za-z0-9_-]{40,80}$/.test(String(value.token || ""))) return null;
    return value;
  } catch {
    return null;
  }
}

async function runnerTokenWorks(config) {
  try {
    const { response, payload } = await jsonRequest("/api/creative-studio/runner/heartbeat", {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}` },
      body: JSON.stringify({
        version: "1.4.0",
        comfyUrl: comfyOrigin,
        comfyVersion: null,
        device: "Local startup check",
        activeJobId: null,
        error: null,
      }),
    });
    return response.ok && payload?.ok === true;
  } catch {
    return false;
  }
}

function protectRunnerConfig() {
  if (process.platform !== "win32") return;
  const account = userInfo().username;
  const result = spawnSync("icacls.exe", [runnerConfigPath, "/inheritance:r", "/grant:r", `${account}:(F)`, "/grant:r", "SYSTEM:(F)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.status !== 0) fail("Could not protect the local runner credential file ACL.");
}

async function ensureLocalRunnerConfig() {
  const current = readLocalRunnerConfig();
  if (current && await runnerTokenWorks(current)) return current;
  const { response, payload } = await jsonRequest("/api/creative-studio/runners/enroll", {
    method: "POST",
    body: JSON.stringify({ name: "Angelo RTX 3090 · local" }),
  });
  if (!response.ok || payload?.ok !== true || !payload.token) fail(payload?.error || "Could not enroll the local hardware runner.");
  const config = { apiBase: workerOrigin, token: payload.token, comfyUrl: comfyOrigin, pollIntervalMs: 5_000 };
  mkdirSync(dirname(runnerConfigPath), { recursive: true });
  writeFileSync(runnerConfigPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  protectRunnerConfig();
  return config;
}

async function comfyStatus() {
  try {
    const response = await fetch(`${comfyOrigin}/system_stats`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const stats = await response.json();
    return {
      version: stats.system?.comfyui_version || "unknown",
      device: Array.isArray(stats.devices) ? stats.devices.map((item) => item?.name || item?.type).filter(Boolean).join(", ") : "unknown",
    };
  } catch {
    return null;
  }
}

function stopChildren() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

async function main() {
  if (!existsSync(wranglerBin) || !existsSync(viteBin)) fail("Run npm install before starting local Creative Studio.");
  process.stdout.write("[Creative Studio Local] Applying local D1 migrations...\n");
  runNode([wranglerBin, "d1", "migrations", "apply", "creative-studio", "--local"]);

  let worker = null;
  if (await localWorkerReady()) {
    process.stdout.write("[Creative Studio Local] Reusing the existing local BFF on port 8787.\n");
  } else {
    worker = startNode("Local BFF", [wranglerBin, "dev", "--local", "--port", "8787"]);
    await waitForLocalWorker();
  }

  await ensureLocalRunnerConfig();
  const hardware = await comfyStatus();
  if (hardware) process.stdout.write(`[Creative Studio Local] ComfyUI ${hardware.version} · ${hardware.device}\n`);
  else process.stderr.write(`[Creative Studio Local] ComfyUI is offline at ${comfyOrigin}; the app will open, but hardware jobs will wait.\n`);

  const uiPort = await availableUiPort();
  const uiOrigin = `http://127.0.0.1:${uiPort}`;
  const runner = startNode("Local Runner", [runnerBin], { CS_RUNNER_CONFIG: runnerConfigPath });
  const ui = startNode("Vite UI", [viteBin, "--port", String(uiPort)], {
    VITE_CREATIVE_STUDIO_ADAPTER: "http",
    VITE_CREATIVE_STUDIO_LOCAL: "true",
  });
  process.stdout.write(`[Creative Studio Local] ${uiOrigin}\n`);
  process.stdout.write("[Creative Studio Local] Cloudflare and AFDFW are not used by this local process. Press Ctrl+C to stop.\n");

  await new Promise((resolve) => {
    const onSignal = () => { stopChildren(); resolve(); };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    for (const child of [worker, runner, ui].filter(Boolean)) {
      child.once("exit", (code) => {
        if (stopping) return;
        process.stderr.write(`[Creative Studio Local] ${child.creativeStudioLabel} exited with code ${code ?? "unknown"}.\n`);
        process.exitCode = code || 1;
        stopChildren();
        resolve();
      });
    }
  });
}

main().catch((error) => {
  stopChildren();
  process.stderr.write(`[Creative Studio Local] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
