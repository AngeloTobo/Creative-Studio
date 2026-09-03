import {
  ARCHIVE_CATALOG_SCHEMA_VERSION,
  ARCHIVE_INDEX_PROVIDER,
  ARCHIVE_MATERIALIZATION_SCHEMA_VERSION,
  ARCHIVE_SYNC_BATCH_LIMIT,
  ARCHIVE_SYNC_SCHEMA_VERSION,
  type ArchiveCatalog,
  type ArchiveCatalogSyncEntry,
  type ArchiveEntry,
  type ArchiveEntryPage,
  type ArchiveEntryQuery,
  type ArchiveMaterialization,
  type ArchiveMaterializationBlockReason,
  type ArchiveMaterializationResponse,
  type CompleteArchiveCatalogSyncRequest,
  type CreateArchiveMaterializationRequest,
  type FailArchiveMaterializationRequest,
  type PutArchiveCatalogEntriesRequest,
  type RunnerArchiveIndexObservation,
  type RunnerArchiveMaterializationBundle,
  type RunnerArchiveSyncBundle,
  type StartArchiveCatalogSyncRequest,
} from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import { MAX_MEDIA_UPLOAD_BYTES } from "./media";
import { mediaAssetById, projectById } from "./repository";
import type { RunnerIdentity } from "./runner";
import type { Env } from "./types";

type CatalogRow = {
  id: string;
  runnerId: string;
  provider: typeof ARCHIVE_INDEX_PROVIDER;
  schemaVersion: typeof ARCHIVE_CATALOG_SCHEMA_VERSION;
  sourceVersion: string;
  sourceFingerprint: string;
  status: ArchiveCatalog["status"];
  expectedEntryCount: number;
  expectedVerifiedCount: number;
  expectedUnavailableCount: number;
  receivedEntryCount: number;
  materializableEntryCount: number;
  createdAt: string;
  publishedAt: string | null;
};

type EntryRow = {
  id: string;
  catalogId: string;
  sourceRecordType: string;
  sourceRecordId: string;
  inventoryRecordId: string | null;
  displayName: string;
  sortName: string;
  extension: string;
  mediaKind: ArchiveEntry["mediaKind"];
  mimeType: string | null;
  technicalCategory: string;
  workBucket: string;
  archiveDisposition: string;
  observedYear: number | null;
  size: number;
  sourceStatus: string;
  verificationStatus: ArchiveEntry["verificationStatus"];
  materializable: number;
  materializationBlockReason: ArchiveMaterializationBlockReason;
  recordFingerprint?: string;
};

type MaterializationRow = {
  id: string;
  catalogId: string;
  entryId: string;
  projectId: string;
  runnerId: string;
  status: ArchiveMaterialization["status"];
  trainingEligible: number;
  mediaAssetId: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type MaterializationRequestRow = MaterializationRow & { idempotencyKey: string };

type MaterializationClaimRow = MaterializationRow & EntryRow & {
  sourceVersion: string;
  sourceFingerprint: string;
  claimToken: string | null;
  runnerLeaseUntil: string | null;
  r2Key: string;
};

const CATALOG_COLUMNS = `c.id, c.runner_id as runnerId, c.provider, c.schema_version as schemaVersion,
  c.source_version as sourceVersion, c.source_fingerprint as sourceFingerprint, c.status,
  c.expected_entry_count as expectedEntryCount, c.expected_verified_count as expectedVerifiedCount,
  c.expected_unavailable_count as expectedUnavailableCount, c.received_entry_count as receivedEntryCount,
  c.materializable_entry_count as materializableEntryCount, c.created_at as createdAt, c.published_at as publishedAt`;

const ENTRY_COLUMNS = `e.id, e.catalog_id as catalogId, e.source_record_type as sourceRecordType,
  e.source_record_id as sourceRecordId, e.inventory_record_id as inventoryRecordId, e.display_name as displayName,
  e.sort_name as sortName, e.extension, e.media_kind as mediaKind, e.mime_type as mimeType,
  e.technical_category as technicalCategory, e.work_bucket as workBucket,
  e.archive_disposition as archiveDisposition, e.observed_year as observedYear, e.size, e.source_status as sourceStatus,
  e.verification_status as verificationStatus, e.materializable,
  e.materialization_block_reason as materializationBlockReason`;

const MATERIALIZATION_COLUMNS = `m.id, m.catalog_id as catalogId, m.entry_id as entryId, m.project_id as projectId,
  m.runner_id as runnerId, m.status, m.training_eligible as trainingEligible, m.media_asset_id as mediaAssetId,
  m.error, m.created_at as createdAt, m.updated_at as updatedAt, m.started_at as startedAt,
  m.completed_at as completedAt`;

const IMAGE_BY_EXTENSION: Record<string, { kind: "image"; mimeType: string }> = {
  ".jpg": { kind: "image", mimeType: "image/jpeg" },
  ".jpeg": { kind: "image", mimeType: "image/jpeg" },
  ".png": { kind: "image", mimeType: "image/png" },
  ".webp": { kind: "image", mimeType: "image/webp" },
  ".gif": { kind: "image", mimeType: "image/gif" },
};

const START_KEYS = new Set(["schemaVersion", "sourceVersion", "sourceFingerprint", "expectedEntryCount", "expectedVerifiedCount", "expectedUnavailableCount"]);
const BATCH_KEYS = new Set(["schemaVersion", "batchKey", "entries"]);
const ENTRY_KEYS = new Set(["sourceRecordType", "sourceRecordId", "inventoryRecordId", "displayName", "extension", "technicalCategory", "workBucket", "archiveDisposition", "observedYear", "size", "sourceStatus", "verificationStatus"]);
const COMPLETE_KEYS = new Set(["schemaVersion"]);
const MATERIALIZATION_KEYS = new Set(["projectId", "idempotencyKey", "trainingEligible"]);
const FAIL_KEYS = new Set(["error"]);

function record(value: unknown, error = "invalid_archive_request") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, error: string) {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(error);
}

function integer(value: unknown, minimum: number, maximum: number, error: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(error);
  return result;
}

function safeIdentifier(value: unknown, maximum: number, error: string) {
  const result = boundedText(value, maximum);
  if (!result || !/^[a-z0-9_.:-]+$/i.test(result)) throw new Error(error);
  return result;
}

