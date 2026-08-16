import {
  type AcceptanceDecision,
  type Capability,
  matchCreativeStudioRoute,
  type CreateCreativeDnaRequest,
  type GenerationModality,
  type SubmitJobRequest,
} from "../../shared/contracts";
import {
  afdfwGenerations,
  afdfwMedia,
  afdfwSession,
  afdfwSubmitGeneration,
} from "../adapters/afdfw";
import { backendMode } from "../config";
import { body, boundedText, json } from "../lib/http";
import {
  artifactMediaPath,
  createAfdfwJob,
  createDevelopmentJob,
  createLocalDna,
  ensureProjects,
  listAcceptances,
  listArtifacts,
  listJobs,
  listLocalDna,
  listProjects,
  reconcileAfdfwGenerations,
  reconcileDevelopmentJobs,
  retainArtifactMedia,
  reviewArtifact,
} from "../repository";
import type { Env, OwnerSession } from "../types";

function developmentMode(env: Env) {
  return backendMode(env) === "development";
}

async function ownerSession(env: Env, request: Request): Promise<OwnerSession> {
  if (developmentMode(env)) return { status: "development", userId: "development-angelo", displayName: "Angelo" };
  return afdfwSession(env, request);
}

function statusFor(error: string) {
  if (error === "approved_login_required") return 401;
  if (error.endsWith("_not_found")) return 404;
  if (error.includes("not_configured") || error.startsWith("afdfw_")) return 503;
  if (error === "generation_in_progress") return 409;
  return 400;
}

async function capabilities(env: Env, request: Request, session: OwnerSession): Promise<Capability[]> {
  const checkedAt = new Date().toISOString();
  if (developmentMode(env)) {
    return [
      { key: "creative-dna", label: "CreativeDNA v1", state: "available", provider: "Creative Studio D1", detail: "Versioned DNA is stored in the standalone Worker database.", checkedAt },
      { key: "music-generation", label: "Music generation", state: "degraded", provider: "development worker", detail: "Durable metadata and decisions are real; generated media is a development placeholder.", checkedAt },
      { key: "image-generation", label: "Image generation", state: "degraded", provider: "development worker", detail: "Durable metadata and decisions are real; generated media is a development placeholder.", checkedAt },
      { key: "artifact-review", label: "Artifact review", state: "available", provider: "Creative Studio D1", detail: "Accept, reject, and archive decisions are explicit and append-only.", checkedAt },
      { key: "artifact-retention", label: "Artifact retention", state: "degraded", provider: "Creative Studio D1", detail: "History is durable; standalone media retention awaits the Creative Studio R2 boundary.", checkedAt },
      { key: "afdfw-session", label: "AFDFW backend", state: "unavailable", provider: "not configured", detail: "Development mode does not call AFDFW.", checkedAt },
    ];
  }

  const [music, image] = await Promise.allSettled([
    afdfwGenerations(env, request, "music"),
    afdfwGenerations(env, request, "image"),
  ]);
  const state = (result: PromiseSettledResult<unknown>) => result.status === "fulfilled" ? "available" : "unavailable";
  return [
    { key: "creative-dna", label: "CreativeDNA v1", state: "available", provider: "Creative Studio D1", detail: "Versioned CreativeDNA remains owned by the standalone product.", checkedAt },
    { key: "music-generation", label: "Music generation", state: state(music), provider: "AFDFW Stable Audio adapter", detail: "Generate and list routes only; raw ComfyUI is never exposed.", checkedAt },
    { key: "image-generation", label: "Image generation", state: state(image), provider: "AFDFW Z-Image adapter", detail: "Generate, list, and media routes only; raw ComfyUI is never exposed.", checkedAt },
    { key: "artifact-review", label: "Artifact review", state: "available", provider: "Creative Studio D1", detail: "Creative Studio decisions do not silently mutate AFDFW profile or feed state.", checkedAt },
    { key: "artifact-retention", label: "Artifact retention", state: env.ARTIFACTS ? "available" : "degraded", provider: env.ARTIFACTS ? "Creative Studio R2" : "AFDFW temporary media + Creative Studio history", detail: env.ARTIFACTS ? "Accepted generated media is retained under Creative Studio ownership." : "Metadata is durable; standalone retained media requires a Creative Studio R2 binding.", checkedAt },
    { key: "afdfw-session", label: "AFDFW session", state: session.status === "approved" ? "available" : "unavailable", provider: "approved-session handoff", detail: "The browser sees only the same-origin Creative Studio session route.", checkedAt },
  ];
}

async function syncJobs(env: Env, request: Request, ownerId: string) {
  if (developmentMode(env)) {
    await reconcileDevelopmentJobs(env, ownerId);
    return;
  }
  const [music, image] = await Promise.allSettled([
    afdfwGenerations(env, request, "music"),
    afdfwGenerations(env, request, "image"),
  ]);
  if (music.status === "fulfilled") await reconcileAfdfwGenerations(env, ownerId, "music", music.value.generations);
  if (image.status === "fulfilled") await reconcileAfdfwGenerations(env, ownerId, "image", image.value.generations);
}

