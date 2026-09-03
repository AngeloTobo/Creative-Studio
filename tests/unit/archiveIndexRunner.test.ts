// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The Local Runner is intentionally plain ESM so Windows can launch it directly with Node.
// @ts-expect-error TypeScript does not emit declarations for the runtime-only runner module.
import * as archiveIndexRunner from "../../runner/archiveIndex.mjs";

const { archiveCatalogBatches, loadArchiveCatalog, parseArchiveCsv, resolveArchiveMaterialization } = archiveIndexRunner;

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "creative-studio-archive-index-"));
  temporaryRoots.push(root);
  const records = join(root, "00_Archive_Records");
  const relativeDestination = "01_Projects\\Image _ Render _ Vector\\2026\\Living Garden\\final, study.png";
  const destination = join(root, relativeDestination);
  await Promise.all([
    mkdir(records, { recursive: true }),
    mkdir(join(destination, ".."), { recursive: true }),
  ]);
  await writeFile(destination, new Uint8Array([137, 80, 78, 71]));
  await writeFile(join(records, "completion_manifest.csv"), [
    '"ActionID","RecordType","RecordID","InventoryRecordID","SourceStatus","ExpectedSizeBytes","ArchiveDisposition","TechnicalCategory","OriginalWorkBucket","RelativeDestination"',
    `"COMP-1","PROJECT_IMAGE","INV-1","INV-1","AVAILABLE_SIZE_MATCH","4","READY_REFERENCE","Image / Render / Vector","AUTHORED_PROJECT_AREA","${relativeDestination}"`,
    "",
  ].join("\r\n"));
  await writeFile(join(records, "completion_state.csv"), [
    '"ActionID","ExpectedSizeBytes","Status","DestinationSizeBytes","VerificationStatus","SourcePreserved"',
    '"COMP-1","4","VERIFIED","4","SIZE_MATCH","YES"',
    "",
  ].join("\r\n"));
  return { root, destination };
}