function hasAbsolutePath(value: string) {
  return value.includes("\\") || /(?:^|\s)(?:[a-z]:[\\/]|\\\\|\/[^/\s]+\/|file:\/\/)/i.test(value)
    || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value);
}

function safeMetadata(value: unknown, maximum: number, error: string, leaf = false) {
  const result = boundedText(value, maximum);
  const hasControlCharacter = [...result].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  if (!result || hasControlCharacter || hasAbsolutePath(result) || (leaf && /[\\/]/.test(result))) throw new Error(error);
  return result;
}

function safeOptionalIdentifier(value: unknown, maximum: number, error: string) {
  if (value === undefined || value === null || value === "") return null;
  return safeIdentifier(value, maximum, error);
}

function catalogFromRow(row: CatalogRow): ArchiveCatalog {
  return {
    ...row,
    schemaVersion: ARCHIVE_CATALOG_SCHEMA_VERSION,
    provider: ARCHIVE_INDEX_PROVIDER,
    expectedEntryCount: Number(row.expectedEntryCount),
    expectedVerifiedCount: Number(row.expectedVerifiedCount),
    expectedUnavailableCount: Number(row.expectedUnavailableCount),
    receivedEntryCount: Number(row.receivedEntryCount),
    materializableEntryCount: Number(row.materializableEntryCount),
  };
}

function entryFromRow(row: EntryRow): ArchiveEntry {
  return {
    id: row.id,
    catalogId: row.catalogId,
    sourceRecordType: row.sourceRecordType,
    sourceRecordId: row.sourceRecordId,
    inventoryRecordId: row.inventoryRecordId,
    displayName: row.displayName,
    extension: row.extension,
    mediaKind: row.mediaKind,
    mimeType: row.mimeType,
    technicalCategory: row.technicalCategory,
    workBucket: row.workBucket,
    archiveDisposition: row.archiveDisposition,
    observedYear: row.observedYear === null ? null : Number(row.observedYear),
    size: Number(row.size),
    sourceStatus: row.sourceStatus,
    verificationStatus: row.verificationStatus,
    materializable: Boolean(row.materializable),
    materializationBlockReason: row.materializationBlockReason,
  };
}

