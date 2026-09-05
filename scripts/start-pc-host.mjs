import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createProbeServer } from "node:net";
import { createLocalHostServer } from "../local-host/server.mjs";
import {
  discoverPinnedD1Database,
  runProtectedLocalD1Migrations,
  verifyPinnedWranglerD1Binding,
} from "../local-host/sqliteProtection.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const runtimeRoot = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
const hostRoot = join(runtimeRoot, "Creative Studio Host");
const configPath = resolve(process.env.CS_HOST_CONFIG || join(hostRoot, "config.json"));
const wranglerBin = join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const runnerBin = join(repoRoot, "runner", "index.mjs");
const lockPath = join(hostRoot, "host-instance.lock");
const readyPath = join(hostRoot, "host-ready.json");
const logPath = join(hostRoot, "host.log");
const envPath = join(hostRoot, "wrangler.env");
const recoveryRoot = join(hostRoot, "database-recovery");
const workerOrigin = "http://127.0.0.1:8788";
const publicOrigin = "http://127.0.0.1:8787";
const children = new Set();
let lockHandle = null;
let gateway = null;
let stopping = false;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  try { writeFileSync(logPath, line, { encoding: "utf8", flag: "a" }); } catch { /* stdout remains available */ }
}

function fail(message) {
  throw new Error(message);
}

function pathInside(root, candidate) {
  const child = relative(resolve(root), resolve(candidate));
  return child === "" || (!child.startsWith("..\\") && !child.startsWith("../") && child !== ".." && !isAbsolute(child));
}

function readConfig() {
  if (resolve(configPath) !== resolve(join(hostRoot, "config.json"))) {
    fail(`PC host configuration must remain pinned to ${join(hostRoot, "config.json")}.`);
  }
  if (!existsSync(configPath)) fail(`PC host is not configured. Run npm run host:migrate first. Missing ${configPath}`);
  let value;
  try { value = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")); }
  catch { fail("The PC host configuration is invalid JSON."); }
  if (value?.schemaVersion !== "creative-studio-pc-host/1.0"
    || !/^user_[a-z0-9-]{20,100}$/i.test(String(value.ownerId ?? ""))
    || !isAbsolute(String(value.stateRoot ?? ""))
    || !isAbsolute(String(value.archiveRoot ?? ""))
    || !isAbsolute(String(value.runnerConfigPath ?? ""))
    || !isAbsolute(String(value.migrationReceipt ?? ""))
    || !pathInside(hostRoot, value.stateRoot)
    || !pathInside(hostRoot, value.runnerConfigPath)
    || !pathInside(hostRoot, value.migrationReceipt)
    || !/^[A-Za-z0-9_-]{40,100}$/.test(String(value.internalToken ?? ""))
    || !/^[A-Za-z0-9_-]{40,100}$/.test(String(value.sessionSecret ?? ""))
    || !/^[a-z0-9.-]+$/i.test(String(value.publicHostname ?? ""))
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value.accessEmail ?? ""))
    || String(value.accessEmail).length > 320
    || String(value.testHostname ?? "").trim()) fail("The PC host configuration is incomplete or invalid.");
  let receipt;
  try { receipt = JSON.parse(readFileSync(value.migrationReceipt, "utf8").replace(/^\uFEFF/, "")); }
  catch { fail("The protected PC migration receipt is missing or invalid."); }
  if (receipt?.schemaVersion !== "creative-studio-cloud-to-pc-migration/2.0"
    || resolve(String(receipt.destination?.stateRoot ?? "")) !== resolve(value.stateRoot)
    || !/^runner_pc_[a-f0-9]{32}$/i.test(String(receipt.destination?.runnerId ?? ""))
    || receipt.source?.ownerId !== value.ownerId
    || receipt.r2?.objects !== 233
    || receipt.r2?.bytes !== 315_823_973
    || receipt.preservation?.cloudWritesPerformed !== false
    || receipt.preservation?.cloudDataDeleted !== false) fail("The PC migration receipt does not authorize this host state.");
  const importedDatabase = receipt.d1?.integrityVerification?.imported;
  const finalDatabase = receipt.d1?.integrityVerification?.final;
  const databaseRelativePath = String(finalDatabase?.databaseRelativePath ?? "").replaceAll("\\", "/");
  const databasePath = resolve(value.stateRoot, databaseRelativePath);
  if (!databaseRelativePath || isAbsolute(databaseRelativePath) || !pathInside(value.stateRoot, databasePath)
    || importedDatabase?.databaseRelativePath?.replaceAll("\\", "/") !== databaseRelativePath
    || importedDatabase?.integrity !== "ok" || importedDatabase?.foreignKeyViolations !== 0
    || finalDatabase?.integrity !== "ok" || finalDatabase?.foreignKeyViolations !== 0
    || receipt.source?.d1Database !== "creative-studio") {
    fail("The PC migration receipt does not pin one verified local D1 database.");
  }
  return {
    ...value,
    runnerId: receipt.destination.runnerId,
    databaseName: receipt.source.d1Database,
    databaseRelativePath,
  };
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLock() {
  mkdirSync(hostRoot, { recursive: true });
  try {
    lockHandle = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    let pid;
    try { pid = Number(JSON.parse(readFileSync(lockPath, "utf8")).pid); }
    catch { fail(`Creative Studio PC Host lock is invalid at ${lockPath}; refusing to remove it automatically.`); }
    if (!Number.isInteger(pid) || pid <= 0) fail(`Creative Studio PC Host lock has no valid process owner at ${lockPath}; refusing to remove it automatically.`);
    if (processAlive(pid)) fail(`Creative Studio PC Host is already running as process ${pid}.`);
    rmSync(lockPath, { force: true });
    lockHandle = openSync(lockPath, "wx", 0o600);
  }
  writeFileSync(lockHandle, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), repoRoot, configPath })}\n`);
  protectFile(lockPath);
  rmSync(readyPath, { force: true });
}

function protectFile(path) {
  if (process.platform !== "win32") return;
  const account = userInfo().username;
  const result = spawnSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `${account}:(F)`, "/grant:r", "SYSTEM:(F)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.status !== 0) fail(`Could not protect ${path}.`);
}

function writeWranglerEnv(config) {
  const values = {
    BACKEND_MODE: "self-hosted",
    LOCAL_HARDWARE_ONLY: "true",
    SELF_HOSTED_OWNER_ID: config.ownerId,
    SELF_HOSTED_DISPLAY_NAME: config.displayName || "Angelo",
    SELF_HOSTED_ACCESS_EMAIL: config.accessEmail || "",
    SELF_HOSTED_INTERNAL_TOKEN: config.internalToken,
  };
  writeFileSync(envPath, `${Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  protectFile(envPath);
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status === 0) return;
  const diagnostic = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
  if (diagnostic) log(`PC host preparation ERROR: ${diagnostic}`);
  fail(`PC host preparation failed with exit code ${result.status}.`);
}