async function incrementalReceiptFixture(root: string, options: {
  schemaVersion?: "angelo-art-index-incremental-receipt/1.0" | "angelo-art-index-incremental-receipt/1.1";
  writeCompletionReceipt?: boolean;
  receiptOverrides?: Record<string, unknown>;
  stateStatus?: string;
  exceptionsContent?: string;
  migrationEvent?: string;
} = {}) {
  const receiptId = "CAI-20260902T231918Z";
  const schemaVersion = options.schemaVersion ?? "angelo-art-index-incremental-receipt/1.0";
  const verificationStatus = schemaVersion === "angelo-art-index-incremental-receipt/1.1"
    ? "SIZE_AND_MODIFIED_UTC_MATCH"
    : "SIZE_MATCH";
  const receipt = join(root, "00_Archive_Records", "Incremental", receiptId);
  const relativeDestination = "07_Inbox\\2026-09-02\\comfyui-output\\new-frame.png";
  const destinationPath = join(root, relativeDestination);
  const sourcePath = join(tmpdir(), "art-source", "new-frame.png");
  const stateStatus = options.stateStatus ?? "VERIFIED";
  const exceptionsContent = options.exceptionsContent ?? "";
  const migrationEvent = options.migrationEvent ?? "VERIFIED";
  await Promise.all([
    mkdir(receipt, { recursive: true }),
    mkdir(join(root, relativeDestination, ".."), { recursive: true }),
  ]);
  await writeFile(join(root, relativeDestination), new Uint8Array([1, 2, 3]));
  const candidateCsv = [
    '"ActionID","RecordType","RecordID","InventoryRecordID","SourcePath","SourceRootAlias","SourceStatus","ExpectedSizeBytes","ExpectedModifiedUTC","RelativeDestination","DestinationPath","TechnicalCategory","WorkBucket","ArchiveDisposition","ObservedYear","DiscoveredAtUTC","CollisionPolicy"',
    `"${receiptId}-000001","INCREMENTAL_DISCOVERY","INC-1","","${sourcePath}","comfyui-output","AVAILABLE_SIZE_MATCH","3","2026-09-02T23:19:18.5317110Z","${relativeDestination}","${destinationPath}","Image / Render / Vector","INCREMENTAL_VERIFIED","READY_REFERENCE","2026","2026-09-02T23:19:18.5317110Z","UNIQUE_AS_MAPPED"`,
    "",
  ].join("\r\n");
  const stateCsv = [
    '"ActionID","Status","AttemptCount","LastAttemptUTC","DestinationSizeBytes","VerificationStatus","VerificationMethod","SourcePreserved","ErrorMessage"',
    `"${receiptId}-000001","${stateStatus}","1","2026-09-02T23:30:49.2314851Z","3","${verificationStatus}","EXACT_SIZE_AND_MODIFIED_UTC_STABILITY","YES",""`,
    "",
  ].join("\r\n");
  const verifiedCsv = [
    '"ActionID","RecordType","RecordID","InventoryRecordID","SourcePath","SourceRootAlias","SourceStatus","ExpectedSizeBytes","ExpectedModifiedUTC","RelativeDestination","DestinationPath","TechnicalCategory","WorkBucket","ArchiveDisposition","ObservedYear","DiscoveredAtUTC","CollisionPolicy","Status","AttemptCount","LastAttemptUTC","DestinationSizeBytes","VerificationStatus","VerificationMethod","SourcePreserved","ErrorMessage"',
    `"${receiptId}-000001","INCREMENTAL_DISCOVERY","INC-1","","${sourcePath}","comfyui-output","AVAILABLE_SIZE_MATCH","3","2026-09-02T23:19:18.5317110Z","${relativeDestination}","${destinationPath}","Image / Render / Vector","INCREMENTAL_VERIFIED","READY_REFERENCE","2026","2026-09-02T23:19:18.5317110Z","UNIQUE_AS_MAPPED","${stateStatus}","1","2026-09-02T23:30:49.2314851Z","3","${verificationStatus}","EXACT_SIZE_AND_MODIFIED_UTC_STABILITY","YES",""`,
    "",
  ].join("\r\n");
  const migrationCsv = [
    '"OccurredAtUTC","ActionID","Event","ExpectedSizeBytes","DestinationSizeBytes","Detail"',
    `"2026-09-02T23:30:49.2314851Z","${receiptId}-000001","${migrationEvent}","3","3","COPY_ATOMIC_SOURCE_PRESERVED"`,
    "",
  ].join("\r\n");
  const candidateManifestSha256 = createHash("sha256").update(candidateCsv).digest("hex").toUpperCase();
  const verifiedFilesSha256 = createHash("sha256").update(verifiedCsv).digest("hex").toUpperCase();
  const stateSha256 = createHash("sha256").update(stateCsv).digest("hex").toUpperCase();
  const migrationLogSha256 = createHash("sha256").update(migrationCsv).digest("hex").toUpperCase();
  const exceptionsSha256 = createHash("sha256").update(exceptionsContent).digest("hex").toUpperCase();
  await Promise.all([
    writeFile(join(receipt, "candidate_manifest.csv"), candidateCsv),
    writeFile(join(receipt, "verified_files.csv"), verifiedCsv),
    writeFile(join(receipt, "state.csv"), stateCsv),
    writeFile(join(receipt, "migration_log.csv"), migrationCsv),
    writeFile(join(receipt, "exceptions.csv"), exceptionsContent),
  ]);
  if (options.writeCompletionReceipt !== false) {
    await writeFile(join(receipt, "receipt.json"), JSON.stringify({
      schemaVersion,
      receiptId,
      candidateManifestSha256,
      ...(schemaVersion === "angelo-art-index-incremental-receipt/1.1" ? {
        verifiedFilesSha256,
        stateSha256,
        migrationLogSha256,
        exceptionsSha256,
      } : {}),
      planned: 1,
      verified: 1,
      failed: 0,
      expectedBytes: 3,
      verifiedBytes: 3,
      completedAtUTC: "2026-09-02T23:31:41.5625755Z",
      sourcePolicy: schemaVersion === "angelo-art-index-incremental-receipt/1.1"
        ? "COPY_ATOMIC_EXACT_SIZE_MODIFIED_UTC_STABLE_SOURCE_PRESERVED_NO_OVERWRITE"
        : "COPY_ATOMIC_EXACT_SIZE_MODIFIED_UTC_STABLE_SOURCE_PRESERVED",
      ...options.receiptOverrides,
    }, null, 2));
  }
  return { receipt, candidateCsv, verifiedCsv };
}