function materializationFromRow(row: MaterializationRow): ArchiveMaterialization {
  return {
    schemaVersion: ARCHIVE_MATERIALIZATION_SCHEMA_VERSION,
    id: row.id,
    catalogId: row.catalogId,
    entryId: row.entryId,
    projectId: row.projectId,
    runnerId: row.runnerId,
    status: row.status,
    trainingEligible: Boolean(row.trainingEligible),
    mediaAssetId: row.status === "completed" ? row.mediaAssetId : null,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeReviewMarker(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function reviewOnly(entry: Pick<ArchiveCatalogSyncEntry, "technicalCategory" | "workBucket" | "archiveDisposition" | "sourceStatus">) {
  const marker = normalizeReviewMarker([entry.technicalCategory, entry.workBucket, entry.archiveDisposition, entry.sourceStatus].join(" "));
  return marker.includes("PARK_UNRESOLVED") || marker.includes("PARKED_ARCHAEOLOGY")
    || marker.includes("99_UNRESOLVED") || marker.includes("REVIEW_REQUIRED")
    || marker.includes("BLOCKED_TECHNICAL");
}

function parseStart(value: unknown): StartArchiveCatalogSyncRequest {
  const input = record(value, "invalid_archive_sync_request");
  exactKeys(input, START_KEYS, "invalid_archive_sync_request");
  if (input.schemaVersion !== ARCHIVE_SYNC_SCHEMA_VERSION) throw new Error("invalid_archive_sync_schema");
  const expectedEntryCount = integer(input.expectedEntryCount, 1, 100_000, "invalid_archive_sync_counts");
  const expectedVerifiedCount = integer(input.expectedVerifiedCount, 0, expectedEntryCount, "invalid_archive_sync_counts");
  const expectedUnavailableCount = integer(input.expectedUnavailableCount, 0, expectedEntryCount, "invalid_archive_sync_counts");
  if (expectedVerifiedCount + expectedUnavailableCount !== expectedEntryCount) throw new Error("invalid_archive_sync_counts");
  const sourceVersion = safeMetadata(input.sourceVersion, 120, "invalid_archive_source_version");
  const sourceFingerprint = String(input.sourceFingerprint ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sourceFingerprint)) throw new Error("invalid_archive_source_fingerprint");
  return { schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION, sourceVersion, sourceFingerprint, expectedEntryCount, expectedVerifiedCount, expectedUnavailableCount };
}

function parseObservation(value: RunnerArchiveIndexObservation): Extract<RunnerArchiveIndexObservation, { state: "ready" }> | null {
  const input = record(value, "invalid_archive_index_observation");
  if (input.state === "unavailable") {
    exactKeys(input, new Set(["schemaVersion", "state", "error"]), "invalid_archive_index_observation");
    if (input.schemaVersion !== ARCHIVE_SYNC_SCHEMA_VERSION) throw new Error("invalid_archive_index_observation");
    return null;
  }
  exactKeys(input, new Set(["schemaVersion", "state", "sourceVersion", "sourceFingerprint", "expectedEntryCount", "expectedVerifiedCount", "expectedUnavailableCount"]), "invalid_archive_index_observation");
  return {
    ...parseStart({
      schemaVersion: input.schemaVersion,
      sourceVersion: input.sourceVersion,
      sourceFingerprint: input.sourceFingerprint,
      expectedEntryCount: input.expectedEntryCount,
      expectedVerifiedCount: input.expectedVerifiedCount,
      expectedUnavailableCount: input.expectedUnavailableCount,
    }),
    state: "ready",
  };
}

function parseEntry(value: unknown): ArchiveCatalogSyncEntry & {
  mediaKind: "image" | null;
  mimeType: string | null;
  materializable: boolean;
  materializationBlockReason: ArchiveMaterializationBlockReason;
} {
  const input = record(value, "invalid_archive_entry");
  exactKeys(input, ENTRY_KEYS, "invalid_archive_entry");
  const sourceRecordType = safeIdentifier(input.sourceRecordType, 64, "invalid_archive_entry");
  const sourceRecordId = safeIdentifier(input.sourceRecordId, 160, "invalid_archive_entry");
  const inventoryRecordId = safeOptionalIdentifier(input.inventoryRecordId, 160, "invalid_archive_entry");
  const displayName = safeMetadata(input.displayName, 240, "invalid_archive_entry", true);
  const extension = String(input.extension ?? "").trim().toLowerCase();
  if (extension && !/^\.[a-z0-9]{1,20}$/.test(extension)) throw new Error("invalid_archive_entry");
  const technicalCategory = safeMetadata(input.technicalCategory, 160, "invalid_archive_entry");
  const workBucket = safeMetadata(input.workBucket, 160, "invalid_archive_entry");
  const archiveDisposition = safeMetadata(input.archiveDisposition, 160, "invalid_archive_entry");
  const observedYear = input.observedYear === undefined || input.observedYear === null || input.observedYear === ""
    ? null : integer(input.observedYear, 1900, 2100, "invalid_archive_entry");
  const size = integer(input.size, 0, Number.MAX_SAFE_INTEGER, "invalid_archive_entry");
  const sourceStatus = safeMetadata(input.sourceStatus, 120, "invalid_archive_entry");
  if (input.verificationStatus !== "size-match" && input.verificationStatus !== "unavailable") throw new Error("invalid_archive_entry");
  const verificationStatus = input.verificationStatus;
  const media = IMAGE_BY_EXTENSION[extension] ?? null;
  const reviewRequired = reviewOnly({ technicalCategory, workBucket, archiveDisposition, sourceStatus });
  const materializationBlockReason: ArchiveMaterializationBlockReason = verificationStatus === "unavailable"
    ? "unavailable" : reviewRequired ? "review-required" : !media ? "unsupported-media"
      : size === 0 ? "empty-media" : size > MAX_MEDIA_UPLOAD_BYTES ? "media-too-large" : null;
  return {
    sourceRecordType, sourceRecordId, inventoryRecordId, displayName, extension, technicalCategory, workBucket,
    archiveDisposition, observedYear, size, sourceStatus, verificationStatus,
    mediaKind: media?.kind ?? null, mimeType: media?.mimeType ?? null,
    materializable: materializationBlockReason === null, materializationBlockReason,
  };
}

function parseBatch(value: unknown) {
  const input = record(value, "invalid_archive_sync_batch");
  exactKeys(input, BATCH_KEYS, "invalid_archive_sync_batch");
  if (input.schemaVersion !== ARCHIVE_SYNC_SCHEMA_VERSION) throw new Error("invalid_archive_sync_schema");
  const batchKey = safeIdentifier(input.batchKey, 100, "invalid_archive_sync_batch");
  if (batchKey.length < 8) throw new Error("invalid_archive_sync_batch");
  if (!Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > ARCHIVE_SYNC_BATCH_LIMIT) {
    throw new Error("invalid_archive_sync_batch");
  }
  const entries = input.entries.map(parseEntry);
  const keys = new Set(entries.map((entry) => `${entry.sourceRecordType}\0${entry.sourceRecordId}`));
  if (keys.size !== entries.length) throw new Error("archive_sync_entry_conflict");
  return { schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION, batchKey, entries } satisfies PutArchiveCatalogEntriesRequest & { entries: ReturnType<typeof parseEntry>[] };
}

function parseComplete(value: unknown): CompleteArchiveCatalogSyncRequest {
  const input = record(value, "invalid_archive_sync_request");
  exactKeys(input, COMPLETE_KEYS, "invalid_archive_sync_request");
  if (input.schemaVersion !== ARCHIVE_SYNC_SCHEMA_VERSION) throw new Error("invalid_archive_sync_schema");
  return { schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION };
}

async function catalogById(env: Env, ownerId: string, catalogId: string) {
  const row = await env.DB.prepare(`select ${CATALOG_COLUMNS} from creative_archive_catalogs c where c.id = ? and c.owner_id = ?`)
    .bind(catalogId, ownerId).first<CatalogRow>();
  return row ? catalogFromRow(row) : null;
}

async function activeCatalog(env: Env, ownerId: string) {
  const row = await env.DB.prepare(`select ${CATALOG_COLUMNS} from creative_archive_catalogs c
    where c.owner_id = ? and c.provider = ? and c.status = 'active' limit 1`)
    .bind(ownerId, ARCHIVE_INDEX_PROVIDER).first<CatalogRow>();
  return row ? catalogFromRow(row) : null;
}

async function latestCatalog(env: Env, ownerId: string) {
  const row = await env.DB.prepare(`select ${CATALOG_COLUMNS} from creative_archive_catalogs c
    where c.owner_id = ? and c.provider = ? order by c.created_at desc, c.id desc limit 1`)
    .bind(ownerId, ARCHIVE_INDEX_PROVIDER).first<CatalogRow>();
  return row ? catalogFromRow(row) : null;
}

function sameCatalogSource(catalog: ArchiveCatalog, input: StartArchiveCatalogSyncRequest) {
  return catalog.sourceVersion === input.sourceVersion && catalog.sourceFingerprint === input.sourceFingerprint
    && catalog.expectedEntryCount === input.expectedEntryCount && catalog.expectedVerifiedCount === input.expectedVerifiedCount
    && catalog.expectedUnavailableCount === input.expectedUnavailableCount;
}

export async function archiveIndexStatus(env: Env, ownerId: string) {
  const [active, latestSync] = await Promise.all([activeCatalog(env, ownerId), latestCatalog(env, ownerId)]);
  return { activeCatalog: active, latestSync };
}

export async function archiveSyncWork(
  env: Env,
  runner: RunnerIdentity,
  observationValue: RunnerArchiveIndexObservation | undefined,
): Promise<RunnerArchiveSyncBundle | null> {
  if (!observationValue) return null;
  const observation = parseObservation(observationValue);
  if (!observation) return null;
  const [active, stagingRow] = await Promise.all([
    activeCatalog(env, runner.ownerId),
    env.DB.prepare(`select ${CATALOG_COLUMNS} from creative_archive_catalogs c where c.owner_id = ? and c.runner_id = ?
      and c.provider = ? and c.status = 'staging' and c.source_fingerprint = ? order by c.created_at desc, c.id desc limit 1`)
      .bind(runner.ownerId, runner.id, ARCHIVE_INDEX_PROVIDER, observation.sourceFingerprint).first<CatalogRow>(),
  ]);
  const staging = stagingRow ? catalogFromRow(stagingRow) : null;
  if (active && active.runnerId === runner.id && sameCatalogSource(active, observation)) return null;
  return {
    schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION,
    reason: staging && sameCatalogSource(staging, observation) ? "sync-incomplete"
      : active && sameCatalogSource(active, observation) ? "sync-requested"
        : active ? "catalog-stale" : "catalog-missing",
    observation,
    activeCatalog: active,
    syncCatalog: staging && sameCatalogSource(staging, observation) ? staging : null,
    maxBatchSize: ARCHIVE_SYNC_BATCH_LIMIT,
  };
}

export async function startArchiveCatalogSync(env: Env, runner: RunnerIdentity, value: unknown) {
  const input = parseStart(value);
  const existingRow = await env.DB.prepare(`select ${CATALOG_COLUMNS} from creative_archive_catalogs c
    where c.owner_id = ? and c.runner_id = ? and c.provider = ? and c.source_fingerprint = ?
      and c.status in ('staging', 'active') order by c.created_at desc, c.id desc limit 1`)
    .bind(runner.ownerId, runner.id, ARCHIVE_INDEX_PROVIDER, input.sourceFingerprint).first<CatalogRow>();
  if (existingRow) {
    const existing = catalogFromRow(existingRow);
    if (!sameCatalogSource(existing, input)) throw new Error("archive_sync_source_conflict");
    return existing;
  }
  const catalogId = id("archivecatalog");
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(`update creative_archive_catalogs set status = 'failed' where owner_id = ? and runner_id = ?
        and provider = ? and status = 'staging'`).bind(runner.ownerId, runner.id, ARCHIVE_INDEX_PROVIDER),
      env.DB.prepare(`insert into creative_archive_catalogs (
        id, owner_id, runner_id, provider, schema_version, source_version, source_fingerprint, status,
        expected_entry_count, expected_verified_count, expected_unavailable_count, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, 'staging', ?, ?, ?, ?)`)
        .bind(catalogId, runner.ownerId, runner.id, ARCHIVE_INDEX_PROVIDER, ARCHIVE_CATALOG_SCHEMA_VERSION,
          input.sourceVersion, input.sourceFingerprint, input.expectedEntryCount, input.expectedVerifiedCount,
          input.expectedUnavailableCount, now),
    ]);
  } catch {
    const racedRow = await env.DB.prepare(`select ${CATALOG_COLUMNS} from creative_archive_catalogs c
      where c.owner_id = ? and c.runner_id = ? and c.provider = ? and c.source_fingerprint = ?
        and c.status in ('staging', 'active') order by c.created_at desc, c.id desc limit 1`)
      .bind(runner.ownerId, runner.id, ARCHIVE_INDEX_PROVIDER, input.sourceFingerprint).first<CatalogRow>();
    if (!racedRow || !sameCatalogSource(catalogFromRow(racedRow), input)) throw new Error("archive_sync_source_conflict");
    return catalogFromRow(racedRow);
  }
  const catalog = await catalogById(env, runner.ownerId, catalogId);
  if (!catalog) throw new Error("archive_catalog_not_found");
  return catalog;
}

