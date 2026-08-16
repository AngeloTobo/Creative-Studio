import {
  type AcceptanceDecision,
  type Capability,
  type CreateProjectRequest,
  matchCreativeStudioRoute,
  type CreateCreativeDnaRequest,
  type CreateCreativeDnaTrainingJobRequest,
  type ClaimCreativeDnaTrainingJobRequest,
  type CompleteCreativeDnaTrainingJobRequest,
  type FailCreativeDnaTrainingJobRequest,
  type GenerationModality,
  type RetryJobRequest,
  type SaveWorkflowRevisionRequest,
  type SubmitJobRequest,
  type UpdateProjectRequest,
} from "../../shared/contracts";
import {
  afdfwGenerations,
  afdfwMedia,
  afdfwSession,
} from "../adapters/afdfw";
import { backendMode } from "../config";
import { enqueueJob } from "../jobs";
import { body, boundedText, json } from "../lib/http";
import { mediaContent, requestedMediaRange, uploadMedia } from "../media";
import {
  artifactMediaPath,
  archiveProject,
  cancelOwnedJob,
  createDevelopmentJob,
  createLocalDna,
  createProject,
  createQueuedJob,
  jobById,
  listAcceptances,
  listArtifacts,
  listJobs,
  listLocalDna,
  listMediaAssets,
  listTrainingExamples,
  listProjects,
  projectById,
  reconcileDevelopmentJobs,
  reviewArtifact,
  updateProject,
} from "../repository";
import { retainCompletedArtifact } from "../retention";
import type { Env, OwnerSession } from "../types";
import { createWorkflowRevision, importWorkflow, listWorkflows, workflowContent } from "../workflows";
import {
  cancelCreativeDnaTrainingJob,
  claimCreativeDnaTrainingJob,
  completeCreativeDnaTrainingJob,
  createCreativeDnaTrainingJob,
  creativeDnaTrainingBundle,
  failCreativeDnaTrainingJob,
  listCreativeDnaTrainingJobs,
} from "../training";

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
  if (error === "media_upload_too_large") return 413;
  if (error === "workflow_upload_too_large") return 413;
  if (error === "unsupported_media_type") return 415;
  if (error === "unsupported_workflow_type") return 415;
  if (error === "media_upload_verification_failed") return 502;
  if (error === "invalid_media_range") return 416;
  if (error === "generation_in_progress" || error === "job_not_cancellable" || error === "job_not_retryable"
    || error === "training_job_not_claimable" || error === "training_job_not_cancellable" || error === "training_job_not_completable") return 409;
  return 400;
}

function idempotencyKey(value: unknown) {
  const key = String(value ?? "").trim();
  if (!/^[a-z0-9_-]{16,100}$/i.test(key)) throw new Error("invalid_idempotency_key");
  return key;
}

function reconciliationEmail(request: Request) {
  const email = String(request.headers.get("cf-access-authenticated-user-email") ?? "").trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes("@")) throw new Error("background_identity_required");
  return email;
}

