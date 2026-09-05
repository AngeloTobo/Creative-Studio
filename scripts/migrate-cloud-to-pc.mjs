import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { newHostSecret } from "../local-host/server.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const runtimeRoot = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
const hostRoot = join(runtimeRoot, "Creative Studio Host");
const legacyRunnerConfigPath = join(runtimeRoot, "Creative Studio Runner", "config.json");
const legacyRunnerBin = join(repoRoot, "runner", "index.mjs");
const wranglerBin = join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const wranglerAuthPath = join(process.env.USERPROFILE || homedir(), ".wrangler", "config", "default.toml");
const accountId = "9309f19637f76124c68ae362ead60090";
const databaseId = "aed622ee-4caa-4704-80c4-4b847a8fdd9c";
const databaseName = "creative-studio";
const bucketName = "creative-studio-artifacts";
const ownerId = "user_67da1402-581a-4e37-a0dc-72312425fea0";
const ownerAccessEmail = "angelotoborg@gmail.com";
const legacyTaskName = "Creative Studio Local Runner";
const expectedR2Objects = 233;
const expectedR2Bytes = 315_823_973;
const expectedTables = 40;
const expectedMigrations = 25;
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const backupRoot = join(hostRoot, "backups", timestamp);
const objectRoot = join(backupRoot, "r2-objects");
const stateRoot = join(hostRoot, `state-${timestamp}`);
const d1ExportAPath = join(backupRoot, "production-d1-a.sql");
const d1ExportBPath = join(backupRoot, "production-d1-b.sql");
const d1DerivedImportPath = join(backupRoot, "local-derived-d1-import.sql");
const inventoryAPath = join(backupRoot, "production-r2-inventory-a.json");
const inventoryBPath = join(backupRoot, "production-r2-inventory-b.json");
const verifiedInventoryPath = join(backupRoot, "verified-r2-inventory.json");
const quarantineSqlPath = join(backupRoot, "local-cutover-quarantine.sql");
const legacyTaskBackupPath = join(backupRoot, "legacy-runner-task.xml");
const receiptPath = join(backupRoot, "migration-receipt.json");
const runnerConfigPath = join(stateRoot, "runner-config.json");
const configPath = join(hostRoot, "config.json");
let rollbackLegacyState = null;
let migrationCompleted = false;
let handlingSignal = false;
let sqliteVerifier = null;

const HTTP_METADATA_KEYS = new Map([
  ["contentType", "contentType"],
  ["content_type", "contentType"],
  ["contentLanguage", "contentLanguage"],
  ["content_language", "contentLanguage"],
  ["contentDisposition", "contentDisposition"],
  ["content_disposition", "contentDisposition"],
  ["contentEncoding", "contentEncoding"],
  ["content_encoding", "contentEncoding"],
  ["cacheControl", "cacheControl"],
  ["cache_control", "cacheControl"],
  ["cacheExpiry", "cacheExpiry"],
  ["cache_expiry", "cacheExpiry"],
]);

const CLAIMABLE_SOURCES = [
  { source: "generation", table: "creative_jobs", where: "status in ('queued','running')", executing: new Set(["running"]) },
  { source: "dna-training", table: "creative_dna_training_jobs", where: "status in ('waiting-for-runner','running')", executing: new Set(["running"]) },
  { source: "model-training", table: "creative_model_training_jobs", where: "status in ('waiting-for-runner','running')", executing: new Set(["running"]) },
  { source: "prompt-enhancement", table: "creative_prompt_enhancements", where: "status in ('waiting-for-runner','running')", executing: new Set(["running"]) },
  { source: "video-script", table: "creative_video_script_drafts", where: "status in ('waiting-for-runner','running')", executing: new Set(["running"]) },
  { source: "story-refresh", table: "creative_story_refreshes", where: "status in ('waiting-for-runner','running')", executing: new Set(["running"]) },
  { source: "overnight-session", table: "creative_overnight_sessions", where: "status in ('armed','planning','running','paused','needs-attention')", executing: new Set(["planning", "running"]) },
  { source: "overnight-task", table: "creative_overnight_tasks", where: "status in ('planned','queued','running')", executing: new Set(["running"]) },
  { source: "love-loop", table: "creative_love_loops", where: "status = 'active'", executing: new Set() },
  { source: "love-loop-drop", table: "creative_love_loop_drops", where: "status in ('planned','queued','running')", executing: new Set(["running"]) },
  {
    source: "generation-batch",
    table: "creative_generation_batches",
    where: `status in ('waiting','running') or (status = 'completed' and exists (
      select 1 from creative_jobs j where j.owner_id = creative_generation_batches.owner_id
      and json_extract(j.settings_stamp_json, '$.outputBatch.batchId') = creative_generation_batches.id
      and (j.status = 'cancelled' or (j.status = 'failed' and not exists (
        select 1 from creative_jobs successor where successor.owner_id = j.owner_id and successor.retry_of_job_id = j.id
      )))
    ))`,
    executing: new Set(["running"]),
  },
  { source: "archive-materialization", table: "creative_archive_materializations", where: "status in ('waiting-for-runner','running')", executing: new Set(["running"]) },
];