export async function putArchiveCatalogEntries(env: Env, runner: RunnerIdentity, catalogId: string, value: unknown) {
  const input = parseBatch(value);
  const catalog = await catalogById(env, runner.ownerId, catalogId);
  if (!catalog) throw new Error("archive_catalog_not_found");
  if (catalog.runnerId !== runner.id || catalog.status !== "staging") throw new Error("archive_sync_not_writable");
  const payloadFingerprint = await sha256(JSON.stringify(input.entries));
  const existing = await env.DB.prepare(`select payload_fingerprint as payloadFingerprint, entry_count as entryCount
    from creative_archive_sync_batches where catalog_id = ? and owner_id = ? and batch_key = ?`)
    .bind(catalogId, runner.ownerId, input.batchKey).first<{ payloadFingerprint: string; entryCount: number }>();
  if (existing) {
    if (existing.payloadFingerprint !== payloadFingerprint || Number(existing.entryCount) !== input.entries.length) {
      throw new Error("archive_sync_batch_conflict");
    }
    return (await catalogById(env, runner.ownerId, catalogId))!;
  }
  const now = new Date().toISOString();
  const entryRows = await Promise.all(input.entries.map(async (entry) => ({
    id: `archiveentry_${(await sha256(`${catalogId}\0${entry.sourceRecordType}\0${entry.sourceRecordId}`)).slice(0, 20)}`,
    sourceRecordType: entry.sourceRecordType,
    sourceRecordId: entry.sourceRecordId,
    inventoryRecordId: entry.inventoryRecordId,
    displayName: entry.displayName,
    sortName: entry.displayName.toLowerCase(),
    extension: entry.extension,
    mediaKind: entry.mediaKind,
    mimeType: entry.mimeType,
    technicalCategory: entry.technicalCategory,
    workBucket: entry.workBucket,
    archiveDisposition: entry.archiveDisposition,
    observedYear: entry.observedYear,
    size: entry.size,
    sourceStatus: entry.sourceStatus,
    verificationStatus: entry.verificationStatus,
    materializable: entry.materializable ? 1 : 0,
    materializationBlockReason: entry.materializationBlockReason,
    recordFingerprint: await sha256(JSON.stringify(entry)),
  })));
  const statements = [
    env.DB.prepare(`insert into creative_archive_sync_batches (
      catalog_id, owner_id, batch_key, payload_fingerprint, entry_count, created_at
    ) values (?, ?, ?, ?, ?, ?)`).bind(catalogId, runner.ownerId, input.batchKey, payloadFingerprint, input.entries.length, now),
    env.DB.prepare(`insert into creative_archive_entries (
      id, owner_id, catalog_id, source_record_type, source_record_id, inventory_record_id, display_name, sort_name,
      extension, media_kind, mime_type, technical_category, work_bucket, archive_disposition, observed_year, size,
      source_status, verification_status, materializable, materialization_block_reason, record_fingerprint, created_at
    ) select json_extract(value, '$.id'), ?, ?, json_extract(value, '$.sourceRecordType'),
      json_extract(value, '$.sourceRecordId'), json_extract(value, '$.inventoryRecordId'),
      json_extract(value, '$.displayName'), json_extract(value, '$.sortName'), json_extract(value, '$.extension'),
      json_extract(value, '$.mediaKind'), json_extract(value, '$.mimeType'), json_extract(value, '$.technicalCategory'),
      json_extract(value, '$.workBucket'), json_extract(value, '$.archiveDisposition'), json_extract(value, '$.observedYear'),
      json_extract(value, '$.size'), json_extract(value, '$.sourceStatus'), json_extract(value, '$.verificationStatus'),
      json_extract(value, '$.materializable'), json_extract(value, '$.materializationBlockReason'),
      json_extract(value, '$.recordFingerprint'), ? from json_each(?)`)
      .bind(runner.ownerId, catalogId, now, JSON.stringify(entryRows)),
    env.DB.prepare(`update creative_archive_catalogs set received_entry_count = received_entry_count + ?,
      materializable_entry_count = materializable_entry_count + ?
      where id = ? and owner_id = ? and runner_id = ? and status = 'staging'`)
      .bind(input.entries.length, input.entries.filter((entry) => entry.materializable).length,
        catalogId, runner.ownerId, runner.id),
  ];
  try {
    await env.DB.batch(statements);
  } catch {
    const raced = await env.DB.prepare(`select payload_fingerprint as payloadFingerprint, entry_count as entryCount
      from creative_archive_sync_batches where catalog_id = ? and owner_id = ? and batch_key = ?`)
      .bind(catalogId, runner.ownerId, input.batchKey).first<{ payloadFingerprint: string; entryCount: number }>();
    if (raced?.payloadFingerprint === payloadFingerprint && Number(raced.entryCount) === input.entries.length) {
      return (await catalogById(env, runner.ownerId, catalogId))!;
    }
    const current = await catalogById(env, runner.ownerId, catalogId);
    if (!current || current.runnerId !== runner.id || current.status !== "staging") throw new Error("archive_sync_not_writable");
    await env.DB.prepare(`update creative_archive_catalogs set status = 'failed'
      where id = ? and owner_id = ? and runner_id = ? and status = 'staging'`)
      .bind(catalogId, runner.ownerId, runner.id).run();
    throw new Error(raced ? "archive_sync_batch_conflict" : "archive_sync_entry_conflict");
  }
  return (await catalogById(env, runner.ownerId, catalogId))!;
}

