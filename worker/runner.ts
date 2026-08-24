import type {
  Job,
  LocalRunner,
  RunnerHeartbeatRequest,
  RunnerJobHeartbeatRequest,
} from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import { completeLocalRunnerJob, jobById, retainLocalRunnerVideoThumbnail, runnerInputById } from "./repository";
import type { Env } from "./types";
import { workflowExecutionPlan } from "./workflows";

const RUNNER_STAGES = new Set<NonNullable<Job["executionStage"]>>([
  "preparing-inputs", "enhancing-prompt", "submitting", "rendering", "downloading-output", "post-processing", "retaining",
]);

type RunnerRow = {
  id: string;
  ownerId: string;
  name: string;
  version: string | null;
  comfyUrl: string | null;
  comfyVersion: string | null;
  device: string | null;
  activeJobId: string | null;
  lastError: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type RunnerIdentity = RunnerRow;

export function supportsCreativeDnaMediaDescriptions(version: string | null) {
  const match = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 2);
}

export function supportsSongPromptEnhancement(version: string | null) {
  const match = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 6);
}

const RUNNER_COLUMNS = `id, owner_id as ownerId, name, version, comfy_url as comfyUrl,
  comfy_version as comfyVersion, device, active_job_id as activeJobId, last_error as lastError,
  last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, revoked_at as revokedAt`;

function mapRunner(row: RunnerRow): LocalRunner {
  const live = Boolean(row.lastHeartbeatAt && Date.now() - new Date(row.lastHeartbeatAt).getTime() <= 90_000);
  const state: LocalRunner["state"] = row.revokedAt ? "revoked" : !live ? "offline" : row.activeJobId ? "busy" : "online";
  const { ownerId: _ownerId, ...runner } = row;
  void _ownerId;
  return { ...runner, state };
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const encoded = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  return `csr_${encoded}`;
}

function apiBase(request: Request) {
  const url = new URL(request.url);
  return url.hostname === "cs.angelotoborg.com" ? "https://runner.cs.angelotoborg.com" : url.origin;
}

export async function listLocalRunners(env: Env, ownerId: string) {
  const result = await env.DB.prepare(`select ${RUNNER_COLUMNS} from creative_runners where owner_id = ? order by created_at desc limit 20`)
    .bind(ownerId).all<RunnerRow>();
  return (result.results ?? []).map(mapRunner);
}

export async function enrollLocalRunner(env: Env, request: Request, ownerId: string, nameValue: unknown) {
  const name = boundedText(nameValue, 80) || "Creative Studio machine";
  const current = await env.DB.prepare("select count(*) as count from creative_runners where owner_id = ? and revoked_at is null")
    .bind(ownerId).first<{ count: number }>();
  if (Number(current?.count ?? 0) >= 10) throw new Error("runner_limit_reached");
  const token = randomToken();
  const runnerId = id("runner");
  const now = new Date().toISOString();
  await env.DB.prepare(`insert into creative_runners (id, owner_id, name, token_hash, created_at)
    values (?, ?, ?, ?, ?)`)
    .bind(runnerId, ownerId, name, await hashToken(token), now).run();
  const row = await env.DB.prepare(`select ${RUNNER_COLUMNS} from creative_runners where id = ? and owner_id = ?`)
    .bind(runnerId, ownerId).first<RunnerRow>();
  if (!row) throw new Error("runner_not_found");
  return { runner: mapRunner(row), token, apiBase: apiBase(request) };
}

