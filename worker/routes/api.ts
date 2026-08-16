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
  type EnrollLocalRunnerRequest,
  type RunnerHeartbeatRequest,
  type RunnerJobHeartbeatRequest,
  type RunnerFailJobRequest,
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
  runnerInputById,
  updateProject,
} from "../repository";
import { retainCompletedArtifact } from "../retention";
import type { Env, OwnerSession } from "../types";
import { createWorkflowRevision, importWorkflow, listWorkflows, workflowContent } from "../workflows";
import { workflowExecutionPlan } from "../workflows";
import {
  authenticateLocalRunner,
  claimLocalRunnerJob,
  completeClaimedLocalRunnerJob,
  enrollLocalRunner,
  failLocalRunnerJob,
  heartbeatLocalRunner,
  heartbeatLocalRunnerJob,
  isLocalRunnerRoute,
  listLocalRunners,
  localRunnerMedia,
  revokeLocalRunner,
} from "../runner";
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
  if (error === "approved_login_required" || error === "runner_authentication_required") return 401;
  if (error.endsWith("_not_found")) return 404;
  if (error.includes("not_configured") || error.startsWith("afdfw_")) return 503;
  if (error === "media_upload_too_large") return 413;
  if (error === "workflow_upload_too_large") return 413;
  if (error === "runner_output_too_large") return 413;
  if (error === "unsupported_media_type") return 415;
  if (error === "unsupported_workflow_type") return 415;
  if (error === "unsupported_runner_output_type") return 415;
  if (error === "media_upload_verification_failed") return 502;
  if (error === "invalid_media_range") return 416;
  if (error === "generation_in_progress" || error === "job_not_cancellable" || error === "job_not_retryable"
    || error === "training_job_not_claimable" || error === "training_job_not_cancellable" || error === "training_job_not_completable") return 409;
  if (error === "runner_job_not_completable") return 409;
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