export async function completeArchiveCatalogSync(env: Env, runner: RunnerIdentity, catalogId: string, value: unknown) {
  parseComplete(value);
  const catalog = await catalogById(env, runner.ownerId, catalogId);
  if (!catalog) throw new Error("archive_catalog_not_found");
  if (catalog.runnerId !== runner.id || (catalog.status !== "staging" && catalog.status !== "active")) {
    throw new Error("archive_sync_not_completable");
  }
  const counts = await env.DB.prepare(`select count(*) as total,
    sum(case when verification_status = 'size-match' then 1 else 0 end) as verified,
    sum(case when verification_status = 'unavailable' then 1 else 0 end) as unavailable
    from creative_archive_entries where catalog_id = ? and owner_id = ?`)
    .bind(catalogId, runner.ownerId).first<{ total: number; verified: number | null; unavailable: number | null }>();
  if (!counts || Number(counts.total) !== catalog.expectedEntryCount || Number(counts.verified ?? 0) !== catalog.expectedVerifiedCount
    || Number(counts.unavailable ?? 0) !== catalog.expectedUnavailableCount) {
    throw new Error("archive_sync_count_mismatch");
  }
  if (catalog.status === "staging") {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`update creative_archive_catalogs set status = 'replaced'
        where owner_id = ? and provider = ? and status = 'active' and id != ?`)
        .bind(runner.ownerId, ARCHIVE_INDEX_PROVIDER, catalogId),
      env.DB.prepare(`update creative_archive_catalogs set status = 'active', published_at = ?
        where id = ? and owner_id = ? and runner_id = ? and status = 'staging'`)
        .bind(now, catalogId, runner.ownerId, runner.id),
    ]);
  }
  const completed = await catalogById(env, runner.ownerId, catalogId);
  if (!completed || completed.status !== "active") throw new Error("archive_sync_not_completable");
  return completed;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function listArchiveEntries(env: Env, ownerId: string, query: ArchiveEntryQuery = {}): Promise<ArchiveEntryPage> {
  const limit = query.limit === undefined ? 50 : integer(query.limit, 1, 100, "invalid_archive_entry_limit");
  const catalog = query.cursor?.catalogId
    ? await catalogById(env, ownerId, safeIdentifier(query.cursor.catalogId, 100, "invalid_archive_entry_cursor"))
    : await activeCatalog(env, ownerId);
  if (!catalog) return { catalog: null, entries: [], nextCursor: null, hasMore: false, total: 0 };
  const conditions = ["e.owner_id = ?", "e.catalog_id = ?"];
  const bindings: unknown[] = [ownerId, catalog.id];
  const search = boundedText(query.search, 120);
  if (search) {
    conditions.push("e.display_name like ? escape '\\' collate nocase");
    bindings.push(`%${escapeLike(search)}%`);
  }
  if (query.mediaKind !== undefined && query.mediaKind !== null) {
    if (query.mediaKind !== "image" && query.mediaKind !== "audio" && query.mediaKind !== "video") throw new Error("invalid_archive_entry_filter");
    conditions.push("e.media_kind = ?");
    bindings.push(query.mediaKind);
  }
  if (query.observedYear !== undefined && query.observedYear !== null) {
    conditions.push("e.observed_year = ?");
    bindings.push(integer(query.observedYear, 1900, 2100, "invalid_archive_entry_filter"));
  }
  if (query.materializable !== undefined && query.materializable !== null) {
    if (typeof query.materializable !== "boolean") throw new Error("invalid_archive_entry_filter");
    conditions.push("e.materializable = ?");
    bindings.push(query.materializable ? 1 : 0);
  }
  if (query.cursor) {
    const sortName = safeMetadata(query.cursor.sortName, 240, "invalid_archive_entry_cursor", true).toLowerCase();
    const entryId = safeIdentifier(query.cursor.entryId, 100, "invalid_archive_entry_cursor");
    const anchor = await env.DB.prepare(`select id from creative_archive_entries where owner_id = ? and catalog_id = ?
      and id = ? and sort_name = ?`).bind(ownerId, catalog.id, entryId, sortName).first<{ id: string }>();
    if (!anchor) throw new Error("invalid_archive_entry_cursor");
    conditions.push("(e.sort_name > ? or (e.sort_name = ? and e.id > ?))");
    bindings.push(sortName, sortName, entryId);
  }
  const where = conditions.join(" and ");
  const rows = await env.DB.prepare(`select ${ENTRY_COLUMNS} from creative_archive_entries e
    where ${where} order by e.sort_name asc, e.id asc limit ?`)
    .bind(...bindings, limit + 1).all<EntryRow>();
  const pageRows = (rows.results ?? []).slice(0, limit);
  const hasMore = (rows.results ?? []).length > limit;
  const totalConditions = conditions.filter((condition) => !condition.startsWith("(e.sort_name >"));
  const totalBindings = query.cursor ? bindings.slice(0, -3) : bindings;
  const totalRow = await env.DB.prepare(`select count(*) as total from creative_archive_entries e where ${totalConditions.join(" and ")}`)
    .bind(...totalBindings).first<{ total: number }>();
  const last = pageRows.at(-1);
  return {
    catalog,
    entries: pageRows.map(entryFromRow),
    hasMore,
    nextCursor: hasMore && last ? { catalogId: catalog.id, sortName: last.sortName, entryId: last.id } : null,
    total: Number(totalRow?.total ?? 0),
  };
}

