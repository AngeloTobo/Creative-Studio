import type { MediaAsset, MediaKind } from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import { createMediaAsset, mediaAssetById, mediaObjectById, projectById } from "./repository";
import type { Env } from "./types";

export const MAX_MEDIA_UPLOAD_BYTES = 100 * 1024 * 1024;

const MEDIA_TYPES: Record<string, MediaKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/flac": "audio",
  "audio/ogg": "audio",
  "audio/mp4": "audio",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
};

function decodedHeader(request: Request, name: string) {
  const raw = request.headers.get(name) ?? "";
  try { return decodeURIComponent(raw); } catch { throw new Error("invalid_media_headers"); }
}

function safeFileName(value: string) {
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return boundedText(leaf, 180);
}

function displayName(fileName: string) {
  return boundedText(fileName.replace(/\.[^.]+$/, ""), 120) || "Uploaded media";
}

function uploadHeaders(request: Request) {
  const projectId = boundedText(request.headers.get("x-cs-project-id"), 80);
  const originalFileName = safeFileName(decodedHeader(request, "x-cs-file-name"));
  const mimeType = String(request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  const claimedSize = Number(request.headers.get("x-cs-file-size"));
  const training = request.headers.get("x-cs-training-eligible");
  if (!projectId || !originalFileName || !Number.isInteger(claimedSize)) throw new Error("invalid_media_headers");
  if (claimedSize <= 0) throw new Error("empty_media_upload");
  if (claimedSize > MAX_MEDIA_UPLOAD_BYTES) throw new Error("media_upload_too_large");
  if (training !== "true" && training !== "false") throw new Error("invalid_training_consent");
  const kind = MEDIA_TYPES[mimeType];
  if (!kind) throw new Error("unsupported_media_type");
  return { projectId, originalFileName, mimeType, claimedSize, trainingEligible: training === "true", kind };
}

type ArchiveProvenance = Extract<MediaAsset["provenance"], { materializedFromArchive: true }>;

function archiveUpload(env: Env, request: Request): { assetId: string; provenance: ArchiveProvenance } | null {
  const source = String(request.headers.get("x-cs-source") ?? "").trim();
  if (!source) return null;
  if (source !== "archive-index" || env.BACKEND_MODE !== "self-hosted") throw new Error("invalid_media_source");
  const expectedToken = String(env.SELF_HOSTED_INTERNAL_TOKEN ?? "").trim();
  const token = String(request.headers.get("x-cs-host-token") ?? "").trim();
  if (expectedToken.length < 40 || token !== expectedToken) throw new Error("approved_login_required");
  const assetId = boundedText(request.headers.get("x-cs-media-id"), 100);
  if (!/^media_archive_[a-f0-9]{24}$/.test(assetId)) throw new Error("invalid_archive_media_id");
  let provenance: unknown;
  try { provenance = JSON.parse(decodeURIComponent(request.headers.get("x-cs-archive-provenance") ?? "")); }
  catch { throw new Error("invalid_archive_media_provenance"); }
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) throw new Error("invalid_archive_media_provenance");
  const value = provenance as Record<string, unknown>;
  if (value.materializedFromArchive !== true || value.provider !== "angelo-art-index"
    || value.requestedByOwner !== true || value.verification !== "size-match"
    || typeof value.catalogId !== "string" || typeof value.archiveEntryId !== "string"
    || typeof value.materializationId !== "string" || typeof value.materializedAt !== "string"
    || !Number.isFinite(Date.parse(value.materializedAt))
    || typeof value.sourceVersion !== "string" || typeof value.sourceFingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)
    || typeof value.sourceRecordType !== "string" || typeof value.sourceRecordId !== "string"
    || (value.inventoryRecordId !== null && typeof value.inventoryRecordId !== "string")
    || !Array.isArray(value.parentAssetIds) || value.parentAssetIds.length !== 0) {
    throw new Error("invalid_archive_media_provenance");
  }
  return { assetId, provenance: value as ArchiveProvenance };
}

export async function uploadMedia(env: Env, request: Request, ownerId: string) {
  if (!env.ARTIFACTS) throw new Error("media_storage_not_configured");
  const input = uploadHeaders(request);
  const archive = archiveUpload(env, request);
  if (archive && input.trainingEligible) throw new Error("archive_media_training_consent_forbidden");
  const project = await projectById(env, ownerId, input.projectId);
  if (!project) throw new Error("project_not_found");
  if (project.status === "archived") throw new Error("project_archived");
  if (!request.body) throw new Error("empty_media_upload");

  const assetId = archive?.assetId ?? id("media");
  const r2Key = `owners/${encodeURIComponent(ownerId)}/projects/${project.id}/media/${assetId}/source`;
  const existing = archive ? await mediaAssetById(env, ownerId, assetId) : null;
  if (existing && archive) {
    const stored = await env.ARTIFACTS.head(r2Key);
    const provenance = existing.provenance;
    if (existing.projectId !== project.id || existing.source !== "archive-index" || existing.size !== input.claimedSize
      || !stored || stored.size !== input.claimedSize || !("materializedFromArchive" in provenance)
      || provenance.materializationId !== archive.provenance.materializationId
      || provenance.archiveEntryId !== archive.provenance.archiveEntryId) throw new Error("archive_materialization_conflict");
    return existing;
  }
  await env.ARTIFACTS.put(r2Key, request.body, {
    httpMetadata: { contentType: input.mimeType },
    customMetadata: {
      ownerId,
      projectId: project.id,
      assetId,
      originalFileName: input.originalFileName,
      trainingEligible: String(input.trainingEligible),
      uploadedAt: new Date().toISOString(),
      source: archive ? "archive-index" : "upload",
      ...(archive ? { archiveEntryId: archive.provenance.archiveEntryId, materializationId: archive.provenance.materializationId } : {}),
    },
  });
  const stored = await env.ARTIFACTS.head(r2Key);
  if (!stored || stored.size <= 0 || stored.size !== input.claimedSize) {
    await env.ARTIFACTS.delete(r2Key);
    throw new Error("media_upload_verification_failed");
  }

  try {
    return await createMediaAsset(env, ownerId, {
      id: assetId,
      projectId: project.id,
      kind: input.kind,
      name: displayName(input.originalFileName),
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      size: stored.size,
      r2Key,
      trainingEligible: input.trainingEligible,
      source: archive ? "archive-index" : "upload",
      provenance: archive?.provenance ?? null,
    });
  } catch (error) {
    await env.ARTIFACTS.delete(r2Key);
    throw error;
  }
}

export function requestedMediaRange(value: string | null, size: number) {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) throw new Error("invalid_media_range");
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) throw new Error("invalid_media_range");
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    throw new Error("invalid_media_range");
  }
  const end = Math.min(requestedEnd, size - 1);
  return { offset: start, length: end - start + 1 };
}

export async function mediaContent(env: Env, request: Request, ownerId: string, mediaId: string) {
  if (!env.ARTIFACTS) throw new Error("media_storage_not_configured");
  const record = await mediaObjectById(env, ownerId, mediaId);
  if (!record) throw new Error("media_not_found");
  const range = requestedMediaRange(request.headers.get("range"), Number(record.size));
  const object = await env.ARTIFACTS.get(record.r2Key, range ? { range } : undefined);
  if (!object) throw new Error("media_content_not_found");
  const headers = new Headers({
    "cache-control": "private, max-age=3600",
    "content-type": record.mimeType,
    "content-length": String(range?.length ?? record.size),
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(record.originalFileName)}`,
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  });
  if (range) headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${record.size}`);
  object.writeHttpMetadata(headers);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