function workflowJobModality(value: string): GenerationModality {
  if (value === "audio" || value === "music") return "music";
  if (value === "image" || value === "video") return value;
  throw new Error("workflow_modality_not_supported");
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
      { key: "local-runner", label: "Local Runner", state: "unavailable", provider: "not paired", detail: "Pair a Windows runner through Settings to execute API-format ComfyUI workflows.", checkedAt },
      { key: "music-generation", label: "Music generation", state: "degraded", provider: "development worker", detail: "Durable metadata and decisions are real; generated media is a development placeholder.", checkedAt },
      { key: "image-generation", label: "Image generation", state: "degraded", provider: "development worker", detail: "Durable metadata and decisions are real; generated media is a development placeholder.", checkedAt },
      { key: "video-generation", label: "Video generation", state: "unavailable", provider: "local runner required", detail: "Video workflow execution requires a paired Local Runner.", checkedAt },
      { key: "artifact-review", label: "Artifact review", state: "available", provider: "Creative Studio D1", detail: "Accept, reject, and archive decisions are explicit and append-only.", checkedAt },
      { key: "artifact-retention", label: "Artifact retention", state: "degraded", provider: "Creative Studio D1", detail: "History is durable; standalone media retention awaits the Creative Studio R2 boundary.", checkedAt },
      { key: "afdfw-session", label: "AFDFW backend", state: "unavailable", provider: "not configured", detail: "Development mode does not call AFDFW.", checkedAt },
    ];
  }

  const [music, image, runners] = await Promise.allSettled([
    afdfwGenerations(env, request, "music"),
    afdfwGenerations(env, request, "image"),
    listLocalRunners(env, session.userId),
  ]);
  const state = (result: PromiseSettledResult<unknown>) => result.status === "fulfilled" ? "available" : "unavailable";
  const runnerList = runners.status === "fulfilled" ? runners.value : [];
  const runnerAvailable = runnerList.some((runner) => runner.state === "online" || runner.state === "busy");
  return [
    { key: "creative-dna", label: "CreativeDNA v1", state: "available", provider: "Creative Studio D1", detail: "Versioned CreativeDNA remains owned by the standalone product.", checkedAt },
    { key: "media-library", label: "Media library", state: env.ARTIFACTS ? "available" : "unavailable", provider: env.ARTIFACTS ? "Creative Studio R2" : "not configured", detail: env.ARTIFACTS ? "Uploaded image, audio, and video are retained with owner, project, consent, and provenance metadata." : "An R2 binding is required for real uploads.", checkedAt },
    { key: "workflow-library", label: "ComfyUI workflows", state: "available", provider: "Creative Studio D1", detail: "Workflow JSON, detected controls, models, revisions, and content hashes remain product-owned.", checkedAt },
    { key: "creative-dna-training-data", label: "CreativeDNA training data", state: "available", provider: "Creative Studio D1", detail: "Prompts and exact generation settings are candidates until artifact review makes them training-ready or excluded.", checkedAt },
    { key: "creative-dna-training", label: "CreativeDNA training", state: "degraded", provider: "Creative Studio D1 + local runner", detail: "The site can start durable upload-based training jobs. Jobs remain visibly waiting until an authenticated local runner claims and completes them.", checkedAt },
    { key: "local-runner", label: "Local Runner", state: runnerAvailable ? "available" : "degraded", provider: "Creative Studio Windows agent", detail: runnerAvailable ? "A paired machine is online and can claim ComfyUI workflow jobs without an open browser." : "Pair and start the Windows agent in Settings to execute imported API-format workflows.", checkedAt },
    { key: "music-generation", label: "Music generation", state: state(music), provider: "AFDFW Stable Audio adapter", detail: "Generate and list routes only; raw ComfyUI is never exposed.", checkedAt },
    { key: "image-generation", label: "Image generation", state: state(image), provider: "AFDFW Z-Image adapter", detail: "Generate, list, and media routes only; raw ComfyUI is never exposed.", checkedAt },
    { key: "video-generation", label: "Video generation", state: runnerAvailable ? "available" : "degraded", provider: "Local Runner + ComfyUI", detail: runnerAvailable ? "Versioned API-format video workflows can execute on the paired machine." : "Video jobs remain durable and wait for the paired machine to come online.", checkedAt },
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

async function routeLocalRunnerRequest(request: Request, env: Env, route: NonNullable<ReturnType<typeof matchCreativeStudioRoute>>, url: URL) {
  const runner = await authenticateLocalRunner(env, request);
  if (route === "runner-heartbeat") {
    const input = await body<RunnerHeartbeatRequest>(request);
    if (!input) throw new Error("invalid_runner_request");
    return json({ ok: true, runner: await heartbeatLocalRunner(env, runner, input) });
  }
  if (route === "runner-job-claim") {
    return json({ ok: true, bundle: await claimLocalRunnerJob(env, runner) });
  }
  if (route === "runner-job-heartbeat") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/jobs\/([a-z0-9_]+)\/heartbeat$/i);
    const input = await body<RunnerJobHeartbeatRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, ...await heartbeatLocalRunnerJob(env, runner, match[1], input) });
  }
  if (route === "runner-job-fail") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/jobs\/([a-z0-9_]+)\/fail$/i);
    const input = await body<RunnerFailJobRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, job: await failLocalRunnerJob(env, runner, match[1], input.error) });
  }
  if (route === "runner-job-complete") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/jobs\/([a-z0-9_]+)\/complete$/i);
    if (!match || !request.body) throw new Error("empty_runner_output");
    const declaredSize = Number(request.headers.get("x-cs-file-size") ?? request.headers.get("content-length"));
    const job = await completeClaimedLocalRunnerJob(env, runner, match[1], request.body, request.headers.get("content-type") ?? "", declaredSize);
    return json({ ok: true, job });
  }
  if (route === "runner-media-content") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/media\/([a-z0-9_]+)$/i);
    if (!match) throw new Error("invalid_runner_request");
    return localRunnerMedia(env, runner, match[1]);
  }
  throw new Error("creative_studio_route_not_found");
}