async function materializationRow(env: Env, ownerId: string, materializationId: string) {
  return env.DB.prepare(`select ${MATERIALIZATION_COLUMNS} from creative_archive_materializations m
    where m.id = ? and m.owner_id = ?`).bind(materializationId, ownerId).first<MaterializationRow>();
}

async function materializationByIdempotency(env: Env, ownerId: string, idempotencyKey: string) {
  return env.DB.prepare(`select ${MATERIALIZATION_COLUMNS}, m.idempotency_key as idempotencyKey
    from creative_archive_materializations m where m.owner_id = ? and m.idempotency_key = ?`)
    .bind(ownerId, idempotencyKey).first<MaterializationRequestRow>();
}

async function projectCopyMaterialization(env: Env, ownerId: string, catalogId: string, entryId: string, projectId: string) {
  return env.DB.prepare(`select ${MATERIALIZATION_COLUMNS}, m.idempotency_key as idempotencyKey
    from creative_archive_materializations m where m.owner_id = ? and m.catalog_id = ? and m.entry_id = ?
      and m.project_id = ? and m.status in ('waiting-for-runner', 'running', 'completed') limit 1`)
    .bind(ownerId, catalogId, entryId, projectId).first<MaterializationRequestRow>();
}

function sameMaterializationRequest(row: MaterializationRow, entryId: string, projectId: string, trainingEligible: boolean) {
  return row.entryId === entryId && row.projectId === projectId && Boolean(row.trainingEligible) === trainingEligible;
}

async function materializationResponse(env: Env, ownerId: string, row: MaterializationRow): Promise<ArchiveMaterializationResponse> {
  const materialization = materializationFromRow(row);
  if (materialization.status !== "completed" || !materialization.mediaAssetId) return { materialization };
  const asset = await mediaAssetById(env, ownerId, materialization.mediaAssetId);
  if (!asset) throw new Error("media_not_found");
  return { materialization, asset };
}

export async function archiveMaterializationById(env: Env, ownerId: string, materializationId: string) {
  const row = await materializationRow(env, ownerId, materializationId);
  if (!row) throw new Error("archive_materialization_not_found");
  return materializationResponse(env, ownerId, row);
}

export async function createArchiveMaterialization(env: Env, ownerId: string, entryId: string, value: unknown) {
  const input = record(value, "invalid_archive_materialization_request");
  exactKeys(input, MATERIALIZATION_KEYS, "invalid_archive_materialization_request");
  const projectId = safeIdentifier(input.projectId, 100, "invalid_archive_materialization_request");
  const idempotencyKey = safeIdentifier(input.idempotencyKey, 100, "invalid_archive_materialization_request");
  if (idempotencyKey.length < 16) throw new Error("invalid_archive_materialization_request");
  if (input.trainingEligible !== undefined && typeof input.trainingEligible !== "boolean") throw new Error("invalid_training_consent");
  const trainingEligible = input.trainingEligible === true;
  const normalized = { projectId, idempotencyKey, trainingEligible } satisfies Required<CreateArchiveMaterializationRequest>;
  const existing = await materializationByIdempotency(env, ownerId, normalized.idempotencyKey);
  if (existing) {
    if (!sameMaterializationRequest(existing, entryId, projectId, trainingEligible)) {
      throw new Error("archive_materialization_idempotency_conflict");
    }
    if (existing.status !== "failed") return materializationResponse(env, ownerId, existing);
  }
  const [project, entry] = await Promise.all([
    projectById(env, ownerId, projectId),
    env.DB.prepare(`select ${ENTRY_COLUMNS}, c.runner_id as runnerId from creative_archive_entries e
      join creative_archive_catalogs c on c.id = e.catalog_id and c.owner_id = e.owner_id
      join creative_runners r on r.id = c.runner_id and r.owner_id = c.owner_id and r.revoked_at is null
      where e.id = ? and e.owner_id = ? and c.status = 'active'`)
      .bind(entryId, ownerId).first<EntryRow & { runnerId: string }>(),
  ]);
  if (!project) throw new Error("project_not_found");
  if (project.status === "archived") throw new Error("project_archived");
  if (!entry) throw new Error("archive_entry_not_found");
  if (!entry.materializable || !entry.mediaKind || !entry.mimeType) throw new Error("archive_entry_not_materializable");
  const currentCopy = await projectCopyMaterialization(env, ownerId, entry.catalogId, entry.id, projectId);
  if (currentCopy) {
    if (!sameMaterializationRequest(currentCopy, entryId, projectId, trainingEligible)) {
      throw new Error("archive_materialization_idempotency_conflict");
    }
    return materializationResponse(env, ownerId, currentCopy);
  }
  if (existing?.status === "failed") {
    try {
      const now = new Date().toISOString();
      const retried = await env.DB.prepare(`update creative_archive_materializations set status = 'waiting-for-runner',
        runner_id = ?, claim_token = null, runner_lease_until = null, error = null, started_at = null,
        completed_at = null, updated_at = ? where id = ? and owner_id = ? and status = 'failed'`)
        .bind(entry.runnerId, now, existing.id, ownerId).run();
      if (retried.meta.changes) return archiveMaterializationById(env, ownerId, existing.id);
    } catch {
      // A concurrent request can win the one-copy constraint; resolve it below.
    }
    const raced = await projectCopyMaterialization(env, ownerId, entry.catalogId, entry.id, projectId);
    if (raced && sameMaterializationRequest(raced, entryId, projectId, trainingEligible)) {
      return materializationResponse(env, ownerId, raced);
    }
    throw new Error("archive_materialization_idempotency_conflict");
  }
  const materializationId = id("archivemat");
  const mediaAssetId = id("media");
  const r2Key = `owners/${encodeURIComponent(ownerId)}/projects/${projectId}/media/${mediaAssetId}/source`;
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`insert into creative_archive_materializations (
      id, owner_id, catalog_id, entry_id, project_id, runner_id, status, training_eligible, idempotency_key,
      media_asset_id, r2_key, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, 'waiting-for-runner', ?, ?, ?, ?, ?, ?)`)
      .bind(materializationId, ownerId, entry.catalogId, entry.id, projectId, entry.runnerId,
        trainingEligible ? 1 : 0, idempotencyKey, mediaAssetId, r2Key, now, now).run();
  } catch {
    const [idempotencyRace, projectCopyRace] = await Promise.all([
      materializationByIdempotency(env, ownerId, idempotencyKey),
      projectCopyMaterialization(env, ownerId, entry.catalogId, entry.id, projectId),
    ]);
    const raced = idempotencyRace && idempotencyRace.status !== "failed"
      ? idempotencyRace
      : projectCopyRace;
    if (!raced || !sameMaterializationRequest(raced, entryId, projectId, trainingEligible)) {
      throw new Error("archive_materialization_idempotency_conflict");
    }
    return materializationResponse(env, ownerId, raced);
  }
  return archiveMaterializationById(env, ownerId, materializationId);
}