async function capabilities(env: Env, request: Request, session: OwnerSession): Promise<Capability[]> {
  const checkedAt = new Date().toISOString();
  if (developmentMode(env)) {
    return [
      { key: "creative-dna", label: "CreativeDNA v1", state: "available", provider: "Creative Studio D1", detail: "Versioned DNA is stored in the standalone Worker database.", checkedAt },
      { key: "media-library", label: "Media library", state: env.ARTIFACTS ? "available" : "unavailable", provider: env.ARTIFACTS ? "Creative Studio R2" : "not configured", detail: env.ARTIFACTS ? "Owner uploads are size-verified and retained under project scope." : "An R2 binding is required for real uploads.", checkedAt },
      { key: "workflow-library", label: "ComfyUI workflows", state: "available", provider: "Creative Studio D1", detail: "Uploaded graphs and custom settings are stored as immutable, content-hashed revisions.", checkedAt },
      { key: "creative-dna-training-data", label: "CreativeDNA training data", state: "available", provider: "Creative Studio D1", detail: "Generated results enter a candidate set; explicit acceptance promotes prompt and settings evidence to training-ready.", checkedAt },
      { key: "creative-dna-training", label: "CreativeDNA training", state: "unavailable", provider: "local runner required", detail: "Real upload-based training jobs require the Creative Studio Worker and an authenticated local trainer.", checkedAt },
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
    { key: "media-library", label: "Media library", state: env.ARTIFACTS ? "available" : "unavailable", provider: env.ARTIFACTS ? "Creative Studio R2" : "not configured", detail: env.ARTIFACTS ? "Uploaded image, audio, and video are retained with owner, project, consent, and provenance metadata." : "An R2 binding is required for real uploads.", checkedAt },
    { key: "workflow-library", label: "ComfyUI workflows", state: "available", provider: "Creative Studio D1", detail: "Workflow JSON, detected controls, models, revisions, and content hashes remain product-owned.", checkedAt },
    { key: "creative-dna-training-data", label: "CreativeDNA training data", state: "available", provider: "Creative Studio D1", detail: "Prompts and exact generation settings are candidates until artifact review makes them training-ready or excluded.", checkedAt },
    { key: "creative-dna-training", label: "CreativeDNA training", state: "degraded", provider: "Creative Studio D1 + local runner", detail: "The site can start durable upload-based training jobs. Jobs remain visibly waiting until an authenticated local runner claims and completes them.", checkedAt },
    { key: "music-generation", label: "Music generation", state: state(music), provider: "AFDFW Stable Audio adapter", detail: "Generate and list routes only; raw ComfyUI is never exposed.", checkedAt },
    { key: "image-generation", label: "Image generation", state: state(image), provider: "AFDFW Z-Image adapter", detail: "Generate, list, and media routes only; raw ComfyUI is never exposed.", checkedAt },
    { key: "artifact-review", label: "Artifact review", state: "available", provider: "Creative Studio D1", detail: "Creative Studio decisions do not silently mutate AFDFW profile or feed state.", checkedAt },
    { key: "artifact-retention", label: "Artifact retention", state: env.ARTIFACTS ? "available" : "degraded", provider: env.ARTIFACTS ? "Creative Studio R2" : "AFDFW temporary media + Creative Studio history", detail: env.ARTIFACTS ? "Every completed result is copied and size-verified under Creative Studio ownership before its job completes." : "Jobs cannot complete without a Creative Studio R2 binding.", checkedAt },
    { key: "afdfw-session", label: "AFDFW session", state: session.status === "approved" ? "available" : "unavailable", provider: "approved-session handoff", detail: "The browser sees only the same-origin Creative Studio session route.", checkedAt },
  ];
}

async function syncJobs(env: Env, ownerId: string) {
  if (developmentMode(env)) {
    await reconcileDevelopmentJobs(env, ownerId);
  }
}

export async function routeCreativeStudioApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const route = matchCreativeStudioRoute(request.method, url.pathname);
  if (!route) return json({ ok: false, error: "creative_studio_route_not_found" }, { status: 404 });

  try {
    const session = await ownerSession(env, request);
    const responseHeaders = session.setCookie ? { "set-cookie": session.setCookie } : undefined;

    if (route === "session") return json({ ok: true, session: { status: session.status, userId: session.userId, displayName: session.displayName } }, { headers: responseHeaders });
    if (route === "projects") return json({ ok: true, projects: await listProjects(env, session.userId) });
    if (route === "project-create") {
      const input = await body<CreateProjectRequest>(request);
      if (!input) return json({ ok: false, error: "invalid_json" }, { status: 400 });
      return json({ ok: true, project: await createProject(env, session.userId, input) }, { status: 201 });
    }
    if (route === "project-update") {
      const match = url.pathname.match(/^\/api\/creative-studio\/projects\/([a-z0-9_]+)$/i);
      const input = await body<UpdateProjectRequest>(request);
      if (!match || !input) return json({ ok: false, error: "invalid_project_request" }, { status: 400 });
      return json({ ok: true, project: await updateProject(env, session.userId, match[1], input) });
    }
    if (route === "project-archive") {
      const match = url.pathname.match(/^\/api\/creative-studio\/projects\/([a-z0-9_]+)\/archive$/i);
      if (!match) return json({ ok: false, error: "invalid_project_request" }, { status: 400 });
      return json({ ok: true, project: await archiveProject(env, session.userId, match[1]) });
    }
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
      await syncJobs(env, session.userId);
      return json({ ok: true, jobs: await listJobs(env, session.userId) });
    }
    if (route === "jobs-create") {
      const input = await body<SubmitJobRequest>(request);
      if (!input || !["music", "image"].includes(input.modality)) return json({ ok: false, error: "invalid_job_request" }, { status: 400 });
      const requestKey = idempotencyKey(input.idempotencyKey);
      const dnaArtifacts = await listLocalDna(env, session.userId);
      const dna = dnaArtifacts.find((item) => item.artifactId === input.dnaArtifactId);
      if (!dna) return json({ ok: false, error: "creative_dna_not_found" }, { status: 404 });
      if (dna.projectId !== input.projectId) return json({ ok: false, error: "dna_project_mismatch" }, { status: 400 });
      const project = await projectById(env, session.userId, input.projectId);
      if (!project) return json({ ok: false, error: "project_not_found" }, { status: 404 });
      if (project.status === "archived") return json({ ok: false, error: "project_archived" }, { status: 400 });
      const modality = input.modality as GenerationModality;
      if (developmentMode(env)) {
        const job = await createDevelopmentJob(env, session.userId, input.projectId, dna, modality, requestKey);
        return json({ ok: true, job }, { status: 202 });
      }
      const created = await createQueuedJob(env, session.userId, {
        projectId: input.projectId,
        dna,
        modality,
        idempotencyKey: requestKey,
        reconcileEmail: reconciliationEmail(request),
        provider: modality === "music" ? "afdfw-stable-audio-3" : "afdfw-z-image",
      });
      try { await enqueueJob(env, created.job.id); } catch (error) { console.error("creative_studio_job_enqueue_failed", created.job.id, error); }
      const job = created.job;
      return json({ ok: true, job }, { status: 202 });
    }
    if (route === "job-reuse") {
      const match = url.pathname.match(/^\/api\/creative-studio\/jobs\/([a-z0-9_]+)\/reuse$/i);
      const input = await body<RetryJobRequest>(request);
      if (!match || !input) return json({ ok: false, error: "invalid_job_request" }, { status: 400 });
      const original = await jobById(env, session.userId, match[1]);
      if (!original) throw new Error("job_not_found");
      const dna = (await listLocalDna(env, session.userId)).find((item) => item.artifactId === original.dnaArtifactId);
      if (!dna) throw new Error("creative_dna_not_found");
      const project = await projectById(env, session.userId, original.projectId);
      if (!project) throw new Error("project_not_found");
      if (project.status === "archived") throw new Error("project_archived");
      const createdAt = new Date().toISOString();
      const created = await createQueuedJob(env, session.userId, {
        projectId: original.projectId,
        dna,
        modality: original.modality,
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        reconcileEmail: developmentMode(env) ? null : reconciliationEmail(request),
        provider: developmentMode(env) ? "development-worker" : original.provider,
        promptOverride: original.settingsStamp.prompt,
        settingsStampOverride: {
          ...original.settingsStamp,
          createdAt,
          reusedFromJobId: original.id,
          provider: developmentMode(env) ? "development-worker" : original.provider,
        },
      });
      if (!developmentMode(env)) {
        try { await enqueueJob(env, created.job.id); } catch (error) { console.error("creative_studio_job_reuse_enqueue_failed", created.job.id, error); }
      }
      return json({ ok: true, job: created.job }, { status: 202 });
    }
    if (route === "job-retry") {
      const match = url.pathname.match(/^\/api\/creative-studio\/jobs\/([a-z0-9_]+)\/retry$/i);
      const input = await body<RetryJobRequest>(request);
      if (!match || !input) return json({ ok: false, error: "invalid_job_request" }, { status: 400 });
      const original = await jobById(env, session.userId, match[1]);
      if (!original) throw new Error("job_not_found");
      if (original.status !== "failed" && original.status !== "cancelled") throw new Error("job_not_retryable");
      const dna = (await listLocalDna(env, session.userId)).find((item) => item.artifactId === original.dnaArtifactId);
      if (!dna) throw new Error("creative_dna_not_found");
      const project = await projectById(env, session.userId, original.projectId);
      if (!project) throw new Error("project_not_found");
      if (project.status === "archived") throw new Error("project_archived");
      const created = await createQueuedJob(env, session.userId, {
        projectId: original.projectId,
        dna,
        modality: original.modality,
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        reconcileEmail: developmentMode(env) ? null : reconciliationEmail(request),
        provider: developmentMode(env) ? "development-worker" : original.provider,
        retryOfJobId: original.id,
      });
      if (!developmentMode(env)) {
        try { await enqueueJob(env, created.job.id); } catch (error) { console.error("creative_studio_job_retry_enqueue_failed", created.job.id, error); }
      }
      return json({ ok: true, job: created.job }, { status: 202 });
    }
    if (route === "job-cancel") {
      const match = url.pathname.match(/^\/api\/creative-studio\/jobs\/([a-z0-9_]+)\/cancel$/i);
      if (!match) return json({ ok: false, error: "invalid_job_request" }, { status: 400 });
      return json({ ok: true, job: await cancelOwnedJob(env, session.userId, match[1]) });
    }
    if (route === "artifacts-list") {
      await syncJobs(env, session.userId);
      const [artifacts, acceptances, trainingExamples] = await Promise.all([
        listArtifacts(env, session.userId), listAcceptances(env, session.userId), listTrainingExamples(env, session.userId),
      ]);
      return json({ ok: true, artifacts, acceptances, trainingExamples });
    }
    if (route === "media-list") return json({ ok: true, assets: await listMediaAssets(env, session.userId) });
    if (route === "media-upload") return json({ ok: true, asset: await uploadMedia(env, request, session.userId) }, { status: 201 });
    if (route === "media-content") {
      const match = url.pathname.match(/^\/api\/creative-studio\/media\/([a-z0-9_]+)\/content$/i);
      if (!match) return json({ ok: false, error: "invalid_media_route" }, { status: 400 });
      return await mediaContent(env, request, session.userId, match[1]);
    }
    if (route === "workflows-list") return json({ ok: true, workflows: await listWorkflows(env, session.userId) });
    if (route === "workflow-import") return json({ ok: true, workflow: await importWorkflow(env, request, session.userId) }, { status: 201 });
    if (route === "workflow-revision-create") {
      const match = url.pathname.match(/^\/api\/creative-studio\/workflows\/([a-z0-9_]+)\/revisions$/i);
      const input = await body<SaveWorkflowRevisionRequest>(request);
      if (!match || !input || !input.values || typeof input.values !== "object") return json({ ok: false, error: "invalid_workflow_revision_request" }, { status: 400 });
      return json({ ok: true, workflow: await createWorkflowRevision(env, session.userId, match[1], input) }, { status: 201 });
    }
    if (route === "workflow-content") {
      const match = url.pathname.match(/^\/api\/creative-studio\/workflows\/([a-z0-9_]+)\/content$/i);
      if (!match) return json({ ok: false, error: "invalid_workflow_route" }, { status: 400 });
      return workflowContent(env, session.userId, match[1], url.searchParams.get("revision"));
    }
    if (route === "training-jobs-list") return json({ ok: true, trainingJobs: await listCreativeDnaTrainingJobs(env, session.userId) });
    if (route === "training-job-create") {
      const input = await body<CreateCreativeDnaTrainingJobRequest>(request);
      if (!input || !Array.isArray(input.assetIds)) return json({ ok: false, error: "invalid_training_job_request" }, { status: 400 });
      const trainingJob = await createCreativeDnaTrainingJob(env, session.userId, {
        ...input,
        idempotencyKey: idempotencyKey(input.idempotencyKey),
      });
      return json({ ok: true, trainingJob }, { status: 202 });
    }
    if (route === "training-job-bundle") {
      const match = url.pathname.match(/^\/api\/creative-studio\/training-jobs\/([a-z0-9_]+)\/bundle$/i);
      if (!match) return json({ ok: false, error: "invalid_training_job_request" }, { status: 400 });
      return json({ ok: true, ...await creativeDnaTrainingBundle(env, session.userId, match[1]) });
    }
    if (route === "training-job-claim") {
      const match = url.pathname.match(/^\/api\/creative-studio\/training-jobs\/([a-z0-9_]+)\/claim$/i);
      const input = await body<ClaimCreativeDnaTrainingJobRequest>(request);
      if (!match || !input) return json({ ok: false, error: "invalid_training_job_request" }, { status: 400 });
      return json({ ok: true, trainingJob: await claimCreativeDnaTrainingJob(env, session.userId, match[1], input.runnerId) });
    }
    if (route === "training-job-complete") {
      const match = url.pathname.match(/^\/api\/creative-studio\/training-jobs\/([a-z0-9_]+)\/complete$/i);
      const input = await body<CompleteCreativeDnaTrainingJobRequest>(request);
      if (!match || !input?.dna) return json({ ok: false, error: "invalid_training_job_request" }, { status: 400 });
      return json({ ok: true, trainingJob: await completeCreativeDnaTrainingJob(env, session.userId, match[1], input) });
    }
    if (route === "training-job-fail") {
      const match = url.pathname.match(/^\/api\/creative-studio\/training-jobs\/([a-z0-9_]+)\/fail$/i);
      const input = await body<FailCreativeDnaTrainingJobRequest>(request);
      if (!match || !input) return json({ ok: false, error: "invalid_training_job_request" }, { status: 400 });
      return json({ ok: true, trainingJob: await failCreativeDnaTrainingJob(env, session.userId, match[1], input) });
    }
    if (route === "training-job-cancel") {
      const match = url.pathname.match(/^\/api\/creative-studio\/training-jobs\/([a-z0-9_]+)\/cancel$/i);
      if (!match) return json({ ok: false, error: "invalid_training_job_request" }, { status: 400 });
      return json({ ok: true, trainingJob: await cancelCreativeDnaTrainingJob(env, session.userId, match[1]) });
    }
    if (route === "artifact-review") {
      const match = url.pathname.match(/^\/api\/creative-studio\/artifacts\/([a-z0-9_]+)\/(accepted|rejected|archived)$/i);
      if (!match) return json({ ok: false, error: "invalid_review_route" }, { status: 400 });
      const decision = match[2] as AcceptanceDecision;
      const input = await body<{ note?: unknown }>(request);
      const note = boundedText(input?.note, 500);
      if ((decision === "accepted" || decision === "rejected") && !note) throw new Error("review_note_required");
      if (!developmentMode(env)) {
        const source = await artifactMediaPath(env, session.userId, match[1]);
        if (!source) throw new Error("artifact_not_found");
        if (source.mediaPath || source.retainedKey) await retainCompletedArtifact(env, request, session.userId, match[1]);
      }
      return json({ ok: true, ...await reviewArtifact(env, session.userId, match[1], decision, note) });
    }
    if (route === "artifact-media") {
      const match = url.pathname.match(/^\/api\/creative-studio\/artifacts\/([a-z0-9_]+)\/media$/i);
      const media = match ? await artifactMediaPath(env, session.userId, match[1]) : null;
      if (media?.retainedKey && env.ARTIFACTS) {
        const size = Number(media.retainedSize ?? 0);
        const range = requestedMediaRange(request.headers.get("range"), size);
        const object = await env.ARTIFACTS.get(media.retainedKey, range ? { range } : undefined);
        if (object) {
          const headers = new Headers({
            "accept-ranges": "bytes",
            "cache-control": "private, max-age=3600",
            "content-length": String(range?.length ?? size),
            "content-type": media.retainedContentType || "application/octet-stream",
            "x-content-type-options": "nosniff",
          });
          if (range) headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
          object.writeHttpMetadata(headers);
          return new Response(object.body, { status: range ? 206 : 200, headers });
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