describe("Angelo Art Index Local Runner reader", () => {
  it("parses quoted commas and escaped quotes without exposing a path field", () => {
    expect(parseArchiveCsv('"Name","Note"\r\n"final, study.png","Angelo said ""keep"""\r\n')).toEqual([
      { Name: "final, study.png", Note: 'Angelo said "keep"' },
    ]);
  });

  it("builds a deterministic sanitized catalog and re-verifies bytes before copying", async () => {
    const { root } = await fixture();
    const catalog = loadArchiveCatalog(root);
    expect(catalog.entries).toEqual([
      expect.objectContaining({
        sourceRecordType: "PROJECT_IMAGE",
        sourceRecordId: "INV-1",
        displayName: "final, study.png",
        extension: ".png",
        size: 4,
        verificationStatus: "size-match",
      }),
    ]);
    expect(catalog.entries[0]).not.toHaveProperty("path");
    expect(archiveCatalogBatches(catalog)).toHaveLength(1);

    const retained = await resolveArchiveMaterialization(catalog, {
      catalogId: "catalog-1",
      sourceVersion: catalog.sourceVersion,
      sourceFingerprint: catalog.sourceFingerprint,
      sourceRecordType: "PROJECT_IMAGE",
      sourceRecordId: "INV-1",
      inventoryRecordId: "INV-1",
      displayName: "final, study.png",
      extension: ".png",
      mediaKind: "image",
      mimeType: "image/png",
      size: 4,
      verificationStatus: "size-match",
    });
    expect([...retained.bytes]).toEqual([137, 80, 78, 71]);
    expect(retained.fileName).toBe("final, study.png");
  });

  it("fails closed when the indexed file changed after catalog publication", async () => {
    const { root, destination } = await fixture();
    const catalog = loadArchiveCatalog(root);
    await writeFile(destination, new Uint8Array([1, 2, 3, 4, 5]));
    await expect(resolveArchiveMaterialization(catalog, {
      sourceVersion: catalog.sourceVersion,
      sourceFingerprint: catalog.sourceFingerprint,
      sourceRecordType: "PROJECT_IMAGE",
      sourceRecordId: "INV-1",
      extension: ".png",
      mediaKind: "image",
      mimeType: "image/png",
      size: 4,
      verificationStatus: "size-match",
    })).rejects.toThrow("archive_materialization_size_mismatch");
  });

  it("loads only finalized verified rows from receipt-scoped incremental ledgers", async () => {
    const { root } = await fixture();
    await incrementalReceiptFixture(root);

    const catalog = loadArchiveCatalog(root);
    expect(catalog.entries).toHaveLength(2);
    expect(catalog.entries).toContainEqual(expect.objectContaining({
      sourceRecordType: "INCREMENTAL_DISCOVERY",
      sourceRecordId: "INC-1",
      displayName: "new-frame.png",
      verificationStatus: "size-match",
    }));
    expect(catalog.sourceStamp).toContain("schemaVersion=angelo-art-index-incremental-receipt/1.0");
    expect(catalog.sourceStamp).toContain("completedAtUTC=2026-09-02T23:31:41.5625755Z");
    expect(catalog.sourceStamp).toContain("verifiedFilesSha256=");
  });

  it("ignores an in-progress receipt directory until receipt.json finalizes it", async () => {
    const { root } = await fixture();
    await incrementalReceiptFixture(root, { writeCompletionReceipt: false });

    const catalog = loadArchiveCatalog(root);
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries.some((entry: { sourceRecordId: string }) => entry.sourceRecordId === "INC-1")).toBe(false);
  });

  it("quarantines legacy manifest-only incremental intake", async () => {
    const { root } = await fixture();
    const legacyDirectory = join(root, "00_Archive_Records", "Incremental_Ingest_20260902");
    const legacyDestination = "07_Inbox\\2026-09-02\\legacy\\unreceipted.png";
    await Promise.all([
      mkdir(legacyDirectory, { recursive: true }),
      mkdir(join(root, legacyDestination, ".."), { recursive: true }),
    ]);
    await writeFile(join(root, legacyDestination), new Uint8Array([1, 2, 3]));
    await writeFile(join(legacyDirectory, "incremental_manifest.csv"), [
      '"RecordType","RecordID","ExpectedSizeBytes","RelativeDestination","DestinationSizeBytes","Status","VerificationStatus","SourcePreserved"',
      `"INCREMENTAL_ART","UNRECEIPTED-1","3","${legacyDestination}","3","VERIFIED","SIZE_MATCH","YES"`,
      "",
    ].join("\r\n"));

    const catalog = loadArchiveCatalog(root);
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries.some((entry: { sourceRecordId: string }) => entry.sourceRecordId === "UNRECEIPTED-1")).toBe(false);
    expect(catalog.sourceStamp).not.toContain("Incremental_Ingest_20260902");
  });

  it("rejects a finalized receipt whose candidate manifest hash or completion counts are invalid", async () => {
    const { root } = await fixture();
    await incrementalReceiptFixture(root, {
      receiptOverrides: { candidateManifestSha256: "0".repeat(64) },
    });

    expect(() => loadArchiveCatalog(root)).toThrow("archive_index_incremental_receipt_invalid");

    const { root: countRoot } = await fixture();
    await incrementalReceiptFixture(countRoot, {
      receiptOverrides: { planned: 2, failed: 1 },
    });
    expect(() => loadArchiveCatalog(countRoot)).toThrow("archive_index_incremental_receipt_invalid");
  });

  it("requires the verified-files hash for receipt schema 1.1", async () => {
    const { root } = await fixture();
    await incrementalReceiptFixture(root, {
      schemaVersion: "angelo-art-index-incremental-receipt/1.1",
      receiptOverrides: { verifiedFilesSha256: undefined },
    });

    expect(() => loadArchiveCatalog(root)).toThrow("archive_index_incremental_receipt_invalid");
  });

  it("enforces the complete schema 1.1 ledger and success contract", async () => {
    const { root: missingHashRoot } = await fixture();
    await incrementalReceiptFixture(missingHashRoot, {
      schemaVersion: "angelo-art-index-incremental-receipt/1.1",
      receiptOverrides: { stateSha256: undefined },
    });
    expect(() => loadArchiveCatalog(missingHashRoot)).toThrow("archive_index_incremental_receipt_invalid");

    const { root: invalidStateRoot } = await fixture();
    await incrementalReceiptFixture(invalidStateRoot, {
      schemaVersion: "angelo-art-index-incremental-receipt/1.1",
      stateStatus: "FAILED",
    });
    expect(() => loadArchiveCatalog(invalidStateRoot)).toThrow("archive_index_incremental_receipt_invalid");

    const { root: exceptionsRoot } = await fixture();
    await incrementalReceiptFixture(exceptionsRoot, {
      schemaVersion: "angelo-art-index-incremental-receipt/1.1",
      exceptionsContent: "unexpected failure ledger content\r\n",
    });
    expect(() => loadArchiveCatalog(exceptionsRoot)).toThrow("archive_index_incremental_receipt_invalid");

    const { root: policyRoot } = await fixture();
    await incrementalReceiptFixture(policyRoot, {
      schemaVersion: "angelo-art-index-incremental-receipt/1.1",
      receiptOverrides: { sourcePolicy: "COPY_ONLY" },
    });
    expect(() => loadArchiveCatalog(policyRoot)).toThrow("archive_index_incremental_receipt_invalid");

    const { root: incompleteMigrationRoot } = await fixture();
    await incrementalReceiptFixture(incompleteMigrationRoot, {
      schemaVersion: "angelo-art-index-incremental-receipt/1.1",
      migrationEvent: "FAILED",
    });
    expect(() => loadArchiveCatalog(incompleteMigrationRoot)).toThrow("archive_index_incremental_receipt_invalid");
  });

  it("loads the producer verification status from a valid schema 1.1 receipt", async () => {
    const { root } = await fixture();
    await incrementalReceiptFixture(root, {
      schemaVersion: "angelo-art-index-incremental-receipt/1.1",
    });

    const catalog = loadArchiveCatalog(root);
    expect(catalog.entries).toContainEqual(expect.objectContaining({
      sourceRecordId: "INC-1",
      verificationStatus: "size-match",
    }));
    expect(catalog.expectedVerifiedCount).toBe(2);
    expect(catalog.sourceStamp).toContain("stateSha256=");
    expect(catalog.sourceStamp).toContain("migrationLogSha256=");
    expect(catalog.sourceStamp).toContain("exceptionsSha256=");
    expect(catalog.sourceStamp).toContain("sourcePolicy=COPY_ATOMIC_EXACT_SIZE_MODIFIED_UTC_STABLE_SOURCE_PRESERVED_NO_OVERWRITE");
  });

  it("validates the verified-files hash for receipt schema 1.1", async () => {
    const { root } = await fixture();
    const { receipt, verifiedCsv } = await incrementalReceiptFixture(root, {
      schemaVersion: "angelo-art-index-incremental-receipt/1.1",
    });
    await writeFile(join(receipt, "verified_files.csv"), verifiedCsv.replace(
      "2026-09-02T23:30:49.2314851Z",
      "2026-09-02T23:30:50.2314851Z",
    ));

    expect(() => loadArchiveCatalog(root)).toThrow("archive_index_incremental_receipt_invalid");
  });
});