function claimBundle(row: MaterializationClaimRow): RunnerArchiveMaterializationBundle {
  if (!row.mediaKind || !row.mimeType || row.verificationStatus !== "size-match" || !row.claimToken || !row.runnerLeaseUntil) {
    throw new Error("archive_materialization_not_claimable");
  }
  return {
    materialization: materializationFromRow(row),
    source: {
      catalogId: row.catalogId,
      sourceVersion: row.sourceVersion,
      sourceFingerprint: row.sourceFingerprint,
      sourceRecordType: row.sourceRecordType,
      sourceRecordId: row.sourceRecordId,
      inventoryRecordId: row.inventoryRecordId,
      displayName: row.displayName,
      extension: row.extension,
      mediaKind: row.mediaKind,
      mimeType: row.mimeType,
      size: Number(row.size),
      verificationStatus: "size-match",
    },
    claimToken: row.claimToken,
    leaseUntil: row.runnerLeaseUntil,
  };
}

async function claimedMaterializationRow(env: Env, runner: RunnerIdentity, materializationId: string) {
  return env.DB.prepare(`select ${ENTRY_COLUMNS}, ${MATERIALIZATION_COLUMNS}, c.source_version as sourceVersion,
    c.source_fingerprint as sourceFingerprint, m.claim_token as claimToken, m.runner_lease_until as runnerLeaseUntil,
    m.r2_key as r2Key from creative_archive_materializations m
    join creative_archive_entries e on e.id = m.entry_id and e.catalog_id = m.catalog_id and e.owner_id = m.owner_id
    join creative_archive_catalogs c on c.id = m.catalog_id and c.owner_id = m.owner_id
    where m.id = ? and m.owner_id = ? and m.runner_id = ?`)
    .bind(materializationId, runner.ownerId, runner.id).first<MaterializationClaimRow>();
}

export async function claimArchiveMaterialization(env: Env, runner: RunnerIdentity): Promise<RunnerArchiveMaterializationBundle | null> {
  const now = new Date();
  const nowValue = now.toISOString();
  const candidate = await env.DB.prepare(`select id from creative_archive_materializations
    where owner_id = ? and runner_id = ? and (status = 'waiting-for-runner'
      or (status = 'running' and runner_lease_until <= ?))
    order by case when status = 'running' then 0 else 1 end, created_at asc, id asc limit 1`)
    .bind(runner.ownerId, runner.id, nowValue).first<{ id: string }>();
  if (!candidate) return null;
  const claimToken = `${id("claim")}_${crypto.randomUUID().replaceAll("-", "")}`;
  const leaseUntil = new Date(now.getTime() + 15 * 60_000).toISOString();
  const changed = await env.DB.prepare(`update creative_archive_materializations set status = 'running', claim_token = ?,
    runner_lease_until = ?, error = null, started_at = coalesce(started_at, ?), updated_at = ?
    where id = ? and owner_id = ? and runner_id = ? and (status = 'waiting-for-runner'
      or (status = 'running' and runner_lease_until <= ?))`)
    .bind(claimToken, leaseUntil, nowValue, nowValue, candidate.id, runner.ownerId, runner.id, nowValue).run();
  if (!changed.meta.changes) return null;
  const row = await claimedMaterializationRow(env, runner, candidate.id);
  if (!row) throw new Error("archive_materialization_not_found");
  return claimBundle(row);
}

