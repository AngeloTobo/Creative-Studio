import { afdfwMedia } from "./adapters/afdfw";
import { artifactMediaPath, finalizeRetainedArtifact, retainArtifactMedia } from "./repository";
import type { Env } from "./types";

function mediaExtension(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  if (contentType === "audio/mpeg") return "mp3";
  if (contentType === "audio/wav" || contentType === "audio/x-wav") return "wav";
  if (contentType === "audio/flac") return "flac";
  return "bin";
}

export async function retainCompletedArtifact(env: Env, request: Request, ownerId: string, artifactId: string) {
  const source = await artifactMediaPath(env, ownerId, artifactId);
  if (!source) throw new Error("artifact_not_found");
  if (source.retainedKey) {
    await retainArtifactMedia(env, ownerId, artifactId, null);
    return finalizeRetainedArtifact(env, ownerId, artifactId);
  }
  if (!source.mediaPath) throw new Error("artifact_media_not_found");

  const response = await afdfwMedia(env, request, source.mediaPath);
  if (!response.ok) throw new Error(`afdfw_media_${response.status}`);
  if (!response.body) throw new Error("artifact_media_empty");
  const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const declared = Number(response.headers.get("content-length") || 0);
  await retainArtifactMedia(env, ownerId, artifactId, {
    body: response.body,
    contentType,
    extension: mediaExtension(contentType),
    declaredSize: declared > 0 ? declared : null,
  });
  return finalizeRetainedArtifact(env, ownerId, artifactId);
}
