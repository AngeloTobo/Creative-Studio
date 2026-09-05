import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

export const ARCHIVE_CATALOG_SCHEMA_VERSION = "creative-studio-archive-catalog/1.0";
export const MAX_ARCHIVE_MATERIALIZATION_BYTES = 100 * 1024 * 1024;

const BASELINE_MANIFEST = join("00_Archive_Records", "completion_manifest.csv");
const BASELINE_STATE = join("00_Archive_Records", "completion_state.csv");
const INCREMENTAL_RECEIPT = /^CAI-[0-9]{8}T[0-9]{6}Z(?:-[A-Za-z0-9_-]+)?$/;
const INCREMENTAL_RECEIPT_SCHEMAS = Object.freeze({
  "angelo-art-index-incremental-receipt/1.0": { completeReceiptRequired: false },
  "angelo-art-index-incremental-receipt/1.1": { completeReceiptRequired: true },
});
const COMPLETE_RECEIPT_SOURCE_POLICY = "COPY_ATOMIC_EXACT_SIZE_MODIFIED_UTC_STABLE_SOURCE_PRESERVED_NO_OVERWRITE";
const MIGRATION_LOG_HEADER = '"OccurredAtUTC","ActionID","Event","ExpectedSizeBytes","DestinationSizeBytes","Detail"';
const MIGRATION_EVENTS = new Set(["STALE_PARTIAL_REMOVED", "RECOVERED_VERIFIED", "VERIFIED", "FAILED"]);
const IMAGE_TYPES = Object.freeze({
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
});

function text(value) {
  return String(value ?? "").trim();
}

function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeHeader(value) {
  return text(value).replace(/^\uFEFF/, "");
}

/** RFC 4180-compatible parser used for the private Art Index receipts. */
export function parseArchiveCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const value = String(source ?? "").replace(/^\uFEFF/, "");
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((item) => item.length)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("archive_index_csv_unclosed_quote");
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    if (row.some((item) => item.length)) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  if (!headers.length || headers.some((header) => !header)) throw new Error("archive_index_csv_invalid_header");
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function archiveMediaType(fileName) {
  const parsedExtension = extname(text(fileName)).toLowerCase();
  const extension = /^\.[a-z0-9]{1,20}$/i.test(parsedExtension) ? parsedExtension : "";
  const mimeType = IMAGE_TYPES[extension] ?? null;
  return { extension, mediaKind: mimeType ? "image" : null, mimeType };
}

function normalizeRelativeDestination(value) {
  const normalized = text(value).replaceAll("/", "\\").replace(/^\\+/, "");
  if (!normalized || isAbsolute(normalized)) throw new Error("archive_index_invalid_relative_destination");
  const segments = normalized.split("\\");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("archive_index_invalid_relative_destination");
  }
  return normalized;
}

function observedYear(relativeDestination, fallback) {
  const explicit = integer(fallback);
  if (explicit && explicit >= 1900 && explicit <= 2100) return explicit;
  const years = relativeDestination.match(/(?:^|\\)(19\d{2}|20\d{2}|2100)(?=\\|$)/g);
  if (!years?.length) return null;
  const parsed = Number(years.at(-1).replaceAll("\\", ""));
  return parsed >= 1900 && parsed <= 2100 ? parsed : null;
}

function recordKey(recordType, recordId) {
  return `${text(recordType)}\u0000${text(recordId)}`;
}

function receiptInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function receiptCsvInteger(value) {
  const normalized = text(value);
  return /^\d+$/.test(normalized) ? integer(normalized) : null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function validReceiptHash(value) {
  const normalized = text(value).toUpperCase();
  return /^[A-F0-9]{64}$/.test(normalized) ? normalized : null;
}

function receiptInvalid() {
  throw new Error("archive_index_incremental_receipt_invalid");
}

function isRegularReceiptFile(path) {
  try {
    const metadata = lstatSync(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function isVerifiedIncrementalStatus(value) {
  const normalized = text(value).toUpperCase();
  return normalized === "SIZE_MATCH" || normalized === "SIZE_AND_MODIFIED_UTC_MATCH";
}

function isUtcTimestamp(value) {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(normalized)
    && Number.isFinite(Date.parse(normalized));
}

function safeDisplayName(relativeDestination, fallback) {
  return text(basename(relativeDestination)) || text(fallback) || "Archive item";
}

function baselineRecords(archiveRoot) {
  const manifestPath = join(archiveRoot, BASELINE_MANIFEST);
  const statePath = join(archiveRoot, BASELINE_STATE);
  if (!existsSync(manifestPath) || !existsSync(statePath)) throw new Error("archive_index_records_missing");
  const states = new Map(parseArchiveCsv(readFileSync(statePath, "utf8"))
    .map((record) => [text(record.ActionID), record]));
  return parseArchiveCsv(readFileSync(manifestPath, "utf8")).map((record) => {
    const state = states.get(text(record.ActionID));
    const relativeDestination = normalizeRelativeDestination(record.RelativeDestination);
    const expectedSize = integer(state?.ExpectedSizeBytes ?? record.ExpectedSizeBytes);
    const destinationSize = integer(state?.DestinationSizeBytes ?? record.DestinationSizeBytes);
    const verified = text(state?.Status).toUpperCase() === "VERIFIED"
      && text(state?.VerificationStatus).toUpperCase() === "SIZE_MATCH"
      && expectedSize !== null && destinationSize === expectedSize;
    return {
      sourceRecordType: text(record.RecordType),
      sourceRecordId: text(record.RecordID),
      inventoryRecordId: text(record.InventoryRecordID) || null,
      displayName: safeDisplayName(relativeDestination, record.RecordID),
      relativeDestination,
      technicalCategory: text(record.TechnicalCategory) || "Unclassified",
      workBucket: text(record.OriginalWorkBucket) || "UNCLASSIFIED",
      archiveDisposition: text(record.ArchiveDisposition) || "REVIEW_REQUIRED",
      observedYear: observedYear(relativeDestination),
      size: expectedSize ?? destinationSize ?? 0,
      sourceStatus: text(record.SourceStatus) || text(state?.Status) || "UNKNOWN",
      verificationStatus: verified ? "size-match" : "unavailable",
      sourcePreserved: text(state?.SourcePreserved).toUpperCase() === "YES",
    };
  });
}

function validatedIncrementalReceipt(receiptDirectory, archiveRoot) {
  try {
    const receiptPath = join(receiptDirectory, "receipt.json");
    const candidateManifestPath = join(receiptDirectory, "candidate_manifest.csv");
    const verifiedFilesPath = join(receiptDirectory, "verified_files.csv");
    const statePath = join(receiptDirectory, "state.csv");
    const migrationLogPath = join(receiptDirectory, "migration_log.csv");
    const exceptionsPath = join(receiptDirectory, "exceptions.csv");
    if (!isRegularReceiptFile(receiptPath)) receiptInvalid();
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) receiptInvalid();

    const schemaVersion = text(receipt.schemaVersion);
    const schema = INCREMENTAL_RECEIPT_SCHEMAS[schemaVersion];
    const receiptId = text(receipt.receiptId);
    const completedAtUTC = text(receipt.completedAtUTC);
    const planned = receiptInteger(receipt.planned);
    const verified = receiptInteger(receipt.verified);
    const failed = receiptInteger(receipt.failed);
    const expectedBytes = receiptInteger(receipt.expectedBytes);
    const verifiedBytes = receiptInteger(receipt.verifiedBytes);
    const candidateManifestSha256 = validReceiptHash(receipt.candidateManifestSha256);
    if (!schema || receiptId !== basename(receiptDirectory)
      || !isUtcTimestamp(completedAtUTC)
      || planned === null || verified === null || failed === null
      || expectedBytes === null || verifiedBytes === null || !candidateManifestSha256
      || verified + failed !== planned || verifiedBytes > expectedBytes
      || !isRegularReceiptFile(candidateManifestPath) || !isRegularReceiptFile(verifiedFilesPath)) receiptInvalid();

    const candidateBytes = readFileSync(candidateManifestPath);
    const verifiedFileBytes = readFileSync(verifiedFilesPath);
    const actualCandidateHash = sha256(candidateBytes);
    const actualVerifiedFilesHash = sha256(verifiedFileBytes);
    const hasDeclaredVerifiedFilesHash = receipt.verifiedFilesSha256 !== undefined;
    const declaredVerifiedFilesHash = !hasDeclaredVerifiedFilesHash
      ? null
      : validReceiptHash(receipt.verifiedFilesSha256);
    if (candidateManifestSha256 !== actualCandidateHash
      || (hasDeclaredVerifiedFilesHash && !declaredVerifiedFilesHash)
      || (declaredVerifiedFilesHash
      && declaredVerifiedFilesHash !== actualVerifiedFilesHash)) receiptInvalid();

    let states = null;
    let migrationRows = null;
    let completionLedgerHashes = null;
    let completionStampPaths = [receiptPath, candidateManifestPath, verifiedFilesPath];
    if (schema.completeReceiptRequired) {
      const ledgerSpecs = [
        [verifiedFilesPath, "verifiedFilesSha256"],
        [statePath, "stateSha256"],
        [migrationLogPath, "migrationLogSha256"],
        [exceptionsPath, "exceptionsSha256"],
      ];
      completionLedgerHashes = {};
      const ledgerBytes = new Map();
      for (const [ledgerPath, hashProperty] of ledgerSpecs) {
        const declaredHash = validReceiptHash(receipt[hashProperty]);
        if (!declaredHash || !isRegularReceiptFile(ledgerPath)) receiptInvalid();
        const bytes = readFileSync(ledgerPath);
        const actualHash = sha256(bytes);
        if (declaredHash !== actualHash) receiptInvalid();
        completionLedgerHashes[hashProperty] = actualHash;
        ledgerBytes.set(ledgerPath, bytes);
      }
      if (text(receipt.sourcePolicy) !== COMPLETE_RECEIPT_SOURCE_POLICY
        || planned === 0 || failed !== 0 || verified !== planned || verifiedBytes !== expectedBytes) receiptInvalid();
      const exceptionsBytes = ledgerBytes.get(exceptionsPath);
      const migrationBytes = ledgerBytes.get(migrationLogPath);
      if (exceptionsBytes.length !== 0 || migrationBytes.length === 0) receiptInvalid();
      const migrationText = migrationBytes.toString("utf8");
      if (migrationText.split(/\r?\n/, 1)[0] !== MIGRATION_LOG_HEADER) receiptInvalid();
      states = parseArchiveCsv(ledgerBytes.get(statePath).toString("utf8"));
      migrationRows = parseArchiveCsv(migrationText);
      completionStampPaths = [
        receiptPath,
        candidateManifestPath,
        verifiedFilesPath,
        statePath,
        migrationLogPath,
        exceptionsPath,
      ];
    }

    const candidates = parseArchiveCsv(candidateBytes.toString("utf8"));
    const verifiedFiles = parseArchiveCsv(verifiedFileBytes.toString("utf8"));
    if (candidates.length !== planned || verifiedFiles.length !== verified
      || (schema.completeReceiptRequired && states.length !== candidates.length)) receiptInvalid();

    const candidatesByAction = new Map();
    let candidateBytesTotal = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const actionId = text(candidate.ActionID);
      const size = receiptCsvInteger(candidate.ExpectedSizeBytes ?? candidate.SourceSizeBytes);
      if (!actionId || candidatesByAction.has(actionId) || size === null) receiptInvalid();
      if (schema.completeReceiptRequired) {
        const relativeDestination = normalizeRelativeDestination(candidate.RelativeDestination);
        const storedDestination = text(candidate.DestinationPath);
        const expectedDestination = resolve(archiveRoot, relativeDestination);
        const state = states[index];
        const attemptCount = receiptCsvInteger(state.AttemptCount);
        if (!new RegExp(`^${receiptId}-[0-9]{6}$`).test(actionId)
          || !relativeDestination.toLowerCase().startsWith("07_inbox\\")
          || !storedDestination || !isAbsolute(storedDestination)
          || resolve(storedDestination).toLowerCase() !== expectedDestination.toLowerCase()
          || !isUtcTimestamp(candidate.ExpectedModifiedUTC)
          || text(state.ActionID) !== actionId
          || text(state.Status) !== "VERIFIED"
          || receiptCsvInteger(state.DestinationSizeBytes) !== size
          || !isVerifiedIncrementalStatus(state.VerificationStatus)
          || text(state.VerificationMethod) !== "EXACT_SIZE_AND_MODIFIED_UTC_STABILITY"
          || text(state.SourcePreserved) !== "YES"
          || text(state.ErrorMessage) !== ""
          || attemptCount === null || attemptCount < 1
          || !isUtcTimestamp(state.LastAttemptUTC)) receiptInvalid();
      }
      candidateBytesTotal += size;
      if (!Number.isSafeInteger(candidateBytesTotal)) receiptInvalid();
      candidatesByAction.set(actionId, candidate);
    }

    const verifiedActionIds = new Set();
    let verifiedBytesTotal = 0;
    for (const verifiedFile of verifiedFiles) {
      const actionId = text(verifiedFile.ActionID);
      const candidate = candidatesByAction.get(actionId);
      const expectedSize = receiptCsvInteger(verifiedFile.ExpectedSizeBytes ?? verifiedFile.SourceSizeBytes);
      const destinationSize = receiptCsvInteger(verifiedFile.DestinationSizeBytes);
      if (!candidate || verifiedActionIds.has(actionId) || expectedSize === null
        || destinationSize !== expectedSize
        || text(verifiedFile.Status).toUpperCase() !== "VERIFIED"
        || !isVerifiedIncrementalStatus(verifiedFile.VerificationStatus)
        || text(verifiedFile.SourcePreserved).toUpperCase() !== "YES"
        || Object.keys(candidate).some((key) => text(verifiedFile[key]) !== text(candidate[key]))) receiptInvalid();
      if (schema.completeReceiptRequired) {
        const state = states.find((candidateState) => text(candidateState.ActionID) === actionId);
        if (!state || Object.keys(state).some((key) => text(verifiedFile[key]) !== text(state[key]))) receiptInvalid();
      }
      verifiedBytesTotal += destinationSize;
      if (!Number.isSafeInteger(verifiedBytesTotal)) receiptInvalid();
      verifiedActionIds.add(actionId);
    }
    if (candidateBytesTotal !== expectedBytes || verifiedBytesTotal !== verifiedBytes) receiptInvalid();

    if (schema.completeReceiptRequired) {
      const successfulActions = new Set();
      for (const migration of migrationRows) {
        const actionId = text(migration.ActionID);
        const candidate = candidatesByAction.get(actionId);
        const event = text(migration.Event);
        const migrationExpectedBytes = receiptCsvInteger(migration.ExpectedSizeBytes);
        if (!candidate || !MIGRATION_EVENTS.has(event) || !isUtcTimestamp(migration.OccurredAtUTC)
          || migrationExpectedBytes !== receiptCsvInteger(candidate.ExpectedSizeBytes)) receiptInvalid();
        if (event === "VERIFIED" || event === "RECOVERED_VERIFIED") {
          if (receiptCsvInteger(migration.DestinationSizeBytes) !== migrationExpectedBytes) receiptInvalid();
          successfulActions.add(actionId);
        }
      }
      if (successfulActions.size !== candidates.length) receiptInvalid();
    }

    return {
      manifestPath: verifiedFilesPath,
      records: verifiedFiles,
      stampPaths: completionStampPaths,
      completionStamp: [
        `schemaVersion=${schemaVersion}`,
        `receiptId=${receiptId}`,
        `completedAtUTC=${completedAtUTC}`,
        `planned=${planned}`,
        `verified=${verified}`,
        `failed=${failed}`,
        `expectedBytes=${expectedBytes}`,
        `verifiedBytes=${verifiedBytes}`,
        `candidateManifestSha256=${actualCandidateHash}`,
        `verifiedFilesSha256=${actualVerifiedFilesHash}`,
        ...(completionLedgerHashes ? [
          `stateSha256=${completionLedgerHashes.stateSha256}`,
          `migrationLogSha256=${completionLedgerHashes.migrationLogSha256}`,
          `exceptionsSha256=${completionLedgerHashes.exceptionsSha256}`,
          `sourcePolicy=${COMPLETE_RECEIPT_SOURCE_POLICY}`,
        ] : []),
      ].join(","),
    };
  } catch (error) {
    if (error instanceof Error && error.message === "archive_index_incremental_receipt_invalid") throw error;
    receiptInvalid();
  }
}

function incrementalCatalogSources(archiveRoot) {
  const recordsRoot = join(archiveRoot, "00_Archive_Records");
  if (!existsSync(recordsRoot)) return [];
  const receiptsRoot = join(recordsRoot, "Incremental");
  const receipts = existsSync(receiptsRoot)
    ? readdirSync(receiptsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && INCREMENTAL_RECEIPT.test(entry.name))
      .map((entry) => join(receiptsRoot, entry.name))
      .filter((receiptDirectory) => existsSync(join(receiptDirectory, "receipt.json")))
      .map((receiptDirectory) => validatedIncrementalReceipt(receiptDirectory, archiveRoot))
    : [];
  return receipts.sort((left, right) => left.manifestPath.localeCompare(right.manifestPath));
}

function incrementalRecords(sources) {
  return sources.flatMap((source) => source.records.map((record) => {
    const relativeDestination = normalizeRelativeDestination(record.RelativeDestination);
    const expectedSize = integer(record.ExpectedSizeBytes ?? record.SourceSizeBytes);
    const destinationSize = integer(record.DestinationSizeBytes);
    const verified = text(record.Status).toUpperCase() === "VERIFIED"
      && isVerifiedIncrementalStatus(record.VerificationStatus)
      && expectedSize !== null && destinationSize === expectedSize
      && text(record.SourcePreserved).toUpperCase() === "YES";
    return {
      sourceRecordType: text(record.RecordType) || "INCREMENTAL_ART",
      sourceRecordId: text(record.RecordID),
      inventoryRecordId: text(record.InventoryRecordID) || null,
      displayName: safeDisplayName(relativeDestination, record.RecordID),
      relativeDestination,
      technicalCategory: text(record.TechnicalCategory) || "Image / Render / Vector",
      workBucket: text(record.WorkBucket) || "INCREMENTAL_INBOX",
      archiveDisposition: text(record.ArchiveDisposition) || "REVIEW_REQUIRED",
      observedYear: observedYear(relativeDestination, record.ObservedYear),
      size: expectedSize ?? destinationSize ?? 0,
      sourceStatus: text(record.SourceStatus) || text(record.Status) || "UNKNOWN",
      verificationStatus: verified ? "size-match" : "unavailable",
      sourcePreserved: text(record.SourcePreserved).toUpperCase() === "YES",
    };
  }));
}

function recordForCatalog(archiveRoot, record) {
  if (!record.sourceRecordType || !record.sourceRecordId) throw new Error("archive_index_record_identity_missing");
  const media = archiveMediaType(record.displayName);
  return {
    entry: {
      sourceRecordType: record.sourceRecordType,
      sourceRecordId: record.sourceRecordId,
      inventoryRecordId: record.inventoryRecordId,
      displayName: record.displayName,
      extension: media.extension,
      technicalCategory: record.technicalCategory,
      workBucket: record.workBucket,
      archiveDisposition: record.archiveDisposition,
      observedYear: record.observedYear,
      size: record.size,
      sourceStatus: record.sourceStatus,
      verificationStatus: record.verificationStatus,
    },
    local: {
      path: join(archiveRoot, record.relativeDestination),
      relativeDestination: record.relativeDestination,
      displayName: record.displayName,
      expectedSize: record.size,
      sourcePreserved: record.sourcePreserved,
      ...media,
    },
  };
}

function canonicalCatalogEntry(entry) {
  return [
    entry.sourceRecordType,
    entry.sourceRecordId,
    entry.inventoryRecordId ?? "",
    entry.displayName,
    entry.extension,
    entry.technicalCategory,
    entry.workBucket,
    entry.archiveDisposition,
    entry.observedYear ?? "",
    entry.size,
    entry.sourceStatus,
    entry.verificationStatus,
  ].join("\t");
}

function archiveSourceStampFromSources(archiveRoot, sources) {
  const root = resolve(text(archiveRoot));
  const baselinePaths = [join(root, BASELINE_MANIFEST), join(root, BASELINE_STATE)];
  const pathStamps = [...baselinePaths, ...sources.flatMap((source) => source.stampPaths)].map((path) => {
    const metadata = statSync(path);
    return `${relative(root, path).replaceAll("\\", "/")}:${metadata.size}:${metadata.mtimeMs}`;
  });
  const completionStamps = sources
    .filter((source) => source.completionStamp)
    .map((source) => `${relative(root, source.manifestPath).replaceAll("\\", "/")}:${source.completionStamp}`);
  return [...pathStamps, ...completionStamps].join("|");
}

export function archiveSourceStamp(archiveRoot) {
  const root = resolve(text(archiveRoot));
  return archiveSourceStampFromSources(root, incrementalCatalogSources(root));
}

export function loadArchiveCatalog(archiveRoot) {
  const requestedRoot = text(archiveRoot);
  if (!requestedRoot || !isAbsolute(requestedRoot)) throw new Error("archive_index_root_invalid");
  const root = resolve(requestedRoot);
  const incrementalSources = incrementalCatalogSources(root);
  const records = [...baselineRecords(root), ...incrementalRecords(incrementalSources)];
  const entries = [];
  const localByRecord = new Map();
  for (const record of records) {
    const prepared = recordForCatalog(root, record);
    const key = recordKey(prepared.entry.sourceRecordType, prepared.entry.sourceRecordId);
    if (localByRecord.has(key)) throw new Error("archive_index_duplicate_record_identity");
    entries.push(prepared.entry);
    localByRecord.set(key, prepared.local);
  }
  entries.sort((left, right) => canonicalCatalogEntry(left).localeCompare(canonicalCatalogEntry(right)));
  const sourceFingerprint = createHash("sha256")
    .update(entries.map(canonicalCatalogEntry).join("\n"))
    .digest("hex");
  return {
    schemaVersion: ARCHIVE_CATALOG_SCHEMA_VERSION,
    root,
    sourceVersion: `angelo-art-index-${sourceFingerprint.slice(0, 16)}`,
    sourceFingerprint,
    sourceStamp: archiveSourceStampFromSources(root, incrementalSources),
    entries,
    localByRecord,
    expectedEntryCount: entries.length,
    expectedVerifiedCount: entries.filter((entry) => entry.verificationStatus === "size-match").length,
    expectedUnavailableCount: entries.filter((entry) => entry.verificationStatus === "unavailable").length,
  };
}

function pathInside(root, candidate) {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..\\") && !child.startsWith("../") && child !== ".." && !isAbsolute(child));
}

export async function resolveArchiveMaterialization(catalog, source) {
  if (source.sourceVersion !== catalog.sourceVersion || source.sourceFingerprint !== catalog.sourceFingerprint) {
    throw new Error("archive_materialization_catalog_changed");
  }
  const local = catalog.localByRecord.get(recordKey(source.sourceRecordType, source.sourceRecordId));
  if (!local || local.sourcePreserved !== true) throw new Error("archive_materialization_source_unavailable");
  if (source.verificationStatus !== "size-match" || source.mediaKind !== "image"
    || source.mimeType !== local.mimeType || text(source.extension).toLowerCase() !== local.extension) {
    throw new Error("archive_materialization_source_ineligible");
  }
  if (!Number.isSafeInteger(source.size) || source.size <= 0 || source.size > MAX_ARCHIVE_MATERIALIZATION_BYTES
    || source.size !== local.expectedSize) throw new Error("archive_materialization_size_mismatch");
  const [rootReal, fileReal] = await Promise.all([realpath(catalog.root), realpath(local.path)]);
  if (!pathInside(rootReal, fileReal)) throw new Error("archive_materialization_path_escape");
  const [linkInfo, fileInfo] = await Promise.all([lstat(local.path), stat(fileReal)]);
  if (linkInfo.isSymbolicLink() || !fileInfo.isFile()) throw new Error("archive_materialization_source_ineligible");
  if (fileInfo.size !== source.size) throw new Error("archive_materialization_size_mismatch");
  return {
    bytes: await readFile(fileReal),
    contentType: local.mimeType,
    fileName: text(source.displayName) || local.displayName || basename(fileReal),
    size: fileInfo.size,
  };
}

export function archiveIndexSelfTest() {
  const parsed = parseArchiveCsv('\uFEFF"A","B"\r\n"one, two","say ""hi"""\r\n');
  if (parsed.length !== 1 || parsed[0].A !== "one, two" || parsed[0].B !== 'say "hi"') {
    throw new Error("runner_self_test_archive_csv_failed");
  }
  const png = archiveMediaType("Study.PNG");
  const tiff = archiveMediaType("Study.tiff");
  if (png.mediaKind !== "image" || png.mimeType !== "image/png" || tiff.mediaKind !== null) {
    throw new Error("runner_self_test_archive_media_type_failed");
  }
  let escaped = false;
  try { normalizeRelativeDestination("..\\outside.png"); } catch { escaped = true; }
  if (!escaped) throw new Error("runner_self_test_archive_path_guard_failed");
}