export async function routeCreativeStudioApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const route = matchCreativeStudioRoute(request.method, url.pathname);
  if (!route) return json({ ok: false, error: "creative_studio_route_not_found" }, { status: 404 });

  try {
    if (isLocalRunnerRoute(route)) return await routeLocalRunnerRequest(request, env, route, url);
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
      if (!input || !["music", "image", "video"].includes(input.modality)) return json({ ok: false, error: "invalid_job_request" }, { status: 400 });
      const requestKey = idempotencyKey(input.idempotencyKey);
      const dnaArtifacts = await listLocalDna(env, session.userId);
      const dna = dnaArtifacts.find((item) => item.artifactId === input.dnaArtifactId);
      if (!dna) return json({ ok: false, error: "creative_dna_not_found" }, { status: 404 });
      if (dna.projectId !== input.projectId) return json({ ok: false, error: "dna_project_mismatch" }, { status: 400 });
      const project = await projectById(env, session.userId, input.projectId);
      if (!project) return json({ ok: false, error: "project_not_found" }, { status: 404 });
      if (project.status === "archived") return json({ ok: false, error: "project_archived" }, { status: 400 });
      const modality = input.modality as GenerationModality;
      if (input.workflow) {
        if (!input.workflow.workflowId || !input.workflow.revisionId || !input.workflow.inputBindings || typeof input.workflow.inputBindings !== "object") {
          throw new Error("invalid_workflow_job_request");
        }
        const plan = await workflowExecutionPlan(env, session.userId, boundedText(input.workflow.workflowId, 100), boundedText(input.workflow.revisionId, 100));
        if (plan.workflow.projectId !== input.projectId) throw new Error("workflow_project_mismatch");
        const expectedModality = workflowJobModality(plan.workflow.modality);
        if (expectedModality !== modality) throw new Error("workflow_modality_mismatch");
        const mediaParameters = plan.workflow.currentRevision.parameters.filter((parameter) => parameter.kind === "media");
        const allowedParameters = new Map(mediaParameters.map((parameter) => [parameter.id, parameter]));
        const inputBindings = Object.fromEntries(Object.entries(input.workflow.inputBindings)
          .map(([parameterId, assetId]) => [boundedText(parameterId, 180), boundedText(assetId, 100)])
          .filter(([parameterId, assetId]) => Boolean(parameterId && assetId))) as Record<string, string>;
        if (Object.keys(inputBindings).some((parameterId) => !allowedParameters.has(parameterId))) throw new Error("unknown_workflow_media_parameter");
        if (mediaParameters.some((parameter) => !inputBindings[parameter.id])) throw new Error("workflow_media_input_required");
        const resolvedInputs = await Promise.all(mediaParameters.map(async (parameter) => ({
          parameter,
          input: await runnerInputById(env, session.userId, inputBindings[parameter.id]),
        })));
        for (const { parameter, input: resolvedInput } of resolvedInputs) {
          if (!resolvedInput) throw new Error("runner_input_source_not_found");
          if (resolvedInput.projectId !== input.projectId) throw new Error("runner_input_project_mismatch");
          if (parameter.mediaKind && resolvedInput.kind !== parameter.mediaKind) {
            throw new Error("runner_input_media_mismatch");
          }
        }
        const inputSources = resolvedInputs.map(({ input: resolvedInput }) => ({
          id: resolvedInput!.id,
          source: resolvedInput!.source,
          kind: resolvedInput!.kind,
        }));
        const parameterValues = Object.fromEntries(plan.workflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value]));
        const workflowPrompt = plan.workflow.currentRevision.parameters
          .filter((parameter) => parameter.kind === "text" && /prompt|caption|lyrics|text/i.test(`${parameter.label} ${parameter.id}`))
          .map((parameter) => String(parameter.value).trim()).filter(Boolean).join("\n\n");
        const prompt = boundedText(workflowPrompt, 2_000) || dna.generationPrompts[modality === "music" ? "music" : "image"];
        const createdAt = new Date().toISOString();
        const created = await createQueuedJob(env, session.userId, {
          projectId: input.projectId,
          dna,
          modality,
          idempotencyKey: requestKey,
          reconcileEmail: null,
          provider: "local-comfyui",
          promptOverride: prompt,
          executionTarget: "local-comfyui",
          workflowId: plan.workflow.id,
          workflowRevisionId: plan.workflow.currentRevision.id,
          settingsStampOverride: {
            schemaVersion: 1,
            source: "comfyui-workflow",
            createdAt,
            reusedFromJobId: null,
            prompt,
            provider: "local-comfyui",
            modality,
            workflow: {
              workflowId: plan.workflow.id,
              revisionId: plan.workflow.currentRevision.id,
              version: plan.workflow.currentRevision.version,
              name: plan.workflow.name,
              format: plan.workflow.currentRevision.format,
              contentHash: plan.workflow.currentRevision.contentHash,
            },
            parameters: parameterValues,
            models: plan.workflow.currentRevision.models,
            inputAssetIds: inputSources.filter((inputSource) => inputSource.source === "upload").map((inputSource) => inputSource.id),
            inputArtifactIds: inputSources.filter((inputSource) => inputSource.source === "artifact").map((inputSource) => inputSource.id),
            inputSources,
            inputBindings,
          },
        });
        return json({ ok: true, job: created.job }, { status: 202 });
      }
      if (modality === "video") throw new Error("video_workflow_required");
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
      const localWorkflow = original.settingsStamp.source === "comfyui-workflow" && Boolean(original.settingsStamp.workflow);
      const createdAt = new Date().toISOString();
      const created = await createQueuedJob(env, session.userId, {
        projectId: original.projectId,
        dna,
        modality: original.modality,
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        reconcileEmail: developmentMode(env) || localWorkflow ? null : reconciliationEmail(request),
        provider: localWorkflow ? original.provider : developmentMode(env) ? "development-worker" : original.provider,
        promptOverride: original.settingsStamp.prompt,
        executionTarget: localWorkflow ? "local-comfyui" : "afdfw",
        workflowId: original.settingsStamp.workflow?.workflowId ?? null,
        workflowRevisionId: original.settingsStamp.workflow?.revisionId ?? null,
        settingsStampOverride: {
          ...original.settingsStamp,
          createdAt,
          reusedFromJobId: original.id,
          provider: localWorkflow ? original.provider : developmentMode(env) ? "development-worker" : original.provider,
        },
      });
      if (!developmentMode(env) && !localWorkflow) {
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
      const localWorkflow = original.settingsStamp.source === "comfyui-workflow" && Boolean(original.settingsStamp.workflow);
      const resumeLocalUpstream = localWorkflow && original.status === "failed" && Boolean(original.upstreamId)
        && /timeout|timed_out|output_download|retention|artifact_storage|fetch failed/i.test(original.error ?? "");
      const createdAt = new Date().toISOString();
      const created = await createQueuedJob(env, session.userId, {
        projectId: original.projectId,
        dna,
        modality: original.modality,
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        reconcileEmail: developmentMode(env) || localWorkflow ? null : reconciliationEmail(request),
        provider: localWorkflow ? original.provider : developmentMode(env) ? "development-worker" : original.provider,
        retryOfJobId: original.id,
        promptOverride: original.settingsStamp.prompt,
        executionTarget: localWorkflow ? "local-comfyui" : "afdfw",
        workflowId: original.settingsStamp.workflow?.workflowId ?? null,
        workflowRevisionId: original.settingsStamp.workflow?.revisionId ?? null,
        upstreamId: resumeLocalUpstream ? original.upstreamId : null,
        settingsStampOverride: localWorkflow ? {
          ...original.settingsStamp,
          createdAt,
          reusedFromJobId: original.id,
        } : undefined,
      });
      if (!developmentMode(env) && !localWorkflow) {
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
    if (route === "runners-list") return json({ ok: true, runners: await listLocalRunners(env, session.userId) });
    if (route === "runner-enroll") {
      const input = await body<EnrollLocalRunnerRequest>(request);
      if (!input) return json({ ok: false, error: "invalid_runner_request" }, { status: 400 });
      return json({ ok: true, ...await enrollLocalRunner(env, request, session.userId, input.name) }, { status: 201 });
    }
    if (route === "runner-revoke") {
      const match = url.pathname.match(/^\/api\/creative-studio\/runners\/([a-z0-9_]+)\/revoke$/i);
      if (!match) return json({ ok: false, error: "invalid_runner_request" }, { status: 400 });
      return json({ ok: true, runner: await revokeLocalRunner(env, session.userId, match[1]) });
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