function startChild(label, args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
    windowsHide: true,
  });
  child.creativeStudioLabel = label;
  child.stdout.on("data", (chunk) => log(`${label}: ${String(chunk).trimEnd()}`));
  child.stderr.on("data", (chunk) => log(`${label} ERROR: ${String(chunk).trimEnd()}`));
  children.add(child);
  child.once("exit", (code) => {
    children.delete(child);
    if (!stopping) {
      log(`${label} exited with code ${code ?? "unknown"}.`);
      process.exitCode = code || 1;
      void stop();
    }
  });
  return child;
}

function portAvailable(port) {
  return new Promise((resolvePort) => {
    const probe = createProbeServer();
    probe.once("error", () => resolvePort(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolvePort(true)));
  });
}

async function waitForWorker(config) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${workerOrigin}/api/creative-studio/session`, {
        headers: { "x-cs-host-token": config.internalToken },
        signal: AbortSignal.timeout(5_000),
      });
      const payload = await response.json();
      if (response.ok && payload?.ok === true && payload.session?.status === "approved" && payload.session?.userId === config.ownerId) return;
    } catch { /* retry while Wrangler boots */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  fail("The self-hosted Creative Studio Worker did not become ready.");
}

async function waitForRunner(config, child, startedAfter) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      fail("The local Runner exited before authenticating with the PC host.");
    }
    try {
      const response = await fetch(`${workerOrigin}/api/creative-studio/runners`, {
        headers: { "x-cs-host-token": config.internalToken },
        signal: AbortSignal.timeout(5_000),
      });
      const payload = await response.json();
      const runner = Array.isArray(payload?.runners)
        ? payload.runners.find((candidate) => candidate?.id === config.runnerId)
        : null;
      const heartbeatAt = Date.parse(String(runner?.lastHeartbeatAt ?? ""));
      if (response.ok && payload?.ok === true && runner && (runner.state === "online" || runner.state === "busy")
        && Number.isFinite(heartbeatAt) && heartbeatAt >= startedAfter) {
        log(`Local Runner ${config.runnerId} authenticated and is ${runner.state}.`);
        return;
      }
    } catch { /* retry while the Runner completes its first local heartbeat */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  fail(`The local Runner ${config.runnerId} did not authenticate with the PC host.`);
}

async function listenGateway(server) {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(8787, "127.0.0.1", resolveListen);
  });
}

async function verifyGateway(config) {
  const root = await fetch(`${publicOrigin}/`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  const cookie = root.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  if (!root.ok || !cookie) fail("The PC host did not establish its local owner session.");
  const health = await fetch(`${publicOrigin}/api/creative-studio/host-health`, {
    headers: { cookie },
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await health.json();
  if (!health.ok || payload?.ok !== true || payload.mode !== "self-hosted" || payload.authority !== "this-pc") {
    fail("The PC host health contract did not verify.");
  }
  log(`Ready on ${publicOrigin}; ${payload.archive.entries} Art Index records, ${payload.archive.materializable} materializable.`);
  log(`Remote doorway: https://${config.publicHostname} (Cloudflare Access and Tunnel only).`);
}