function log(message) {
  process.stdout.write(`[Creative Studio migration] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function protect(path, recursive = false) {
  if (process.platform !== "win32") return;
  const account = userInfo().username;
  const inheritance = statSync(path).isDirectory() ? "(OI)(CI)" : "";
  const args = [path, "/inheritance:r", "/grant:r", `${account}:${inheritance}(F)`, "/grant:r", `SYSTEM:${inheritance}(F)`];
  const result = spawnSync("icacls.exe", args, { stdio: "ignore", windowsHide: true });
  if (result.status !== 0) fail(`Could not protect ${path}.`);
  if (recursive && statSync(path).isDirectory()) {
    // Applying an inherit-only (OI)(CI) ACE with /T gives existing files no effective ACE.
    // Protect the root once, then reset descendants so they inherit its user/SYSTEM grants.
    const descendants = spawnSync("icacls.exe", [join(path, "*"), "/reset", "/T", "/C"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (descendants.status !== 0) fail(`Could not inherit protected access below ${path}.`);
  }
}

function atomicWrite(path, content) {
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  protect(temporary);
  renameSync(temporary, path);
  protect(path);
}

function runNode(args, { capture = false } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail((result.stderr || result.stdout || `Command failed with exit ${result.status}.`).trim());
  return result.stdout || "";
}

function isWranglerAuthenticationError(value) {
  const message = String(value ?? "");
  return /authentication error/i.test(message) && /\bcode\s*:\s*10000\b/i.test(message);
}

function runReadOnlyRemoteNode(args, { capture = false, operation = "read-only remote Wrangler operation" } = {}) {
  const commandIndex = args.indexOf("--command");
  const sql = commandIndex >= 0 ? String(args[commandIndex + 1] ?? "") : "";
  const allowedD1Operation = args[0] === wranglerBin && args[1] === "d1" && args[3] === databaseId
    && (args[2] === "export" || (args[2] === "execute" && /^\s*select\b/i.test(sql) && !sql.includes(";")));
  if (!allowedD1Operation || !args.includes("--remote") || args.includes("--local")) {
    fail("Authentication retry was requested for an operation outside the read-only remote D1 allowlist.");
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (!capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    if (result.error) throw result.error;
    if (result.status === 0) return result.stdout || "";
    const failure = (result.stderr || result.stdout || `Command failed with exit ${result.status}.`).trim();
    const diagnosticOutput = `${result.stderr || ""}\n${result.stdout || ""}`;
    if (attempt === 0 && isWranglerAuthenticationError(diagnosticOutput)) {
      log(`Wrangler authentication error [code: 10000] during ${operation}; retrying once.`);
      continue;
    }
    fail(failure);
  }
  fail("Read-only remote Wrangler retry exhausted unexpectedly.");
}

function runPowerShell(source, { capture = false } = {}) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", source], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail((result.stderr || result.stdout || `PowerShell failed with exit ${result.status}.`).trim());
  return result.stdout || "";
}

function powerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseJson(output, description) {
  const trimmed = String(output).trim();
  try { return JSON.parse(trimmed); }
  catch { fail(`${description} returned malformed JSON.`); }
}

function parseWranglerJson(output) {
  const start = output.indexOf("[");
  if (start < 0) fail("Wrangler did not return JSON.");
  try { return JSON.parse(output.slice(start)); }
  catch { fail("Wrangler returned malformed JSON."); }
}

function wranglerRows(args, { readOnlyRemote = false } = {}) {
  const output = readOnlyRemote
    ? runReadOnlyRemoteNode(args, { capture: true, operation: "read-only remote D1 query" })
    : runNode(args, { capture: true });
  const payload = parseWranglerJson(output);
  if (!Array.isArray(payload) || payload.some((entry) => entry?.success !== true)) fail("A D1 verification query failed.");
  return payload.flatMap((entry) => entry.results ?? []);
}

function remoteRows(sql) {
  if (!/^\s*select\b/i.test(sql) || sql.includes(";")) fail("Remote D1 verification must be a single SELECT statement.");
  return wranglerRows([wranglerBin, "d1", "execute", databaseId, "--remote", "--command", sql, "--json"], { readOnlyRemote: true });
}

function localRows(sql) {
  return wranglerRows([wranglerBin, "d1", "execute", databaseName, "--local", "--persist-to", stateRoot, "--command", sql, "--json"]);
}

function localFile(path) {
  runNode([wranglerBin, "d1", "execute", databaseName, "--local", "--persist-to", stateRoot, "--file", path, "--yes"]);
}

function oauthToken() {
  if (!existsSync(wranglerAuthPath)) fail("Wrangler is not authenticated on this PC.");
  const source = readFileSync(wranglerAuthPath, "utf8");
  const match = source.match(/^oauth_token\s*=\s*["']([^"']+)["']/m);
  if (!match?.[1]) fail("Wrangler OAuth token is unavailable.");
  return match[1];
}

function taskState() {
  if (process.platform !== "win32") fail("The PC-host cutover requires Windows Scheduled Tasks.");
  const output = runPowerShell(`
    $ErrorActionPreference = 'Stop'
    $task = Get-ScheduledTask -TaskName '${legacyTaskName}' -ErrorAction SilentlyContinue
    if ($null -eq $task) {
      [pscustomobject]@{ exists = $false; enabled = $false; running = $false; state = 'Missing' } | ConvertTo-Json -Compress
    } else {
      [pscustomobject]@{ exists = $true; enabled = [bool]$task.Settings.Enabled; running = ($task.State -eq 'Running'); state = [string]$task.State } | ConvertTo-Json -Compress
    }
  `, { capture: true });
  return parseJson(output, "Scheduled Task inspection");
}

function runnerProcesses() {
  const output = runPowerShell(`
    $ErrorActionPreference = 'Stop'
    $items = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
      $_.CommandLine -and $_.CommandLine -match 'runner[\\\\/]index\\.mjs'
    } | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; commandLine = [string]$_.CommandLine } })
    [pscustomobject]@{ processes = $items } | ConvertTo-Json -Compress -Depth 4
  `, { capture: true });
  const parsed = parseJson(output, "Runner process inspection");
  return Array.isArray(parsed.processes) ? parsed.processes : parsed.processes ? [parsed.processes] : [];
}

function managedRunnerProcesses(processes = runnerProcesses()) {
  const expectedScript = resolve(legacyRunnerBin).replaceAll("/", "\\").toLowerCase();
  return processes.filter((item) => {
    const commandLine = String(item.commandLine ?? "").trim().replaceAll("/", "\\").toLowerCase();
    return commandLine.endsWith(`"${expectedScript}"`) || commandLine.endsWith(expectedScript);
  });
}

function assertOnlyManagedRunnerProcesses(processes) {
  const managed = managedRunnerProcesses(processes);
  if (managed.length !== processes.length) {
    fail("A different runner/index.mjs process is active; refusing to stop a process this migration does not own.");
  }
  return managed;
}

function stopManagedRunnerProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) fail("The managed Runner process has an invalid PID.");
  const expectedScript = resolve(legacyRunnerBin).replaceAll("/", "\\").toLowerCase();
  runPowerShell(`
    $ErrorActionPreference = 'Stop'
    $item = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue
    if ($null -eq $item) { return }
    $commandLine = ([string]$item.CommandLine).Trim().Replace('/', '\\').ToLowerInvariant()
    $expectedScript = ${powerShellLiteral(expectedScript)}
    if (-not ($commandLine.EndsWith('"' + $expectedScript + '"') -or $commandLine.EndsWith($expectedScript))) {
      throw 'The Runner PID changed ownership before termination.'
    }
    Stop-Process -Id ${pid} -Force -ErrorAction Stop
  `);
}

function restoreLegacyTask(state) {
  if (!state?.exists) return;
  const processes = runnerProcesses();
  const runnerAlreadyRunning = assertOnlyManagedRunnerProcesses(processes).length > 0;
  const shouldRestoreRunning = Boolean(state.running || state.managedProcessRunning);
  runPowerShell(`
    $ErrorActionPreference = 'Stop'
    $task = Get-ScheduledTask -TaskName '${legacyTaskName}' -ErrorAction Stop
    if (${state.enabled ? "$true" : "$false"}) { Enable-ScheduledTask -InputObject $task | Out-Null }
    else { Disable-ScheduledTask -InputObject $task | Out-Null }
    if (${shouldRestoreRunning && !runnerAlreadyRunning ? "$true" : "$false"}) { Start-ScheduledTask -TaskName '${legacyTaskName}' }
  `);
}

function handleTermination(signal) {
  if (handlingSignal) return;
  handlingSignal = true;
  if (!migrationCompleted && existsSync(configPath)) {
    try { rmSync(configPath, { force: true }); }
    catch (error) {
      process.stderr.write(`[Creative Studio migration] WARNING: ${signal} received and the unpublished PC host config could not be removed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  if (!migrationCompleted && rollbackLegacyState) {
    try {
      restoreLegacyTask(rollbackLegacyState);
      process.stderr.write(`[Creative Studio migration] ${signal} received; the legacy Runner task state was restored.\n`);
    } catch (error) {
      process.stderr.write(`[Creative Studio migration] WARNING: ${signal} received and legacy Runner restore failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  process.exit(1);
}

process.once("SIGINT", () => handleTermination("SIGINT"));
process.once("SIGTERM", () => handleTermination("SIGTERM"));
if (process.platform === "win32") process.once("SIGBREAK", () => handleTermination("SIGBREAK"));

async function freezeLegacyWriter(state) {
  const initialProcesses = runnerProcesses();
  const managedProcesses = assertOnlyManagedRunnerProcesses(initialProcesses);
  state.managedProcessRunning = managedProcesses.length > 0;
  if (!state.exists && managedProcesses.length) fail("A Creative Studio Runner process is active without the managed Scheduled Task. Stop it before migration.");
  if (!state.exists) return state;
  const xml = runPowerShell(`Export-ScheduledTask -TaskName '${legacyTaskName}' -ErrorAction Stop`, { capture: true });
  atomicWrite(legacyTaskBackupPath, xml);
  runPowerShell(`
    $ErrorActionPreference = 'Stop'
    $task = Get-ScheduledTask -TaskName '${legacyTaskName}' -ErrorAction Stop
    if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName '${legacyTaskName}' }
    Disable-ScheduledTask -TaskName '${legacyTaskName}' | Out-Null
  `);
  for (const item of managedProcesses) {
    stopManagedRunnerProcess(item.pid);
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const remaining = runnerProcesses();
    assertOnlyManagedRunnerProcesses(remaining);
    if (remaining.length === 0) {
      log("Cloud-polling Runner stopped and disabled for the snapshot window.");
      return state;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  fail("The cloud-polling Runner did not stop cleanly. No snapshot was taken.");
}

function verifyLegacyWriterStillFrozen(initialState) {
  const state = taskState();
  const processes = runnerProcesses();
  if (state.exists !== Boolean(initialState?.exists) || (state.exists && (state.enabled || state.running)) || processes.length) {
    fail("The legacy cloud Runner became enabled or active during migration; the PC host configuration was not published.");
  }
}

async function remoteInventory(token) {
  const items = [];
  let cursor = "";
  do {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects`);
    url.searchParams.set("per_page", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
    const payload = await response.json();
    if (!response.ok || payload?.success !== true || !Array.isArray(payload.result)) fail("Cloudflare R2 inventory failed.");
    items.push(...payload.result);
    cursor = payload.result_info?.is_truncated ? String(payload.result_info.cursor || "") : "";
    if (payload.result_info?.is_truncated && !cursor) fail("Cloudflare returned a truncated R2 inventory without a cursor.");
  } while (cursor);
  return items;
}

function stableValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function deriveLocalD1Import(source) {
  const runnerTablePattern = /^CREATE TABLE creative_runners \(/gm;
  const archiveTablePattern = /^CREATE TABLE creative_archive_catalogs \(/gm;
  const runnerOwnerIndexPattern = /^CREATE UNIQUE INDEX idx_cs_runners_id_owner\r?\n {2}on creative_runners\(id, owner_id\);\r?\n/gm;
  const matches = (pattern) => [...source.matchAll(pattern)];
  const runnerTables = matches(runnerTablePattern);
  const archiveTables = matches(archiveTablePattern);
  const runnerOwnerIndexes = matches(runnerOwnerIndexPattern);
  if (runnerTables.length !== 1 || archiveTables.length !== 1 || runnerOwnerIndexes.length !== 1) {
    fail(`D1 export transform markers drifted (runnerTables=${runnerTables.length}, archiveTables=${archiveTables.length}, runnerOwnerIndexes=${runnerOwnerIndexes.length}).`);
  }
  const runnerTableOffset = runnerTables[0].index;
  const archiveTableOffset = archiveTables[0].index;
  const indexOffset = runnerOwnerIndexes[0].index;
  const statement = runnerOwnerIndexes[0][0];
  if (!Number.isInteger(runnerTableOffset) || !Number.isInteger(archiveTableOffset) || !Number.isInteger(indexOffset)
    || !(runnerTableOffset < archiveTableOffset && archiveTableOffset < indexOffset)) {
    fail("D1 export transform markers are not in the expected source order.");
  }
  const beforeArchive = source.slice(0, archiveTableOffset);
  const betweenArchiveAndIndex = source.slice(archiveTableOffset, indexOffset);
  const afterIndex = source.slice(indexOffset + statement.length);
  const derived = `${beforeArchive}${statement}${betweenArchiveAndIndex}${afterIndex}`;
  const derivedRunnerTables = [...derived.matchAll(runnerTablePattern)];
  const derivedArchiveTables = [...derived.matchAll(archiveTablePattern)];
  const derivedRunnerOwnerIndexes = [...derived.matchAll(runnerOwnerIndexPattern)];
  if (derived.length !== source.length || derived === source || derivedRunnerTables.length !== 1
    || derivedArchiveTables.length !== 1 || derivedRunnerOwnerIndexes.length !== 1
    || !(derivedRunnerTables[0].index < derivedRunnerOwnerIndexes[0].index
      && derivedRunnerOwnerIndexes[0].index < derivedArchiveTables[0].index)) {
    fail("The derived local D1 import did not contain exactly the approved index relocation.");
  }
  const reconstructed = `${beforeArchive}${betweenArchiveAndIndex}${statement}${afterIndex}`;
  if (reconstructed !== source) fail("The derived local D1 transform failed its exact round-trip proof.");
  return {
    content: derived,
    transform: {
      kind: "relocate-existing-index-before-dependent-table",
      statement: "CREATE UNIQUE INDEX idx_cs_runners_id_owner on creative_runners(id, owner_id)",
      sourceOccurrenceCount: runnerOwnerIndexes.length,
      sourceFromByteOffset: Buffer.byteLength(source.slice(0, indexOffset), "utf8"),
      derivedBeforeByteOffset: Buffer.byteLength(source.slice(0, archiveTableOffset), "utf8"),
      beforeMarker: "CREATE TABLE creative_archive_catalogs",
    },
  };
}

function comparableInventory(items) {
  return [...items].sort((left, right) => String(left.key).localeCompare(String(right.key))).map((item) => ({
    key: String(item.key),
    etag: String(item.etag ?? "").replaceAll('"', "").toLowerCase(),
    last_modified: String(item.last_modified ?? ""),
    size: Number(item.size),
    http_metadata: stableValue(normalizeHttpMetadata(item.http_metadata ?? {})),
    custom_metadata: stableValue(item.custom_metadata ?? {}),
    storage_class: String(item.storage_class ?? "Standard"),
  }));
}

function validateInventory(items) {
  const comparable = comparableInventory(items);
  const keys = new Set(comparable.map((item) => item.key));
  const bytes = comparable.reduce((sum, item) => sum + item.size, 0);
  if (comparable.length !== expectedR2Objects || keys.size !== expectedR2Objects || bytes !== expectedR2Bytes) {
    fail(`Production R2 baseline drifted (expected ${expectedR2Objects}/${expectedR2Bytes}, received ${comparable.length}/${bytes}).`);
  }
  for (const item of comparable) {
    if (!item.key || !Number.isSafeInteger(item.size) || item.size <= 0 || !/^[a-f0-9]{32}$/.test(item.etag)
      || !item.last_modified || !Number.isFinite(Date.parse(item.last_modified)) || item.storage_class !== "Standard") {
      fail("Production R2 inventory contains an invalid object record.");
    }
    if (!item.http_metadata || typeof item.http_metadata !== "object" || Array.isArray(item.http_metadata)
      || typeof item.http_metadata.contentType !== "string" || item.http_metadata.contentType.trim().length === 0) {
      fail(`Production R2 object is missing verified HTTP metadata (${item.key}).`);
    }
    if (!item.custom_metadata || typeof item.custom_metadata !== "object" || Array.isArray(item.custom_metadata)
      || Object.keys(item.custom_metadata).length === 0
      || Object.entries(item.custom_metadata).some(([key, value]) => !key || typeof value !== "string")) {
      fail(`Production R2 object is missing verified custom metadata (${item.key}).`);
    }
  }
  return comparable;
}

function objectFile(key) {
  return join(objectRoot, `${createHash("sha256").update(key).digest("hex")}.bin`);
}

function downloadObjectAttempt(item) {
  return new Promise((resolveDownload, reject) => {
    const child = spawn(process.execPath, [wranglerBin, "r2", "object", "get", `${bucketName}/${item.key}`, "--remote", "--file", objectFile(item.key)], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "pipe"],
      env: process.env,
      windowsHide: true,
    });
    let error = "";
    child.stderr.on("data", (chunk) => { error += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => resolveDownload({ code, error }));
  });
}

async function downloadObject(item) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await downloadObjectAttempt(item);
    if (result.code === 0) return;
    const failure = result.error.trim() || `R2 download failed with exit ${result.code}.`;
    if (attempt === 0 && isWranglerAuthenticationError(failure)) {
      log("Wrangler authentication error [code: 10000] during read-only remote R2 download; retrying once.");
      continue;
    }
    throw new Error(failure);
  }
  fail("Read-only remote R2 retry exhausted unexpectedly.");
}

