export const ARCHIVE_CATALOG_SCHEMA_VERSION: "creative-studio-archive-catalog/1.0";
export const MAX_ARCHIVE_MATERIALIZATION_BYTES: number;

export function parseArchiveCsv(source: string): Array<Record<string, string>>;
export function archiveMediaType(fileName: string): {
  extension: string;
  mediaKind: "image" | null;
  mimeType: string | null;
};
export function archiveSourceStamp(archiveRoot: string): string;
export function loadArchiveCatalog(archiveRoot: string): unknown;
export function resolveArchiveMaterialization(catalog: unknown, source: unknown): Promise<{
  bytes: Buffer;
  contentType: string;
  fileName: string;
  size: number;
}>;
export function archiveIndexSelfTest(): void;