export async function routeCreativeStudioApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const route = matchCreativeStudioRoute(request.method, url.pathname);
  if (!route) return json({ ok: false, error: "creative_studio_route_not_found" }, { status: 404 });

  try {
    const session = await ownerSession(env, request);
    await ensureProjects(env, session.userId);
    const responseHeaders = session.setCookie ? { "set-cookie": session.setCookie } : undefined;

    if (route === "session") return json({ ok: true, session: { status: session.status, userId: session.userId, displayName: session.displayName } }, { headers: responseHeaders });
    if (route === "projects") return json({ ok: true, projects: await listProjects(env, session.userId) });
    if (route === "dna-list") {
      const artifacts = await listLocalDna(env, session.userId);
      return json({ ok: true, artifacts });
    }
    if (route === "dna-create") {
      const input = await body<CreateCreativeDnaRequest>(request);
      if (!input) return json({ ok: false, error: "invalid_json" }, { status: 400 });
      const artifact = await createLocalDna(env, session.userId, input);
      return json({ ok: true, artifact }, { status: 201 });
    }
    if (route === "jobs-list") {
      await syncJobs(env, request, session.userId);
      return json({ ok: true, jobs: await listJobs(env, session.userId) });
    }
    if (route === "jobs-create") {
      const input = await body<SubmitJobRequest>(request);
      if (!input || !["music", "image"].includes(input.modality)) return json({ ok: false, error: "invalid_job_request" }, { status: 400 });
      const dnaArtifacts = await listLocalDna(env, session.userId);
      const dna = dnaArtifacts.find((item) => item.artifactId === input.dnaArtifactId);
      if (!dna) return json({ ok: false, error: "creative_dna_not_found" }, { status: 404 });
      const modality = input.modality as GenerationModality;
      const job = developmentMode(env)
        ? await createDevelopmentJob(env, session.userId, input.projectId, dna, modality)
        : await createAfdfwJob(env, session.userId, input.projectId, dna, modality, (await afdfwSubmitGeneration(env, request, modality, dna.generationPrompts[modality])).generation);
      return json({ ok: true, job }, { status: 202 });
    }
    if (route === "artifacts-list") {
      await syncJobs(env, request, session.userId);
      return json({ ok: true, artifacts: await listArtifacts(env, session.userId), acceptances: await listAcceptances(env, session.userId) });
    }
    if (route === "artifact-review") {
      const match = url.pathname.match(/^\/api\/creative-studio\/artifacts\/([a-z0-9_]+)\/(accepted|rejected|archived)$/i);
      if (!match) return json({ ok: false, error: "invalid_review_route" }, { status: 400 });
      const decision = match[2] as AcceptanceDecision;
      const input = await body<{ note?: unknown }>(request);
      if (decision === "accepted" && !developmentMode(env)) {
        const source = await artifactMediaPath(env, session.userId, match[1]);
        if (!source) throw new Error("artifact_not_found");
        if (!source.retainedKey && source.mediaPath) {
          const mediaResponse = await afdfwMedia(env, request, source.mediaPath);
          if (!mediaResponse.ok) throw new Error(`afdfw_media_${mediaResponse.status}`);
          const declaredSize = Number(mediaResponse.headers.get("content-length") || 0);
          if (declaredSize > 100 * 1024 * 1024) throw new Error("artifact_media_too_large");
          const bytes = await mediaResponse.arrayBuffer();
          if (bytes.byteLength > 100 * 1024 * 1024) throw new Error("artifact_media_too_large");
          const contentType = (mediaResponse.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
          const extension = contentType === "image/png" ? "png"
            : contentType === "image/jpeg" ? "jpg"
              : contentType === "image/webp" ? "webp"
                : contentType === "audio/mpeg" ? "mp3"
                  : contentType === "audio/wav" || contentType === "audio/x-wav" ? "wav"
                    : contentType === "audio/flac" ? "flac"
                      : "bin";
          await retainArtifactMedia(env, session.userId, match[1], { bytes, contentType, extension });
        }
      }
      return json({ ok: true, ...await reviewArtifact(env, session.userId, match[1], decision, boundedText(input?.note, 500)) });
    }
    if (route === "artifact-media") {
      const match = url.pathname.match(/^\/api\/creative-studio\/artifacts\/([a-z0-9_]+)\/media$/i);
      const media = match ? await artifactMediaPath(env, session.userId, match[1]) : null;
      if (media?.retainedKey && env.ARTIFACTS) {
        const object = await env.ARTIFACTS.get(media.retainedKey);
        if (object) {
          const headers = new Headers({ "cache-control": "private, max-age=3600", "content-type": media.retainedContentType || "application/octet-stream" });
          object.writeHttpMetadata(headers);
          return new Response(object.body, { headers });
        }
      }
      if (!media?.mediaPath) return json({ ok: false, error: "artifact_media_not_found" }, { status: 404 });
      return afdfwMedia(env, request, media.mediaPath);
    }
    if (route === "capabilities") return json({ ok: true, capabilities: await capabilities(env, request, session) });
    return json({ ok: false, error: "creative_studio_route_not_found" }, { status: 404 });
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : "creative_studio_request_failed";
    return json({ ok: false, error }, { status: statusFor(error) });
  }
}