function exactContentType(value: string) {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function archiveFileName(row: MaterializationClaimRow) {
  const base = row.displayName.toLowerCase().endsWith(row.extension) ? row.displayName : `${row.displayName}${row.extension}`;
  return base.slice(0, 250);
}

export async function completeArchiveMaterialization(
  env: Env,
  runner: RunnerIdentity,
  materializationId: string,
  claimTokenValue: string | null,
  mediaBody: ReadableStream,
  contentTypeValue: string,
  declaredSizeValue: number,
) {
  if (!env.ARTIFACTS) throw new Error("media_storage_not_configured");
  const claimToken = String(claimTokenValue ?? "").trim();
  if (!/^[a-z0-9_-]{40,120}$/i.test(claimToken)) throw new Error("archive_materialization_claim_required");
  let row = await claimedMaterializationRow(env, runner, materializationId);
  if (!row) throw new Error("archive_materialization_not_found");
  if (row.status === "completed") {
    if (row.claimToken !== claimToken) throw new Error("archive_materialization_not_completable");
    return archiveMaterializationById(env, runner.ownerId, materializationId);
  }
  if (row.status !== "running" || row.claimToken !== claimToken) throw new Error("archive_materialization_not_completable");
  const contentType = exactContentType(contentTypeValue);
  const declaredSize = Number(declaredSizeValue);
  if (!row.mimeType || contentType !== row.mimeType || !Number.isSafeInteger(declaredSize)
    || declaredSize !== Number(row.size) || declaredSize <= 0 || declaredSize > MAX_MEDIA_UPLOAD_BYTES) {
    throw new Error("archive_materialization_source_mismatch");
  }
  const retainedLease = new Date(Date.now() + 15 * 60_000).toISOString();
  const reserved = await env.DB.prepare(`update creative_archive_materializations set runner_lease_until = ?, updated_at = ?
    where id = ? and owner_id = ? and runner_id = ? and status = 'running' and claim_token = ?`)
    .bind(retainedLease, new Date().toISOString(), materializationId, runner.ownerId, runner.id, claimToken).run();
  if (!reserved.meta.changes) throw new Error("archive_materialization_not_completable");
  row = await claimedMaterializationRow(env, runner, materializationId);
  if (!row || row.status !== "running" || row.claimToken !== claimToken || !row.mediaKind || !row.mimeType) {
    throw new Error("archive_materialization_not_completable");
  }
  try {
    await env.ARTIFACTS.put(row.r2Key, mediaBody, {
      httpMetadata: { contentType: row.mimeType },
      customMetadata: {
        ownerId: runner.ownerId,
        projectId: row.projectId,
        assetId: row.mediaAssetId,
        archiveCatalogId: row.catalogId,
        archiveEntryId: row.entryId,
        materializationId: row.id,
        trainingEligible: String(Boolean(row.trainingEligible)),
      },
    });
  } catch {
    throw new Error("archive_materialization_retention_failed");
  }
  let stored: R2Object | null;
  try { stored = await env.ARTIFACTS.head(row.r2Key); } catch { stored = null; }
  if (!stored || stored.size !== Number(row.size) || stored.size <= 0 || stored.size > MAX_MEDIA_UPLOAD_BYTES
    || stored.httpMetadata?.contentType !== row.mimeType) {
    await env.ARTIFACTS.delete(row.r2Key);
    throw new Error("archive_materialization_verification_failed");
  }
  const now = new Date().toISOString();
  const provenance = {
    materializedFromArchive: true as const,
    provider: ARCHIVE_INDEX_PROVIDER,
    catalogId: row.catalogId,
    archiveEntryId: row.entryId,
    materializationId: row.id,
    sourceVersion: row.sourceVersion,
    sourceFingerprint: row.sourceFingerprint,
    sourceRecordType: row.sourceRecordType,
    sourceRecordId: row.sourceRecordId,
    inventoryRecordId: row.inventoryRecordId,
    requestedByOwner: true as const,
    materializedAt: now,
    verification: "size-match" as const,
    parentAssetIds: [] as string[],
  };
  try {
    await env.DB.batch([
      env.DB.prepare(`insert into creative_media_assets (
        id, owner_id, project_id, kind, name, original_file_name, mime_type, size, r2_key,
        source, status, training_eligible, provenance_json, created_at, updated_at
      ) select m.media_asset_id, m.owner_id, m.project_id, ?, ?, ?, ?, ?, m.r2_key,
        'archive-index', 'retained', m.training_eligible, ?, ?, ? from creative_archive_materializations m
        where m.id = ? and m.owner_id = ? and m.runner_id = ? and m.status = 'running' and m.claim_token = ?`)
        .bind(row.mediaKind, row.displayName.replace(/\.[^.]+$/, ""), archiveFileName(row), row.mimeType, stored.size,
          JSON.stringify(provenance), now, now, row.id, runner.ownerId, runner.id, claimToken),
      env.DB.prepare(`update creative_archive_materializations set status = 'completed', completed_at = ?, updated_at = ?,
        runner_lease_until = null, error = null where id = ? and owner_id = ? and runner_id = ?
        and status = 'running' and claim_token = ?`)
        .bind(now, now, row.id, runner.ownerId, runner.id, claimToken),
    ]);
  } catch {
    const raced = await claimedMaterializationRow(env, runner, row.id);
    if (raced?.status === "completed" && raced.claimToken === claimToken) {
      return archiveMaterializationById(env, runner.ownerId, row.id);
    }
    await env.ARTIFACTS.delete(row.r2Key);
    throw new Error("archive_materialization_retention_failed");
  }
  const completed = await materializationRow(env, runner.ownerId, row.id);
  if (!completed || completed.status !== "completed") {
    await env.ARTIFACTS.delete(row.r2Key);
    throw new Error("archive_materialization_not_completable");
  }
  return materializationResponse(env, runner.ownerId, completed);
}

export async function failArchiveMaterialization(
  env: Env,
  runner: RunnerIdentity,
  materializationId: string,
  claimTokenValue: string | null,
  value: unknown,
) {
  const claimToken = String(claimTokenValue ?? "").trim();
  if (!/^[a-z0-9_-]{40,120}$/i.test(claimToken)) throw new Error("archive_materialization_claim_required");
  const input = record(value, "invalid_archive_materialization_failure");
  exactKeys(input, FAIL_KEYS, "invalid_archive_materialization_failure");
  const reportedError = boundedText((input as FailArchiveMaterializationRequest).error, 160);
  const error = /^[a-z0-9_.:-]+$/i.test(reportedError) ? reportedError : "archive_materialization_failed";
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`update creative_archive_materializations set status = 'failed', error = ?,
    runner_lease_until = null, updated_at = ?, completed_at = ? where id = ? and owner_id = ? and runner_id = ?
    and status = 'running' and claim_token = ?`)
    .bind(error, now, now, materializationId, runner.ownerId, runner.id, claimToken).run();
  if (!changed.meta.changes) throw new Error("archive_materialization_not_completable");
  return archiveMaterializationById(env, runner.ownerId, materializationId);
}
