import type { IsoDateString, MediaAsset, MediaKind } from "./domain";

export const ARCHIVE_INDEX_PROVIDER = "angelo-art-index" as const;
export const ARCHIVE_CATALOG_SCHEMA_VERSION = "creative-studio-archive-catalog/1.0" as const;
export const ARCHIVE_MATERIALIZATION_SCHEMA_VERSION = "creative-studio-archive-materialization/1.0" as const;

export type ArchiveCatalogStatus = "staging" | "active" | "replaced" | "failed";
export type ArchiveEntryVerificationStatus = "size-match" | "unavailable";
export type ArchiveMaterializationStatus = "waiting-for-runner" | "running" | "completed" | "failed";
export type ArchiveMaterializationBlockReason = "unavailable" | "review-required" | "unsupported-media" | "empty-media" | "media-too-large" | null;

export type ArchiveCatalog = {
  schemaVersion: typeof ARCHIVE_CATALOG_SCHEMA_VERSION;
  id: string;
  provider: typeof ARCHIVE_INDEX_PROVIDER;
  runnerId: string;
  sourceVersion: string;
  sourceFingerprint: string;
  status: ArchiveCatalogStatus;
  expectedEntryCount: number;
  expectedVerifiedCount: number;
  expectedUnavailableCount: number;
  receivedEntryCount: number;
  materializableEntryCount: number;
  createdAt: IsoDateString;
  publishedAt: IsoDateString | null;
};

export type ArchiveEntry = {
  id: string;
  catalogId: string;
  sourceRecordType: string;
  sourceRecordId: string;
  inventoryRecordId: string | null;
  displayName: string;
  extension: string;
  mediaKind: MediaKind | null;
  mimeType: string | null;
  technicalCategory: string;
  workBucket: string;
  archiveDisposition: string;
  observedYear: number | null;
  size: number;
  sourceStatus: string;
  verificationStatus: ArchiveEntryVerificationStatus;
  materializable: boolean;
  materializationBlockReason: ArchiveMaterializationBlockReason;
};

export type ArchiveEntryCursor = {
  catalogId: string;
  sortName: string;
  entryId: string;
};

export type ArchiveEntryQuery = {
  cursor?: ArchiveEntryCursor | null;
  limit?: number;
  search?: string;
  mediaKind?: MediaKind | null;
  observedYear?: number | null;
  materializable?: boolean | null;
};

export type ArchiveEntryPage = {
  catalog: ArchiveCatalog | null;
  entries: ArchiveEntry[];
  nextCursor: ArchiveEntryCursor | null;
  hasMore: boolean;
  total: number;
};

export type ArchiveIndexStatusResponse = {
  activeCatalog: ArchiveCatalog | null;
  latestSync: ArchiveCatalog | null;
};

export type ArchiveEntryPageResponse = { page: ArchiveEntryPage };

export type CreateArchiveMaterializationRequest = {
  projectId: string;
  idempotencyKey: string;
  /** Omission is an explicit safe default: archive material is excluded from training. */
  trainingEligible?: boolean;
};

export type ArchiveMaterialization = {
  schemaVersion: typeof ARCHIVE_MATERIALIZATION_SCHEMA_VERSION;
  id: string;
  catalogId: string;
  entryId: string;
  projectId: string;
  runnerId: string;
  status: ArchiveMaterializationStatus;
  trainingEligible: boolean;
  mediaAssetId: string | null;
  error: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  startedAt: IsoDateString | null;
  completedAt: IsoDateString | null;
};

export type ArchiveMaterializationResponse = {
  materialization: ArchiveMaterialization;
  asset?: MediaAsset;
};
