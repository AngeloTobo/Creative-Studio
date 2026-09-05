import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const CHECKPOINT_SCHEMA = "creative-studio-local-d1-checkpoint/1.0";
const CHECKPOINT_FILE = "checkpoint.json";
const BACKUP_FILE = "database.sqlite";
const STARTED_FILE = "migration-started.json";
const SUCCEEDED_FILE = "migration-succeeded.json";
const RESTORED_FILE = "migration-restored.json";
const LOCAL_D1_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

function fail(message) {
  throw new Error(message);
}

function pathInside(root, candidate) {
  const child = relative(resolve(root), resolve(candidate));
  return child === "" || (!child.startsWith("..\\") && !child.startsWith("../") && child !== ".." && !isAbsolute(child));
}

function safeRelativePath(value) {
  const normalized = String(value ?? "").replaceAll("/", "\\");
  return Boolean(normalized) && !isAbsolute(normalized) && normalized !== ".." && !normalized.startsWith("..\\");
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function stableValue(value) {
  if (typeof value === "bigint") return { bigint: value.toString() };
  if (ArrayBuffer.isView(value)) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return { bytes: bytes.toString("base64") };
  }
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

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function hashFrame(hash, label, value) {
  const labelBytes = Buffer.from(String(label), "utf8");
  const valueBytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  hash.update(`${labelBytes.length}:`);
  hash.update(labelBytes);
  hash.update(`${valueBytes.length}:`);
  hash.update(valueBytes);
}

function hashSqlValue(hash, value) {
  if (value === null) {
    hashFrame(hash, "null", "");
    return;
  }
  if (typeof value === "bigint") {
    hashFrame(hash, "integer", value.toString());
    return;
  }
  if (typeof value === "number") {
    hashFrame(hash, "real", Object.is(value, -0) ? "-0" : String(value));
    return;
  }
  if (typeof value === "string") {
    hashFrame(hash, "text", value);
    return;
  }
  if (ArrayBuffer.isView(value)) {
    hashFrame(hash, "blob", Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    return;
  }
  fail("SQLite returned an unsupported value while fingerprinting the pinned database.");
}

function firstValue(row) {
  if (!row || typeof row !== "object") return undefined;
  return Object.values(row)[0];
}

function logicalFingerprint(database) {
  const hash = createHash("sha256");
  const schema = database.prepare(`
    select type, name, tbl_name, sql
    from sqlite_schema
    where type in ('table', 'index', 'view', 'trigger')
    order by type, name, tbl_name, sql
  `).all();
  hashFrame(hash, "schema", stableJson(schema));
  const tables = schema.filter((entry) => entry.type === "table").map((entry) => String(entry.name));
  let rows = 0;
  for (const table of tables) {
    const columns = database.prepare(`PRAGMA table_xinfo(${quoteSql(table)})`).all();
    if (!columns.length || columns.some((column) => typeof column.name !== "string" || !column.name)) {
      fail("SQLite returned malformed table metadata while fingerprinting the pinned database.");
    }
    hashFrame(hash, "table", table);
    hashFrame(hash, "columns", stableJson(columns));
    const names = columns.map((column) => String(column.name));
    const selection = names.map(quoteIdentifier).join(", ");
    const ordering = [...columns]
      .sort((left, right) => Number(left.pk || Number.MAX_SAFE_INTEGER) - Number(right.pk || Number.MAX_SAFE_INTEGER)
        || Number(left.cid) - Number(right.cid))
      .map((column) => quoteIdentifier(column.name)).join(", ");
    const statement = database.prepare(`select ${selection} from ${quoteIdentifier(table)} order by ${ordering}`);
    statement.setReadBigInts(true);
    for (const row of statement.iterate()) {
      hashFrame(hash, "row", table);
      for (const name of names) hashSqlValue(hash, row[name]);
      rows += 1;
    }
  }
  return { sha256: hash.digest("hex"), tables: tables.length, rows };
}

function inspectConnection(database, { fingerprint = true } = {}) {
  database.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;");
  const integrityRows = database.prepare("PRAGMA integrity_check").all();
  if (integrityRows.length !== 1 || firstValue(integrityRows[0]) !== "ok") {
    fail("The pinned local D1 database failed SQLite integrity_check.");
  }
  const foreignKeyRows = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyRows.length !== 0) fail("The pinned local D1 database failed SQLite foreign_key_check.");
  const sqliteVersion = String(firstValue(database.prepare("select sqlite_version()").get()) ?? "");
  if (!/^\d+\.\d+\.\d+$/.test(sqliteVersion)) fail("SQLite returned a malformed verifier version.");
  const pageCount = Number(firstValue(database.prepare("PRAGMA page_count").get()));
  const pageSize = Number(firstValue(database.prepare("PRAGMA page_size").get()));
  const schemaVersion = Number(firstValue(database.prepare("PRAGMA schema_version").get()));
  const userVersion = Number(firstValue(database.prepare("PRAGMA user_version").get()));
  const journalMode = String(firstValue(database.prepare("PRAGMA journal_mode").get()) ?? "");
  if (![pageCount, pageSize, schemaVersion, userVersion].every(Number.isSafeInteger)
    || pageCount <= 0 || pageSize <= 0 || !journalMode) fail("SQLite returned malformed database metadata.");
  return {
    verifier: { engine: "node:sqlite", nodeVersion: process.version, sqliteVersion },
    integrity: "ok",
    foreignKeyViolations: 0,
    pageCount,
    pageSize,
    schemaVersion,
    userVersion,
    journalMode,
    ...(fingerprint ? { logical: logicalFingerprint(database) } : {}),
  };
}

function openReadOnlyDatabase(path) {
  const database = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: false });
  database.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;");
  return database;
}