function markReady(config) {
  writeFileSync(readyPath, `${JSON.stringify({
    pid: process.pid,
    readyAt: new Date().toISOString(),
    repoRoot,
    configPath,
    runnerId: config.runnerId,
  })}\n`, { encoding: "utf8", mode: 0o600 });
  protectFile(readyPath);
}

function waitForChildProcesses(ownedChildren, timeoutMs) {
  const pending = ownedChildren.filter((child) => child.exitCode === null && child.signalCode === null);
  if (!pending.length) return Promise.resolve(true);
  return new Promise((resolveWait) => {
    let remaining = pending.length;
    let settled = false;
    const listeners = new Map();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const [child, listener] of listeners) child.off("exit", listener);
      resolveWait(result);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    for (const child of pending) {
      const listener = () => {
        remaining -= 1;
        if (remaining === 0) finish(true);
      };
      listeners.set(child, listener);
      child.once("exit", listener);
    }
  });
}

async function stop() {
  if (stopping) return;
  stopping = true;
  const ownedGateway = gateway;
  gateway = null;
  const gatewayClosed = ownedGateway
    ? new Promise((resolveClose) => {
      const forceClose = setTimeout(() => ownedGateway.closeAllConnections?.(), 5_000);
      ownedGateway.close(() => {
        clearTimeout(forceClose);
        resolveClose();
      });
      ownedGateway.closeIdleConnections?.();
    })
    : Promise.resolve();
  const ownedChildren = [...children];
  for (const child of ownedChildren) {
    if (!child.killed) child.kill("SIGTERM");
  }
  const graceful = await waitForChildProcesses(ownedChildren, 10_000);
  if (!graceful) {
    log("A managed child did not stop within ten seconds; terminating that exact child before releasing the host lock.");
    for (const child of ownedChildren) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    await waitForChildProcesses(ownedChildren, 5_000);
  }
  await gatewayClosed;
  if (lockHandle !== null) {
    try { rmSync(readyPath, { force: true }); } catch { /* readiness remains fail-closed if cleanup is denied */ }
    try { closeSync(lockHandle); } catch { /* already closed */ }
    lockHandle = null;
    try { rmSync(lockPath, { force: true }); } catch { /* next launch can recover a stale lock */ }
  }
}

async function main() {
  acquireLock();
  const config = readConfig();
  if (!existsSync(wranglerBin) || !existsSync(runnerBin) || !existsSync(join(repoRoot, "dist", "index.html"))) {
    fail("Creative Studio is not built. Run npm install and npm run build:host.");
  }
  if (!existsSync(config.stateRoot) || !existsSync(config.runnerConfigPath)) fail("The migrated PC state or local Runner credential is missing.");
  verifyPinnedWranglerD1Binding(join(repoRoot, "wrangler.jsonc"), config.databaseName);
  if (!(await portAvailable(8787)) || !(await portAvailable(8788))) fail("Creative Studio host ports 8787 and 8788 must both be free.");
  writeWranglerEnv(config);
  log("Checking migrations and SQLite integrity for the pinned PC state.");
  const migration = await runProtectedLocalD1Migrations({
    stateRoot: config.stateRoot,
    hostRoot,
    recoveryRoot,
    migrationsRoot: join(repoRoot, "migrations"),
    expectedDatabaseRelativePath: config.databaseRelativePath,
    protectPath: protectFile,
    log,
    applyMigrations: () => runNode([
      wranglerBin,
      "d1",
      "migrations",
      "apply",
      "creative-studio",
      "--local",
      "--persist-to",
      config.stateRoot,
      "--env-file",
      envPath,
    ]),
  });
  if (migration.status === "up-to-date") log("Pinned local D1 integrity verified; no migrations are pending.");
  startChild("Local Worker", [wranglerBin, "dev", "--local", "--ip", "127.0.0.1", "--port", "8788", "--persist-to", config.stateRoot, "--env-file", envPath, "--show-interactive-dev-session=false", "--log-level", "warn"]);
  await waitForWorker(config);
  const workerDatabase = discoverPinnedD1Database(config.stateRoot);
  if (workerDatabase.relativePath !== config.databaseRelativePath) {
    fail("The local Worker selected a D1 database other than the exact state pinned by the migration receipt.");
  }
  gateway = createLocalHostServer({
    workerOrigin,
    publicHostname: config.publicHostname,
    accessEmail: config.accessEmail,
    internalToken: config.internalToken,
    sessionSecret: config.sessionSecret,
    archiveRoot: config.archiveRoot,
  });
  await listenGateway(gateway);
  const runnerStartedAfter = Date.now();
  const runner = startChild("Local Runner", [runnerBin], { CS_RUNNER_CONFIG: config.runnerConfigPath });
  await waitForRunner(config, runner, runnerStartedAfter);
  await verifyGateway(config);
  markReady(config);
  await new Promise((resolveMain) => {
    const signal = () => { void stop().then(resolveMain); };
    process.once("SIGINT", signal);
    process.once("SIGTERM", signal);
  });
}

main().catch(async (error) => {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  await stop();
});