async function downloadAll(items, concurrency = 4) {
  let next = 0;
  let completed = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      await downloadObject(items[index]);
      completed += 1;
      if (completed % 20 === 0 || completed === items.length) log(`Downloaded ${completed}/${items.length} retained objects.`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function verifyDownloads(items) {
  let bytes = 0;
  const receipts = new Map();
  for (const item of items) {
    const path = objectFile(item.key);
    const body = await readFile(path);
    const etag = String(item.etag ?? "").replaceAll('"', "").toLowerCase();
    const md5 = createHash("md5").update(body).digest("hex");
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (body.length !== Number(item.size) || md5 !== etag) fail(`Downloaded R2 object verification failed (${basename(path)}).`);
    receipts.set(String(item.key), { file: basename(path), sha256 });
    bytes += body.length;
  }
  return { bytes, receipts };
}

function normalizeHttpMetadata(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("R2 HTTP metadata is not an object.");
  const normalized = {};
  for (const [sourceKey, sourceValue] of Object.entries(value)) {
    if (sourceValue === null || sourceValue === undefined) continue;
    const key = HTTP_METADATA_KEYS.get(sourceKey);
    if (!key) fail(`R2 HTTP metadata contains unsupported field ${sourceKey}.`);
    const next = key === "cacheExpiry" ? new Date(sourceValue) : String(sourceValue);
    if (key === "cacheExpiry" && !Number.isFinite(next.getTime())) fail("R2 cacheExpiry metadata is invalid.");
    if (key in normalized && stableJson(normalized[key]) !== stableJson(next)) {
      fail(`R2 HTTP metadata contains conflicting aliases for ${key}.`);
    }
    normalized[key] = next;
  }
  return normalized;
}

function normalizeLocalStorageClass(value) {
  // Miniflare does not persist local R2 storage classes and may expose the omitted value as blank.
  // Treating only missing/blank as Standard is safe because validateInventory rejects every non-Standard source.
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return "Standard";
  return value;
}

function localObjectMismatches(local, source) {
  if (!local) return ["object"];
  const sourceEtag = String(source.etag).replaceAll('"', "").toLowerCase();
  const mismatches = [];
  if (local.size !== Number(source.size)) mismatches.push("size");
  if (typeof local.etag !== "string" || local.etag.toLowerCase() !== sourceEtag) mismatches.push("etag");
  if (stableJson(local.httpMetadata ?? {}) !== stableJson(normalizeHttpMetadata(source.http_metadata ?? {}))) mismatches.push("httpMetadata");
  if (stableJson(local.customMetadata ?? {}) !== stableJson(source.custom_metadata ?? {})) mismatches.push("customMetadata");
  if (normalizeLocalStorageClass(local.storageClass) !== String(source.storage_class ?? "Standard")) mismatches.push("storageClass");
  return mismatches;
}

async function importAndVerifyR2(items) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default { async fetch() { return new Response(null, { status: 204 }); } }",
    compatibilityDate: "2026-08-15",
    resourcePersistencePath: join(resolve(stateRoot), "v3"),
    r2Buckets: { ARTIFACTS: bucketName },
  }));
  try {
    const bucket = await mf.getR2Bucket("ARTIFACTS");
    let completed = 0;
    for (const item of items) {
      const body = await readFile(objectFile(item.key));
      await bucket.put(item.key, body, {
        httpMetadata: normalizeHttpMetadata(item.http_metadata ?? {}),
        customMetadata: item.custom_metadata ?? {},
        storageClass: item.storage_class ?? "Standard",
      });
      const local = await bucket.get(item.key);
      const metadataMismatches = localObjectMismatches(local, item);
      if (!local) fail(`Local R2 verification failed (${basename(objectFile(item.key))}; fields=object).`);
      const localBody = Buffer.from(await local.arrayBuffer());
      if (localBody.length !== body.length
        || createHash("md5").update(localBody).digest("hex") !== String(item.etag).replaceAll('"', "").toLowerCase()
        || createHash("sha256").update(localBody).digest("hex") !== createHash("sha256").update(body).digest("hex")) {
        fail(`Local R2 body verification failed (${basename(objectFile(item.key))}).`);
      }
      if (metadataMismatches.length) {
        fail(`Local R2 verification failed (${basename(objectFile(item.key))}; fields=${metadataMismatches.join(",")}).`);
      }
      completed += 1;
      if (completed % 20 === 0 || completed === items.length) log(`Imported ${completed}/${items.length} retained objects.`);
    }
    const listed = [];
    let cursor;
    do {
      const page = await bucket.list({ limit: 1000, include: ["httpMetadata", "customMetadata"], ...(cursor ? { cursor } : {}) });
      listed.push(...page.objects);
      cursor = page.truncated ? page.cursor : undefined;
      if (page.truncated && !cursor) fail("Local R2 listing was truncated without a cursor.");
    } while (cursor);
    const sourceByKey = new Map(items.map((item) => [String(item.key), item]));
    const totalBytes = listed.reduce((sum, item) => sum + Number(item.size), 0);
    if (listed.length !== expectedR2Objects || totalBytes !== expectedR2Bytes || new Set(listed.map((item) => item.key)).size !== expectedR2Objects) {
      fail("Local R2 inventory cardinality does not match the verified cloud snapshot.");
    }
    for (const local of listed) {
      const source = sourceByKey.get(local.key);
      if (!source) fail(`Local R2 inventory contains an unrecognized object (${basename(objectFile(local.key))}).`);
      const listMismatches = localObjectMismatches(local, source).map((field) => `list.${field}`);
      const headMismatches = localObjectMismatches(await bucket.head(local.key), source).map((field) => `head.${field}`);
      const metadataMismatches = [...listMismatches, ...headMismatches];
      if (metadataMismatches.length) {
        fail(`Local R2 inventory metadata does not match (${basename(objectFile(local.key))}; fields=${metadataMismatches.join(",")}).`);
      }
    }
  } finally {
    await mf.dispose();
  }
}

function quotedIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quotedText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function objectReferences() {
  return localRows(`select r2_key as key, size as expectedSize, mime_type as contentType, 'media' as kind from creative_media_assets
    union all select retained_key as key, retained_size as expectedSize, retained_content_type as contentType, 'artifact' as kind from creative_artifacts where retained_key is not null
    union all select thumbnail_key as key, thumbnail_size as expectedSize, thumbnail_content_type as contentType, 'thumbnail' as kind from creative_artifacts where thumbnail_key is not null
    order by key`);
}

function collectClaimable(query) {
  const records = CLAIMABLE_SOURCES.flatMap((source) => query(
    `select ${quotedText(source.source)} as source, id, status from ${source.table} where ${source.where}`,
  ));
  return records
    .map((row) => ({ source: String(row.source), id: String(row.id), status: String(row.status) }))
    .sort((left, right) => left.source.localeCompare(right.source) || left.id.localeCompare(right.id));
}

function executingWork(records) {
  return records.filter((record) => CLAIMABLE_SOURCES
    .find((source) => source.source === record.source)?.executing.has(record.status));
}

function discoverSqliteVerifier() {
  if (sqliteVerifier) {
    const currentHash = createHash("sha256").update(readFileSync(sqliteVerifier.path)).digest("hex");
    if (currentHash !== sqliteVerifier.sha256) fail("The sqlite3 verifier changed during migration.");
    return sqliteVerifier;
  }
  const candidates = [];
  const configured = String(process.env.CS_SQLITE3_PATH ?? "").trim();
  if (configured) candidates.push(configured);
  const where = spawnSync("where.exe", ["sqlite3.exe"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (where.error) throw where.error;
  if (where.status === 0) {
    candidates.push(...String(where.stdout).split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
  } else if (where.status !== 1) {
    fail("sqlite3 verifier discovery failed.");
  }
  const knownCondaPath = join(homedir(), "miniconda3", "Library", "bin", "sqlite3.exe");
  if (existsSync(knownCondaPath)) candidates.push(knownCondaPath);
  const invalid = candidates.filter((candidate) => !isAbsolute(candidate) || basename(candidate).toLowerCase() !== "sqlite3.exe"
    || !existsSync(candidate) || !statSync(candidate).isFile());
  if (invalid.length) fail("sqlite3 verifier discovery returned an invalid executable path.");
  const unique = new Map();
  for (const candidate of candidates) {
    const canonical = realpathSync(candidate);
    unique.set(canonical.toLowerCase(), canonical);
  }
  if (unique.size !== 1) fail(`Expected exactly one sqlite3 verifier, found ${unique.size}.`);
  const path = [...unique.values()][0];
  const versionResult = spawnSync(path, ["-version"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (versionResult.error) throw versionResult.error;
  const versionLines = String(versionResult.stdout).trim().split(/\r?\n/);
  const versionMatch = versionLines.length === 1 ? versionLines[0].match(/^(\d+\.\d+\.\d+)(?:\s+.+)?$/) : null;
  if (versionResult.status !== 0 || String(versionResult.stderr).trim() || !versionMatch) {
    fail("sqlite3 verifier version output was malformed.");
  }
  sqliteVerifier = {
    engine: "sqlite3-cli",
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    version: versionMatch[1],
  };
  return sqliteVerifier;
}

function discoverLocalD1Database() {
  const d1Root = join(stateRoot, "v3", "d1");
  if (!existsSync(d1Root) || !statSync(d1Root).isDirectory()) fail("The fresh local D1 persistence directory is missing.");
  const databases = [];
  const pending = [d1Root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("The fresh local D1 persistence tree contains a symbolic link.");
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".sqlite") && entry.name.toLowerCase() !== "metadata.sqlite") {
        databases.push(realpathSync(path));
      }
    }
  }
  const unique = [...new Set(databases.map((path) => path.toLowerCase()))];
  if (unique.length !== 1) fail(`Expected exactly one non-metadata local D1 database, found ${unique.length}.`);
  const databasePath = databases.find((path) => path.toLowerCase() === unique[0]);
  const relativePath = relative(resolve(stateRoot), databasePath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..\\`) || isAbsolute(relativePath)) {
    fail("The local D1 database resolved outside the fresh migration state.");
  }
  return { path: databasePath, relativePath: relativePath.replaceAll("\\", "/") };
}

function runSqliteReadOnly(verifier, databasePath, sql, description) {
  const result = spawnSync(verifier.path, ["-readonly", "-batch", "-noheader", databasePath, sql], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || String(result.stderr).trim()) fail(`${description} failed.`);
  return String(result.stdout).replaceAll("\r\n", "\n");
}

function verifyLocalIntegrity(label) {
  const verifier = discoverSqliteVerifier();
  const database = discoverLocalD1Database();
  const integrity = runSqliteReadOnly(verifier, database.path, "PRAGMA query_only=ON; PRAGMA integrity_check;", `${label} integrity check`)
    .trim().split("\n").filter(Boolean);
  if (integrity.length !== 1 || integrity[0] !== "ok") fail(`${label} integrity check returned malformed output.`);
  const foreignKeys = runSqliteReadOnly(verifier, database.path, "PRAGMA query_only=ON; PRAGMA foreign_key_check;", `${label} foreign-key check`).trim();
  if (foreignKeys) fail(`${label} foreign-key check found a violation.`);
  const stats = statSync(database.path);
  return {
    label,
    verifier: { ...verifier },
    databasePath: database.path,
    databaseRelativePath: database.relativePath,
    databaseSha256: createHash("sha256").update(readFileSync(database.path)).digest("hex"),
    databaseBytes: stats.size,
    integrity: "ok",
    foreignKeyViolations: 0,
  };
}

function verifyDatabase(items) {
  const integrityVerification = verifyLocalIntegrity("Imported D1");
  const migrations = Number(localRows("select count(*) as count from d1_migrations")[0]?.count ?? -1);
  const tables = localRows("select name from sqlite_schema where type = 'table' and name not like 'sqlite_%' order by name").map((row) => String(row.name));
  const triggers = localRows("select name from sqlite_schema where type = 'trigger' order by name");
  if (migrations !== expectedMigrations || tables.length !== expectedTables || triggers.length !== 0) {
    fail(`Imported D1 schema mismatch (migrations=${migrations}, tables=${tables.length}, triggers=${triggers.length}).`);
  }
  const required = ["creative_projects", "creative_jobs", "creative_artifacts", "creative_media_assets", "creative_runners",
    "creative_archive_catalogs", "creative_archive_sync_batches", "creative_archive_entries", "creative_archive_materializations"];
  if (required.some((name) => !tables.includes(name))) fail("Imported D1 is missing a required Creative Studio table.");
  const archive = localRows(`select
    (select count(*) from creative_archive_catalogs) as catalogs,
    (select count(*) from creative_archive_entries) as entries,
    (select count(*) from creative_archive_sync_batches) as batches,
    (select count(*) from creative_archive_materializations) as materializations`)[0];
  if (Number(archive?.catalogs) !== 1 || Number(archive?.entries) !== 17_353
    || Number(archive?.batches) !== 174 || Number(archive?.materializations) !== 0) {
    fail("Immutable production archive incident evidence does not match the expected inert baseline.");
  }
  const verifier = discoverSqliteVerifier();
  const localDatabase = discoverLocalD1Database();
  const ownerTables = runSqliteReadOnly(verifier, localDatabase.path, `select distinct m.name
    from sqlite_schema m, pragma_table_info(m.name) p
    where m.type = 'table' and p.name = 'owner_id' order by m.name;`, "Owner-scoped table discovery")
    .trim().split("\n").filter(Boolean);
  for (const table of ownerTables) {
    const owners = localRows(`select distinct owner_id as ownerId from ${quotedIdentifier(table)} where owner_id is not null order by owner_id`);
    if (owners.some((row) => row.ownerId !== ownerId)) fail(`Imported D1 contains an unexpected owner in ${table}.`);
  }
  const references = objectReferences();
  const inventory = new Map(items.map((item) => [String(item.key), item]));
  const referenceKeys = new Set(references.map((reference) => String(reference.key)));
  if (references.length !== expectedR2Objects || referenceKeys.size !== expectedR2Objects || inventory.size !== expectedR2Objects) {
    fail("Imported D1/R2 object cardinality does not match.");
  }
  for (const reference of references) {
    const item = inventory.get(String(reference.key));
    if (!item || Number(reference.expectedSize) !== Number(item.size) || String(reference.contentType) !== String(item.http_metadata?.contentType)) {
      fail("Imported D1/R2 object metadata does not match.");
    }
  }
  for (const key of inventory.keys()) if (!referenceKeys.has(key)) fail("The verified R2 snapshot contains an object not referenced by D1.");
  const referenceKinds = Object.fromEntries(["media", "artifact", "thumbnail"].map((kind) => [kind,
    references.filter((reference) => reference.kind === kind).length]));
  if (referenceKinds.media !== 33 || referenceKinds.artifact !== 115 || referenceKinds.thumbnail !== 85) {
    fail("Imported D1/R2 reference categories do not match the verified baseline.");
  }
  const tableCounts = Object.fromEntries(tables.map((table) => {
    if (table.startsWith("_cf_")) {
      const value = runSqliteReadOnly(verifier, localDatabase.path,
        `select count(*) from ${quotedIdentifier(table)};`, `Internal table count (${table})`).trim();
      if (!/^\d+$/.test(value)) fail(`Internal table count was malformed (${table}).`);
      return [table, Number(value)];
    }
    return [table, Number(localRows(`select count(*) as count from ${quotedIdentifier(table)}`)[0]?.count ?? -1)];
  }));
  return { migrations, tables: tables.length, triggers: triggers.length, archive, ownerTables, references: references.length, referenceKinds, tableCounts, integrityVerification };
}

function quarantineImportedWork(cutoverAt, claimable) {
  const reason = "cloud_to_pc_cutover_quarantined";
  const quotedTime = quotedText(cutoverAt);
  const ids = (source) => {
    const matching = claimable.filter((item) => item.source === source).map((item) => quotedText(item.id));
    return matching.length ? `id in (${matching.join(",")})` : "0";
  };
  const statements = [
    `update creative_jobs set status='cancelled', error='${reason}', execution_stage='cancelled', runner_id=null, runner_lease_until=null, reconcile_lease_until=null, next_reconcile_at=null, stage_updated_at=${quotedTime}, cancelled_at=coalesce(cancelled_at,${quotedTime}), completed_at=coalesce(completed_at,${quotedTime}), updated_at=${quotedTime} where ${ids("generation")}`,
    `update creative_dna_training_jobs set status='cancelled', error='${reason}', runner_id=null, runner_lease_until=null, completed_at=coalesce(completed_at,${quotedTime}), updated_at=${quotedTime} where ${ids("dna-training")}`,
    `delete from creative_dna_training_evidence_reservations where exists (select 1 from creative_dna_training_jobs j where j.id=training_job_id and j.status='cancelled' and j.error='${reason}')`,
    `update creative_model_training_jobs set status='cancelled', stage='cancelled', error='${reason}', runner_id=null, runner_lease_until=null, completed_at=coalesce(completed_at,${quotedTime}), updated_at=${quotedTime} where ${ids("model-training")}`,
    `update creative_prompt_enhancements set status='failed', error='${reason}', runner_id=null, runner_lease_until=null, completed_at=coalesce(completed_at,${quotedTime}), updated_at=${quotedTime} where ${ids("prompt-enhancement")}`,
    `update creative_video_script_drafts set status='failed', error='${reason}', runner_id=null, runner_lease_until=null, completed_at=coalesce(completed_at,${quotedTime}), updated_at=${quotedTime} where ${ids("video-script")}`,
    `update creative_story_refreshes set status='failed', error='${reason}', runner_id=null, runner_lease_until=null, completed_at=coalesce(completed_at,${quotedTime}), updated_at=${quotedTime} where ${ids("story-refresh")}`,
    `update creative_overnight_sessions set status='cancelled', error='${reason}', runner_id=null, runner_lease_until=null, completed_at=coalesce(completed_at,${quotedTime}), updated_at=${quotedTime} where ${ids("overnight-session")}`,
    `update creative_overnight_tasks set status='cancelled', error='${reason}', updated_at=${quotedTime} where ${ids("overnight-task")}`,
    `update creative_love_loops set status='paused', last_error='${reason}', updated_at=${quotedTime} where ${ids("love-loop")}`,
    `update creative_love_loop_drops set status='cancelled', error='${reason}', updated_at=${quotedTime} where ${ids("love-loop-drop")}`,
    `update creative_generation_batches set status='cancelled', last_error='${reason}', next_attempt_at=null, reconcile_lease_until=null, completed_at=coalesce(completed_at,${quotedTime}), updated_at=${quotedTime} where ${ids("generation-batch")}`,
    `update creative_archive_materializations set status='failed', error='${reason}', claim_token=null, runner_lease_until=null, completed_at=coalesce(completed_at,${quotedTime}), updated_at=${quotedTime} where ${ids("archive-materialization")}`,
  ];
  atomicWrite(quarantineSqlPath, `${statements.join(";\n")};\n`);
  localFile(quarantineSqlPath);
  const remaining = collectClaimable(localRows);
  if (remaining.length) fail("Imported claimable work remained after the cutover quarantine.");
  if (claimable.length) log(`Quarantined ${claimable.length} inherited work item(s) in the local copy only; cloud rows remain unchanged.`);
}

function legacyRunnerSettings() {
  if (!existsSync(legacyRunnerConfigPath)) return { comfyUrl: "http://127.0.0.1:8188" };
  let parsed;
  try { parsed = JSON.parse(readFileSync(legacyRunnerConfigPath, "utf8").replace(/^\uFEFF/, "")); }
  catch { fail("The legacy Runner config is invalid JSON."); }
  const comfyUrl = String(parsed.comfyUrl || "http://127.0.0.1:8188");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(comfyUrl)) fail("The Runner ComfyUI URL is not loopback-only.");
  const result = { comfyUrl };
  if (parsed.comfyLogPath) {
    if (!isAbsolute(String(parsed.comfyLogPath))) fail("The Runner ComfyUI log path is not absolute.");
    result.comfyLogPath = String(parsed.comfyLogPath);
  }
  return result;
}

function enrollFreshLocalRunner(cutoverAt) {
  const runnerId = `runner_pc_${randomUUID().replaceAll("-", "")}`;
  const token = `csr_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const time = cutoverAt.replaceAll("'", "''");
  localRows(`update creative_runners set revoked_at=coalesce(revoked_at,'${time}'), active_job_id=null;
    insert into creative_runners (id,owner_id,name,token_hash,created_at) values ('${runnerId}','${ownerId}','Creative Studio PC Host','${tokenHash}','${time}')`);
  const active = localRows("select id, owner_id as ownerId from creative_runners where revoked_at is null order by id");
  if (active.length !== 1 || active[0].id !== runnerId || active[0].ownerId !== ownerId) fail("Fresh local Runner enrollment did not verify.");
  if (localRows("select id from creative_runners where active_job_id is not null limit 1").length) {
    fail("A migrated Runner retained an active job after local quarantine.");
  }
  const integrityVerification = verifyLocalIntegrity("Final local D1");
  const runtime = legacyRunnerSettings();
  return {
    runnerId,
    config: { apiBase: "http://127.0.0.1:8787", token, ...runtime, pollIntervalMs: 5_000 },
    integrityVerification,
  };
}

async function main() {
  if (!existsSync(wranglerBin)) fail("Run npm install before migration.");
  if (existsSync(configPath)) fail(`PC host is already configured at ${configPath}. Refusing to overwrite it.`);
  if (existsSync(backupRoot) || existsSync(stateRoot)) fail("The timestamped migration destination already exists; refusing to merge state.");
  mkdirSync(objectRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  protect(hostRoot, true);
  let legacyState = null;
  let completed = false;
  try {
    legacyState = taskState();
    rollbackLegacyState = legacyState;
    const preFreezeClaimable = collectClaimable(remoteRows);
    const preFreezeExecuting = executingWork(preFreezeClaimable);
    if (preFreezeExecuting.length) {
      fail(`Cloud work is currently executing; the Runner was not interrupted (${preFreezeExecuting.map((item) => `${item.source}:${item.id}`).join(", ")}).`);
    }
    await freezeLegacyWriter(legacyState);
    const sourceClaimable = collectClaimable(remoteRows);
    const executing = executingWork(sourceClaimable);
    if (executing.length) fail(`Cloud work is still executing after the Runner freeze (${executing.map((item) => `${item.source}:${item.id}`).join(", ")}).`);
    log(`Cloud writer freeze verified; ${sourceClaimable.length} inherited claimable item(s) will be quarantined only in the local copy.`);

    log("Taking production D1 snapshot A (read-only cloud operation).");
    runReadOnlyRemoteNode(
      [wranglerBin, "d1", "export", databaseId, "--remote", "--skip-confirmation", "--output", d1ExportAPath],
      { operation: "read-only remote D1 export" },
    );
    protect(d1ExportAPath);
    const d1HashA = createHash("sha256").update(readFileSync(d1ExportAPath)).digest("hex");

    let token = oauthToken();
    let inventoryA;
    let inventoryB;
    try {
      inventoryA = validateInventory(await remoteInventory(token));
      atomicWrite(inventoryAPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), accountId, bucketName, items: inventoryA }, null, 2)}\n`);
      log(`Downloading ${inventoryA.length} production R2 objects without modifying the bucket.`);
      await downloadAll(inventoryA);
      inventoryB = validateInventory(await remoteInventory(token));
    } finally {
      token = "";
    }
    if (stableJson(inventoryA) !== stableJson(inventoryB)) fail("Production R2 changed during migration; the local import was not started.");
    atomicWrite(inventoryBPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), accountId, bucketName, items: inventoryB }, null, 2)}\n`);
    const downloads = await verifyDownloads(inventoryA);
    const verifiedItems = inventoryA.map((item) => ({ ...item, ...downloads.receipts.get(item.key) }));
    atomicWrite(verifiedInventoryPath, `${JSON.stringify({ verifiedAt: new Date().toISOString(), accountId, bucketName, items: verifiedItems }, null, 2)}\n`);

    log("Taking production D1 snapshot B after the media copy (read-only cloud operation).");
    runReadOnlyRemoteNode(
      [wranglerBin, "d1", "export", databaseId, "--remote", "--skip-confirmation", "--output", d1ExportBPath],
      { operation: "read-only remote D1 export" },
    );
    protect(d1ExportBPath);
    const d1HashB = createHash("sha256").update(readFileSync(d1ExportBPath)).digest("hex");
    if (d1HashA !== d1HashB) fail("Production D1 changed during migration; the local import was not started.");

    const derivedImport = deriveLocalD1Import(readFileSync(d1ExportBPath, "utf8"));
    atomicWrite(d1DerivedImportPath, derivedImport.content);
    const derivedImportHash = createHash("sha256").update(readFileSync(d1DerivedImportPath)).digest("hex");
    if (derivedImportHash === d1HashB
      || createHash("sha256").update(readFileSync(d1ExportAPath)).digest("hex") !== d1HashA
      || createHash("sha256").update(readFileSync(d1ExportBPath)).digest("hex") !== d1HashB) {
      fail("The protected local D1 derivation did not preserve the exact cloud export snapshots.");
    }

    log("Importing a protected local-only D1 derivation with the exported Runner owner index relocated before its dependent archive table.");
    localFile(d1DerivedImportPath);
    const database = verifyDatabase(inventoryA);
    const importedClaimable = collectClaimable(localRows);
    if (stableJson(importedClaimable) !== stableJson(sourceClaimable)) fail("Imported claimable-work state does not match the frozen cloud snapshot.");
    const cutoverAt = new Date().toISOString();
    quarantineImportedWork(cutoverAt, importedClaimable);
    const localRunner = enrollFreshLocalRunner(cutoverAt);

    log("Importing R2 bytes plus HTTP metadata, custom metadata, and storage class into local storage.");
    await importAndVerifyR2(inventoryA);
    atomicWrite(runnerConfigPath, `${JSON.stringify(localRunner.config, null, 2)}\n`);
    verifyLegacyWriterStillFrozen(legacyState);
    const receipt = {
      schemaVersion: "creative-studio-cloud-to-pc-migration/2.0",
      completedAt: new Date().toISOString(),
      source: { d1Database: databaseName, d1DatabaseId: databaseId, r2Bucket: bucketName, ownerId },
      destination: { stateRoot, runnerId: localRunner.runnerId },
      writerFreeze: { taskName: legacyTaskName, initialState: legacyState, preservedTaskXml: legacyState?.exists ? legacyTaskBackupPath : null },
      d1: {
        snapshotA: { file: d1ExportAPath, sha256: d1HashA },
        snapshotB: { file: d1ExportBPath, sha256: d1HashB },
        derivedLocalImport: {
          file: d1DerivedImportPath,
          sha256: derivedImportHash,
          sourceSnapshot: "snapshotB",
          sourceSha256: d1HashB,
          transform: derivedImport.transform,
        },
        stable: true,
        migrations: database.migrations,
        tables: database.tables,
        triggers: database.triggers,
        tableCounts: database.tableCounts,
        integrityVerification: {
          imported: database.integrityVerification,
          final: localRunner.integrityVerification,
        },
        immutableArchiveEvidence: database.archive,
        inheritedWorkQuarantinedLocally: importedClaimable,
      },
      r2: {
        inventoryA: inventoryAPath,
        inventoryB: inventoryBPath,
        verifiedInventory: verifiedInventoryPath,
        verifiedInventorySha256: createHash("sha256").update(readFileSync(verifiedInventoryPath)).digest("hex"),
        objects: inventoryA.length,
        bytes: downloads.bytes,
        referencedObjects: database.references,
        referenceKinds: database.referenceKinds,
        stable: true,
      },
      preservation: {
        cloudWritesPerformed: false,
        cloudDataDeleted: false,
        priorRepoLocalStateModified: false,
        keysBodiesEtagsHttpCustomMetadataAndStorageClassPreserved: true,
        originalLastModifiedPreservedInInventoryReceipt: true,
        originalLastModifiedRecreatedLocally: false,
      },
    };
    atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const config = {
      schemaVersion: "creative-studio-pc-host/1.0",
      ownerId,
      displayName: "Angelo",
      accessEmail: ownerAccessEmail,
      publicHostname: "cs.angelotoborg.com",
      archiveRoot: "D:\\CreativeArchive",
      stateRoot,
      runnerConfigPath,
      internalToken: newHostSecret(),
      sessionSecret: newHostSecret(),
      migratedAt: receipt.completedAt,
      sourceBackup: backupRoot,
      migrationReceipt: receiptPath,
    };
    atomicWrite(configPath, `${JSON.stringify(config, null, 2)}\n`);
    protect(hostRoot, true);
    completed = true;
    migrationCompleted = true;
    rollbackLegacyState = null;
    log(`Migration verified: ${database.tableCounts.creative_projects} projects, ${database.tableCounts.creative_jobs} jobs, ${inventoryA.length} objects (${downloads.bytes} bytes).`);
    log(`Cloud data remains untouched. Receipt: ${receiptPath}`);
    log("The legacy cloud Runner remains disabled. Install the verified PC host before reopening generation.");
  } finally {
    if (!completed && legacyState) {
      try {
        restoreLegacyTask(legacyState);
        rollbackLegacyState = null;
        log("Migration did not complete; the legacy Runner task state was restored automatically.");
      } catch (restoreError) {
        process.stderr.write(`[Creative Studio migration] WARNING: automatic legacy Runner restore failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}\n`);
      }
    }
    if (!completed && existsSync(configPath)) rmSync(configPath, { force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`[Creative Studio migration] ${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(`[Creative Studio migration] Failed artifacts, if any, remain isolated under ${backupRoot}; no cloud data was deleted.\n`);
  process.exitCode = 1;
});