function normalizeStandaloneDatabase(path) {
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  let checkpoint;
  try {
    database.exec("PRAGMA busy_timeout=5000;");
    checkpoint = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  } finally {
    database.close();
  }
  const busy = Number(checkpoint?.busy);
  const logFrames = Number(checkpoint?.log);
  const checkpointedFrames = Number(checkpoint?.checkpointed);
  if (![busy, logFrames, checkpointedFrames].every(Number.isSafeInteger) || busy !== 0 || logFrames !== 0) {
    fail("SQLite could not normalize the recovery database into a standalone checkpoint.");
  }
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${path}${suffix}`;
    if (!existsSync(sidecar)) continue;
    if (lstatSync(sidecar).isSymbolicLink() || !statSync(sidecar).isFile()) {
      fail("A SQLite recovery sidecar is invalid.");
    }
    if (suffix === "-wal" && statSync(sidecar).size !== 0) {
      fail("SQLite left uncheckpointed WAL frames beside the recovery database.");
    }
    rmSync(sidecar, { force: true });
  }
  return { busy, logFrames, checkpointedFrames, standalone: true };
}

function assertNoWalFrames(path) {
  const walPath = `${path}-wal`;
  if (existsSync(walPath) && (lstatSync(walPath).isSymbolicLink() || !statSync(walPath).isFile() || statSync(walPath).size !== 0)) {
    fail("The verified recovery database depends on unrecorded WAL frames.");
  }
}

export function discoverPinnedD1Database(stateRoot) {
  if (!isAbsolute(String(stateRoot ?? "")) || !existsSync(stateRoot) || !statSync(stateRoot).isDirectory()) {
    fail("The pinned local state root is missing or invalid.");
  }
  const resolvedState = realpathSync(stateRoot);
  const d1Root = join(resolvedState, "v3", "d1");
  if (!existsSync(d1Root) || lstatSync(d1Root).isSymbolicLink() || !statSync(d1Root).isDirectory()) {
    fail("The pinned local D1 persistence directory is missing or invalid.");
  }
  const databases = [];
  const pending = [d1Root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail("The pinned local D1 persistence tree contains a symbolic link.");
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".sqlite") && entry.name.toLowerCase() !== "metadata.sqlite") {
        databases.push(realpathSync(path));
      }
    }
  }
  const unique = new Map(databases.map((path) => [process.platform === "win32" ? path.toLowerCase() : path, path]));
  if (unique.size !== 1) fail(`Expected exactly one non-metadata pinned local D1 database, found ${unique.size}.`);
  const path = [...unique.values()][0];
  if (!pathInside(resolvedState, path)) fail("The pinned local D1 database resolved outside its state root.");
  const relativePath = relative(resolvedState, path);
  if (!safeRelativePath(relativePath)) fail("The pinned local D1 database path is invalid.");
  return { path, relativePath: relativePath.replaceAll("\\", "/") };
}

export function verifyPinnedWranglerD1Binding(configPath, databaseName = "creative-studio") {
  if (!isAbsolute(String(configPath ?? "")) || !existsSync(configPath)
    || lstatSync(configPath).isSymbolicLink() || !statSync(configPath).isFile()) {
    fail("The local Wrangler configuration is missing or invalid.");
  }
  let config;
  try { config = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")); }
  catch { fail("The local Wrangler configuration is malformed."); }
  const bindings = config?.d1_databases;
  if (config?.name !== "creative-studio" || !Array.isArray(bindings) || bindings.length !== 1) {
    fail("The local Wrangler D1 binding set drifted from the pinned PC host.");
  }
  const binding = bindings[0];
  if (binding?.binding !== "DB" || binding.database_name !== databaseName
    || binding.database_id !== LOCAL_D1_DATABASE_ID || binding.migrations_dir !== "migrations") {
    fail("The local Wrangler D1 binding tuple drifted from the pinned PC host.");
  }
  return {
    binding: binding.binding,
    databaseName: binding.database_name,
    databaseId: binding.database_id,
    migrationsDirectory: binding.migrations_dir,
  };
}

export function verifyPinnedD1Database(databasePath, options = {}) {
  if (!isAbsolute(String(databasePath ?? "")) || !existsSync(databasePath)
    || lstatSync(databasePath).isSymbolicLink() || !statSync(databasePath).isFile()) {
    fail("The pinned local D1 database file is missing or invalid.");
  }
  const path = realpathSync(databasePath);
  const database = openReadOnlyDatabase(path);
  try {
    const verification = inspectConnection(database, options);
    const stats = statSync(path);
    return {
      ...verification,
      mainFileBytes: stats.size,
      mainFileSha256: hashFile(path),
    };
  } finally {
    database.close();
  }
}

function migrationPlan(databasePath, migrationsRoot) {
  if (!isAbsolute(String(migrationsRoot ?? "")) || !existsSync(migrationsRoot)
    || lstatSync(migrationsRoot).isSymbolicLink() || !statSync(migrationsRoot).isDirectory()) {
    fail("The local migration directory is missing or invalid.");
  }
  const files = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.name.toLowerCase().endsWith(".sql"))
    .map((entry) => {
      if (entry.isSymbolicLink() || !entry.isFile() || !/^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name)) {
        fail("The local migration directory contains an invalid SQL migration entry.");
      }
      const path = join(migrationsRoot, entry.name);
      return { name: entry.name, sha256: hashFile(path) };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!files.length || new Set(files.map((file) => file.name)).size !== files.length) {
    fail("The local migration set is empty or ambiguous.");
  }
  const database = openReadOnlyDatabase(databasePath);
  let applied;
  try {
    const migrationTable = database.prepare("select name from sqlite_schema where type = 'table' and name = 'd1_migrations'").all();
    if (migrationTable.length !== 1) fail("The pinned local D1 migration ledger is missing.");
    applied = database.prepare("select name from d1_migrations order by id").all().map((row) => String(row.name ?? ""));
  } finally {
    database.close();
  }
  if (applied.some((name) => !name) || new Set(applied).size !== applied.length || applied.length > files.length
    || applied.some((name, index) => name !== files[index]?.name)) {
    fail("The pinned local D1 migration ledger is not an exact prefix of this checkout.");
  }
  return {
    applied,
    pending: files.slice(applied.length),
    files,
    sha256: createHash("sha256").update(stableJson(files)).digest("hex"),
  };
}

function writeProtectedJson(path, value, protectPath) {
  if (existsSync(path)) fail("A local D1 recovery evidence file already exists.");
  const temporaryPath = join(dirname(path), `.pending-${basename(path)}-${randomUUID()}`);
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  protectPath(temporaryPath);
  renameSync(temporaryPath, path);
}

function checkpointDirectories(recoveryRoot) {
  if (!existsSync(recoveryRoot)) return [];
  if (lstatSync(recoveryRoot).isSymbolicLink() || !statSync(recoveryRoot).isDirectory()) {
    fail("The local D1 recovery root is invalid.");
  }
  const resolvedRecovery = realpathSync(recoveryRoot);
  const directories = [];
  for (const entry of readdirSync(resolvedRecovery, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail("The local D1 recovery root contains a symbolic link.");
    if (entry.isDirectory() && entry.name.startsWith("checkpoint-")) directories.push(join(resolvedRecovery, entry.name));
  }
  return directories.sort();
}

function markerExists(directory, name) {
  const path = join(directory, name);
  if (!existsSync(path)) return false;
  if (lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) fail("A local D1 recovery marker is invalid.");
  return true;
}

function verifyMarker(directory, name, checkpointId, timestampField) {
  const path = join(directory, name);
  let marker;
  try { marker = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")); }
  catch { fail("A local D1 recovery marker is malformed."); }
  if (marker?.schemaVersion !== CHECKPOINT_SCHEMA || marker.checkpointId !== checkpointId
    || !Number.isFinite(Date.parse(String(marker[timestampField] ?? "")))) {
    fail("A local D1 recovery marker does not match its checkpoint.");
  }
  if (name === RESTORED_FILE && !["interrupted-startup", "migration-failure"].includes(marker.reason)) {
    fail("A local D1 recovery marker has an invalid restore reason.");
  }
  return marker;
}

function loadCheckpoint(directory, stateRoot, recoveryRoot) {
  if (!pathInside(recoveryRoot, directory) || basename(directory).startsWith("checkpoint-") === false
    || lstatSync(directory).isSymbolicLink() || !statSync(directory).isDirectory()) {
    fail("The local D1 checkpoint directory is invalid.");
  }
  const evidencePath = join(directory, CHECKPOINT_FILE);
  if (!existsSync(evidencePath) || lstatSync(evidencePath).isSymbolicLink() || !statSync(evidencePath).isFile()) {
    fail("The local D1 checkpoint evidence is missing or invalid.");
  }
  let evidence;
  try { evidence = JSON.parse(readFileSync(evidencePath, "utf8").replace(/^\uFEFF/, "")); }
  catch { fail("The local D1 checkpoint evidence is malformed."); }
  const checkpointId = basename(directory);
  if (evidence?.schemaVersion !== CHECKPOINT_SCHEMA || evidence.checkpointId !== checkpointId
    || resolve(String(evidence.stateRoot ?? "")) !== resolve(stateRoot)
    || !safeRelativePath(evidence.databaseRelativePath)
    || evidence.backup?.file !== BACKUP_FILE
    || !/^[a-f0-9]{64}$/.test(String(evidence.backup?.fileSha256 ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(evidence.source?.logical?.sha256 ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(evidence.backup?.logical?.sha256 ?? ""))) {
    fail("The local D1 checkpoint evidence does not match this pinned state.");
  }
  const databasePath = resolve(stateRoot, evidence.databaseRelativePath);
  const backupPath = join(directory, BACKUP_FILE);
  if (!pathInside(stateRoot, databasePath) || !pathInside(directory, backupPath)
    || !existsSync(backupPath) || lstatSync(backupPath).isSymbolicLink() || !statSync(backupPath).isFile()) {
    fail("The local D1 checkpoint backup is missing or outside its protected boundary.");
  }
  return { directory, evidencePath, databasePath, backupPath, evidence };
}

async function restoreCheckpoint(checkpoint, protectPath, reason) {
  if (!["interrupted-startup", "migration-failure"].includes(reason)) fail("The local D1 restore reason is invalid.");
  if (hashFile(checkpoint.backupPath) !== checkpoint.evidence.backup.fileSha256) {
    fail("The local D1 recovery backup hash does not match its checkpoint evidence.");
  }
  const backupVerification = verifyPinnedD1Database(checkpoint.backupPath);
  if (backupVerification.logical.sha256 !== checkpoint.evidence.backup.logical.sha256) {
    fail("The local D1 recovery backup content does not match its checkpoint evidence.");
  }
  const current = discoverPinnedD1Database(checkpoint.evidence.stateRoot);
  if (current.relativePath !== checkpoint.evidence.databaseRelativePath
    || resolve(current.path) !== resolve(checkpoint.databasePath)) {
    fail("The pinned local D1 database path changed before checkpoint restore.");
  }
  const source = openReadOnlyDatabase(checkpoint.backupPath);
  try {
    await sqliteBackup(source, checkpoint.databasePath, { rate: 256 });
  } finally {
    source.close();
  }
  normalizeStandaloneDatabase(checkpoint.databasePath);
  const restored = verifyPinnedD1Database(checkpoint.databasePath);
  assertNoWalFrames(checkpoint.databasePath);
  if (restored.logical.sha256 !== checkpoint.evidence.source.logical.sha256) {
    fail("The restored local D1 database does not match the pre-migration checkpoint.");
  }
  writeProtectedJson(join(checkpoint.directory, RESTORED_FILE), {
    schemaVersion: CHECKPOINT_SCHEMA,
    checkpointId: checkpoint.evidence.checkpointId,
    restoredAt: new Date().toISOString(),
    reason,
    database: restored,
  }, protectPath);
  return restored;
}

async function recoverInterruptedCheckpoint({ stateRoot, recoveryRoot, protectPath, log }) {
  const unresolved = [];
  for (const directory of checkpointDirectories(recoveryRoot)) {
    const started = markerExists(directory, STARTED_FILE);
    const succeeded = markerExists(directory, SUCCEEDED_FILE);
    const restored = markerExists(directory, RESTORED_FILE);
    if ((succeeded || restored) && !started) fail("A local D1 checkpoint has a terminal marker without a start marker.");
    if (succeeded && restored) fail("A local D1 checkpoint has conflicting terminal markers.");
    if (started || succeeded || restored) {
      const checkpoint = loadCheckpoint(directory, stateRoot, recoveryRoot);
      if (started) verifyMarker(directory, STARTED_FILE, checkpoint.evidence.checkpointId, "startedAt");
      if (succeeded) verifyMarker(directory, SUCCEEDED_FILE, checkpoint.evidence.checkpointId, "succeededAt");
      if (restored) verifyMarker(directory, RESTORED_FILE, checkpoint.evidence.checkpointId, "restoredAt");
      if (!succeeded && !restored) unresolved.push(checkpoint);
    }
  }
  if (unresolved.length > 1) fail("Multiple unfinished local D1 migrations require manual recovery.");
  if (!unresolved.length) return null;
  log("An interrupted local migration was detected; restoring its verified checkpoint before startup.");
  const restored = await restoreCheckpoint(unresolved[0], protectPath, "interrupted-startup");
  log("The interrupted local migration was restored; migration planning will restart from the verified pre-update state.");
  return restored;
}

function assertFailedPlanIsNotRepeating({ stateRoot, recoveryRoot, database, plan }) {
  let currentVerification = null;
  for (const directory of checkpointDirectories(recoveryRoot)) {
    if (!markerExists(directory, RESTORED_FILE)) continue;
    const checkpoint = loadCheckpoint(directory, stateRoot, recoveryRoot);
    const restored = verifyMarker(directory, RESTORED_FILE, checkpoint.evidence.checkpointId, "restoredAt");
    if (restored.reason !== "migration-failure"
      || checkpoint.evidence.migrations?.setSha256 !== plan.sha256
      || stableJson(checkpoint.evidence.migrations?.pending) !== stableJson(plan.pending)) continue;
    currentVerification ??= verifyPinnedD1Database(database.path);
    if (currentVerification.logical.sha256 === checkpoint.evidence.source.logical.sha256) {
      fail("This exact local migration plan already failed and was restored; refusing automatic retry until the migration bytes or pinned source state change.");
    }
  }
}

async function createCheckpoint({ stateRoot, recoveryRoot, migrations, database, protectPath, now }) {
  mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
  protectPath(recoveryRoot);
  const createdAt = now().toISOString();
  const stamp = createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const checkpointId = `checkpoint-${stamp}-${randomUUID()}`;
  const candidate = join(recoveryRoot, `.candidate-${checkpointId}`);
  const directory = join(recoveryRoot, checkpointId);
  if (!pathInside(recoveryRoot, candidate) || !pathInside(recoveryRoot, directory)
    || existsSync(candidate) || existsSync(directory)) fail("The local D1 checkpoint destination is unsafe or already exists.");
  mkdirSync(candidate, { mode: 0o700 });
  protectPath(candidate);
  const backupPath = join(candidate, BACKUP_FILE);
  const source = openReadOnlyDatabase(database.path);
  let sourceVerification;
  let pagesCopied;
  try {
    source.exec("BEGIN");
    sourceVerification = inspectConnection(source);
    pagesCopied = await sqliteBackup(source, backupPath, { rate: 256 });
    source.exec("COMMIT");
  } catch (error) {
    try { source.exec("ROLLBACK"); } catch { /* read transaction may already be closed */ }
    throw error;
  } finally {
    source.close();
  }
  const backupCheckpoint = normalizeStandaloneDatabase(backupPath);
  protectPath(backupPath);
  const backupVerification = verifyPinnedD1Database(backupPath);
  assertNoWalFrames(backupPath);
  if (!Number.isSafeInteger(pagesCopied) || pagesCopied <= 0
    || backupVerification.logical.sha256 !== sourceVerification.logical.sha256) {
    fail("The local D1 backup did not reproduce the verified source snapshot.");
  }
  const evidence = {
    schemaVersion: CHECKPOINT_SCHEMA,
    checkpointId,
    createdAt,
    stateRoot: resolve(stateRoot),
    databaseRelativePath: database.relativePath,
    migrations: {
      root: resolve(migrations.root),
      setSha256: migrations.sha256,
      applied: migrations.applied,
      pending: migrations.pending,
    },
    source: sourceVerification,
    backup: {
      file: BACKUP_FILE,
      fileSha256: backupVerification.mainFileSha256,
      bytes: backupVerification.mainFileBytes,
      pagesCopied,
      sqliteCheckpoint: backupCheckpoint,
      logical: backupVerification.logical,
      integrity: backupVerification.integrity,
      foreignKeyViolations: backupVerification.foreignKeyViolations,
      verifier: backupVerification.verifier,
    },
  };
  writeProtectedJson(join(candidate, CHECKPOINT_FILE), evidence, protectPath);
  renameSync(candidate, directory);
  return loadCheckpoint(directory, stateRoot, recoveryRoot);
}

function markerPayload(checkpoint, field) {
  return {
    schemaVersion: CHECKPOINT_SCHEMA,
    checkpointId: checkpoint.evidence.checkpointId,
    [field]: new Date().toISOString(),
  };
}

export async function runProtectedLocalD1Migrations({
  stateRoot,
  hostRoot,
  recoveryRoot,
  migrationsRoot,
  expectedDatabaseRelativePath,
  applyMigrations,
  protectPath = () => {},
  log = () => {},
  now = () => new Date(),
}) {
  if (![stateRoot, hostRoot, recoveryRoot, migrationsRoot].every((value) => isAbsolute(String(value ?? "")))
    || !pathInside(hostRoot, stateRoot) || !pathInside(hostRoot, recoveryRoot) || pathInside(stateRoot, recoveryRoot)
    || !safeRelativePath(expectedDatabaseRelativePath)
    || typeof applyMigrations !== "function" || typeof protectPath !== "function" || typeof log !== "function") {
    fail("The local D1 migration protection boundary is invalid.");
  }
  await recoverInterruptedCheckpoint({ stateRoot, recoveryRoot, protectPath, log });
  const database = discoverPinnedD1Database(stateRoot);
  if (database.relativePath !== String(expectedDatabaseRelativePath).replaceAll("\\", "/")) {
    fail("The local D1 database does not match the exact path pinned by the migration receipt.");
  }
  const preflight = verifyPinnedD1Database(database.path, { fingerprint: false });
  const plan = migrationPlan(database.path, migrationsRoot);
  const migrations = { ...plan, root: migrationsRoot };
  assertFailedPlanIsNotRepeating({ stateRoot, recoveryRoot, database, plan });
  if (!plan.pending.length) {
    return { status: "up-to-date", database: { ...database, verification: preflight }, pending: [] };
  }
  const checkpoint = await createCheckpoint({ stateRoot, recoveryRoot, migrations, database, protectPath, now });
  writeProtectedJson(join(checkpoint.directory, STARTED_FILE), markerPayload(checkpoint, "startedAt"), protectPath);
  log(`Verified local D1 checkpoint ${checkpoint.evidence.checkpointId}; applying ${plan.pending.length} pending migration(s).`);
  try {
    await applyMigrations();
    const current = discoverPinnedD1Database(stateRoot);
    if (current.relativePath !== database.relativePath) fail("The local D1 database path changed during migration.");
    const postVerification = verifyPinnedD1Database(current.path);
    const postPlan = migrationPlan(current.path, migrationsRoot);
    if (postPlan.sha256 !== plan.sha256 || postPlan.pending.length !== 0
      || postPlan.applied.length !== postPlan.files.length) {
      fail("The local D1 migration set did not finish exactly as checkpointed.");
    }
    writeProtectedJson(join(checkpoint.directory, SUCCEEDED_FILE), {
      ...markerPayload(checkpoint, "succeededAt"),
      migrationsApplied: plan.pending.map((migration) => migration.name),
      database: postVerification,
    }, protectPath);
    log(`Local migrations and SQLite integrity verified; recovery checkpoint ${checkpoint.evidence.checkpointId} was retained.`);
    return {
      status: "migrated",
      checkpointId: checkpoint.evidence.checkpointId,
      checkpointDirectory: checkpoint.directory,
      migrationsApplied: plan.pending.map((migration) => migration.name),
      database: { ...current, verification: postVerification },
    };
  } catch (migrationError) {
    log("Local migration or post-migration integrity verification failed; restoring the verified checkpoint.");
    try {
      await restoreCheckpoint(checkpoint, protectPath, "migration-failure");
    } catch (restoreError) {
      throw new AggregateError(
        [migrationError, restoreError],
        `Local migration failed and automatic restore could not be verified. The protected checkpoint remains at ${checkpoint.directory}.`,
        { cause: restoreError },
      );
    }
    throw new Error(
      `Local migration failed; the pinned database was restored and verified from checkpoint ${checkpoint.evidence.checkpointId}.`,
      { cause: migrationError },
    );
  }
}