export async function revokeLocalRunner(env: Env, ownerId: string, runnerId: string) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("update creative_runners set revoked_at = ?, active_job_id = null where id = ? and owner_id = ? and revoked_at is null")
      .bind(now, runnerId, ownerId),
    env.DB.prepare(`update creative_jobs set status = 'queued', progress = 1, runner_id = null, runner_lease_until = null,
      error = null, execution_stage = 'queued', stage_updated_at = ?, updated_at = ?
      where owner_id = ? and runner_id = ? and execution_target = 'local-comfyui' and status = 'running'`)
      .bind(now, now, ownerId, runnerId),
    env.DB.prepare(`update creative_dna_training_jobs set status = 'waiting-for-runner', progress = 0,
      runner_id = null, runner_lease_until = null, error = null, updated_at = ?, started_at = null
      where owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(now, ownerId, runnerId),
  ]);
  const row = await env.DB.prepare(`select ${RUNNER_COLUMNS} from creative_runners where id = ? and owner_id = ?`)
    .bind(runnerId, ownerId).first<RunnerRow>();
  if (!row) throw new Error("runner_not_found");
  return mapRunner(row);
}

export async function authenticateLocalRunner(env: Env, request: Request): Promise<RunnerIdentity> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer (csr_[A-Za-z0-9_-]{40,80})$/);
  if (!match) throw new Error("runner_authentication_required");
  const row = await env.DB.prepare(`select ${RUNNER_COLUMNS} from creative_runners where token_hash = ? and revoked_at is null`)
    .bind(await hashToken(match[1])).first<RunnerRow>();
  if (!row) throw new Error("runner_authentication_required");
  return row;
}

export async function heartbeatLocalRunner(env: Env, runner: RunnerIdentity, input: RunnerHeartbeatRequest) {
  const now = new Date().toISOString();
  const version = boundedText(input.version, 40) || "unknown";
  const comfyUrl = boundedText(input.comfyUrl, 240);
  const comfyVersion = boundedText(input.comfyVersion, 80) || null;
  const device = boundedText(input.device, 160) || null;
  const activeJobId = boundedText(input.activeJobId, 100) || null;
  const error = boundedText(input.error, 500) || null;
  await env.DB.prepare(`update creative_runners set version = ?, comfy_url = ?, comfy_version = ?, device = ?,
    active_job_id = ?, last_error = ?, last_heartbeat_at = ? where id = ? and owner_id = ? and revoked_at is null`)
    .bind(version, comfyUrl, comfyVersion, device, activeJobId, error, now, runner.id, runner.ownerId).run();
  return mapRunner({ ...runner, version, comfyUrl, comfyVersion, device, activeJobId, lastError: error, lastHeartbeatAt: now });
}

export async function claimLocalRunnerJob(env: Env, runner: RunnerIdentity) {
  const now = new Date();
  const nowValue = now.toISOString();
  const candidate = await env.DB.prepare(`select id from creative_jobs
    where owner_id = ? and execution_target = 'local-comfyui' and status in ('queued', 'running')
      and (modality != 'music' or ? = 1)
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)
      and (timeout_at is null or timeout_at > ?)
    order by case when runner_id = ? then 0 else 1 end, created_at limit 1`)
    .bind(runner.ownerId, supportsSongPromptEnhancement(runner.version) ? 1 : 0, nowValue, runner.id, nowValue, runner.id).first<{ id: string }>();
  if (!candidate) return null;
  const leaseUntil = new Date(now.getTime() + 2 * 60_000).toISOString();
  const claimed = await env.DB.prepare(`update creative_jobs set status = 'running', progress = max(progress, 5),
    runner_id = ?, runner_lease_until = ?, error = null, started_at = coalesce(started_at, ?),
    execution_stage = 'preparing-inputs', stage_updated_at = ?, updated_at = ?
    where id = ? and owner_id = ? and execution_target = 'local-comfyui' and status in ('queued', 'running')
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)`)
    .bind(runner.id, leaseUntil, nowValue, nowValue, nowValue, candidate.id, runner.ownerId, nowValue, runner.id).run();
  if (!claimed.meta.changes) return null;
  await env.DB.prepare("update creative_runners set active_job_id = ?, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
    .bind(candidate.id, nowValue, runner.id, runner.ownerId).run();
  const job = await jobById(env, runner.ownerId, candidate.id);
  if (!job?.settingsStamp.workflow) throw new Error("runner_workflow_missing");
  const plan = await workflowExecutionPlan(env, runner.ownerId, job.settingsStamp.workflow.workflowId, job.settingsStamp.workflow.revisionId);
  const inputIds = [...new Set(Object.values(job.settingsStamp.inputBindings ?? {}))];
  const inputs = await Promise.all(inputIds.map((inputId) => runnerInputById(env, runner.ownerId, inputId)));
  if (inputs.some((input) => !input)) throw new Error("runner_input_source_not_found");
  if (inputs.some((input) => input?.projectId !== job.projectId)) throw new Error("runner_input_project_mismatch");
  return { job, workflow: plan.workflow, graph: plan.graph, inputs: inputs.filter((input) => Boolean(input)) };
}

export async function heartbeatLocalRunnerJob(env: Env, runner: RunnerIdentity, jobId: string, input: RunnerJobHeartbeatRequest) {
  const progress = Math.max(5, Math.min(94, Math.round(Number(input.progress) || 5)));
  const upstreamId = boundedText(input.upstreamId, 120) || null;
  const stage = RUNNER_STAGES.has(input.stage as NonNullable<Job["executionStage"]>) ? input.stage as NonNullable<Job["executionStage"]> : null;
  const now = new Date();
  if (input.promptEnhancement) {
    const current = await jobById(env, runner.ownerId, jobId);
    if (!current) throw new Error("job_not_found");
    if (current.modality !== "music") throw new Error("song_prompt_enhancement_not_allowed");
    const parameterId = boundedText(input.promptEnhancement.parameterId, 160);
    const sourcePrompt = boundedText(input.promptEnhancement.sourcePrompt, 4_000);
    const enhancedPrompt = boundedText(input.promptEnhancement.enhancedPrompt, 1_200);
    const comfyPromptId = boundedText(input.promptEnhancement.comfyPromptId, 120);
    const existing = current.settingsStamp.promptEnhancement;
    const idempotent = existing?.comfyPromptId === comfyPromptId && existing.enhancedPrompt === enhancedPrompt;
    const parameterSource = Object.prototype.hasOwnProperty.call(current.settingsStamp.parameters, parameterId)
      ? boundedText(current.settingsStamp.parameters[parameterId], 4_000)
      : "";
    const sourceWordCount = sourcePrompt.split(/\s+/).filter(Boolean).length;
    const enhancedWordCount = enhancedPrompt.split(/\s+/).filter(Boolean).length;
    if (!idempotent && (!parameterId || sourcePrompt !== boundedText(current.settingsStamp.prompt, 4_000) || parameterSource !== sourcePrompt
      || !comfyPromptId || sourceWordCount < 3 || enhancedWordCount < 12 || enhancedWordCount > 140)) {
      throw new Error("invalid_song_prompt_enhancement");
    }
    if (!idempotent) {
      const promptEnhancement = {
        schemaVersion: "creative-studio-song-prompt-enhancement/1.0" as const,
        sourcePrompt,
        enhancedPrompt,
        provider: "local-comfyui" as const,
        workflowId: "gemma4-song-prompt-enhancer" as const,
        workflowVersion: 1 as const,
        model: "gemma4_e4b_it_fp8_scaled.safetensors" as const,
        comfyPromptId,
        sourceWordCount,
        enhancedWordCount,
        createdAt: now.toISOString(),
      };
      const settingsStamp = {
        ...current.settingsStamp,
        prompt: enhancedPrompt,
        parameters: { ...current.settingsStamp.parameters, [parameterId]: enhancedPrompt },
        promptEnhancement,
      };
      const updated = await env.DB.prepare(`update creative_jobs set prompt = ?, settings_stamp_json = ?, execution_stage = 'enhancing-prompt',
        stage_updated_at = ?, updated_at = ? where id = ? and owner_id = ? and runner_id = ?
        and execution_target = 'local-comfyui' and status = 'running'`)
        .bind(enhancedPrompt, JSON.stringify(settingsStamp), now.toISOString(), now.toISOString(), jobId, runner.ownerId, runner.id).run();
      if (!updated.meta.changes) throw new Error("runner_job_not_completable");
    }
  }
  const [changed] = await env.DB.batch([
    env.DB.prepare(`update creative_jobs set progress = max(progress, ?), upstream_id = coalesce(upstream_id, ?),
      execution_stage = coalesce(?, execution_stage), stage_updated_at = case when ? is null then stage_updated_at else ? end,
      runner_lease_until = ?, updated_at = ?
      where id = ? and owner_id = ? and runner_id = ? and execution_target = 'local-comfyui' and status = 'running'`)
      .bind(progress, upstreamId, stage, stage, now.toISOString(), new Date(now.getTime() + 2 * 60_000).toISOString(), now.toISOString(), jobId, runner.ownerId, runner.id),
    env.DB.prepare("update creative_runners set active_job_id = ?, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ? and revoked_at is null")
      .bind(jobId, now.toISOString(), runner.id, runner.ownerId),
  ]);
  const job = await jobById(env, runner.ownerId, jobId);
  if (!job) throw new Error("job_not_found");
  return { continue: Boolean(changed.meta.changes), job };
}

export async function failLocalRunnerJob(env: Env, runner: RunnerIdentity, jobId: string, errorValue: unknown) {
  const error = boundedText(errorValue, 500) || "local_runner_failed";
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`update creative_jobs set status = 'failed', error = ?, progress = max(progress, 5),
    execution_stage = 'failed', stage_updated_at = ?, completed_at = ?, updated_at = ?, runner_lease_until = null where id = ? and owner_id = ? and runner_id = ?
      and execution_target = 'local-comfyui' and status = 'running'`)
    .bind(error, now, now, now, jobId, runner.ownerId, runner.id).run();
  if (!changed.meta.changes) throw new Error("runner_job_not_completable");
  await env.DB.prepare("update creative_runners set active_job_id = null, last_error = ?, last_heartbeat_at = ? where id = ? and owner_id = ?")
    .bind(error, now, runner.id, runner.ownerId).run();
  const job = await jobById(env, runner.ownerId, jobId);
  if (!job) throw new Error("job_not_found");
  return job;
}

export async function completeClaimedLocalRunnerJob(
  env: Env,
  runner: RunnerIdentity,
  jobId: string,
  body: ReadableStream,
  contentType: string,
  declaredSize: number,
) {
  return completeLocalRunnerJob(env, runner.ownerId, runner.id, jobId, body, contentType, declaredSize);
}

export async function retainClaimedLocalRunnerVideoThumbnail(
  env: Env,
  runner: RunnerIdentity,
  jobId: string,
  body: ReadableStream,
  contentType: string,
  declaredSize: number,
) {
  return retainLocalRunnerVideoThumbnail(env, runner.ownerId, runner.id, jobId, body, contentType, declaredSize);
}

export async function localRunnerMedia(env: Env, runner: RunnerIdentity, mediaId: string) {
  if (!env.ARTIFACTS) throw new Error("artifact_storage_not_configured");
  const media = await runnerInputById(env, runner.ownerId, mediaId);
  if (!media) throw new Error("media_not_found");
  const object = await env.ARTIFACTS.get(media.r2Key);
  if (!object) throw new Error("media_not_found");
  const headers = new Headers({
    "content-type": media.mimeType,
    "content-length": String(media.size),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(media.originalFileName)}`,
  });
  return new Response(object.body, { headers });
}

export function isLocalRunnerRoute(route: string) {
  return route === "runner-work-claim" || route === "runner-heartbeat" || route === "runner-job-claim" || route === "runner-job-heartbeat"
    || route === "runner-job-complete" || route === "runner-job-thumbnail" || route === "runner-job-fail" || route === "runner-media-content"
    || route === "runner-training-claim" || route === "runner-training-heartbeat"
    || route === "runner-training-complete" || route === "runner-training-fail";
}

export function localRunnerJobLabel(job: Job) {
  return job.settingsStamp.workflow ? `${job.settingsStamp.workflow.name} v${job.settingsStamp.workflow.version}` : job.modality;
}
