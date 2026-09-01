import type {
  Job,
  LocalRunner,
  RunnerHeartbeatRequest,
  RunnerJobHeartbeatRequest,
  VideoDoctorFinding,
  VideoDoctorReport,
} from "../shared/contracts";
import { musicPromptProfileForIdentity, VIDEO_DOCTOR_FINDING_CODES, VIDEO_DOCTOR_SCHEMA_VERSION } from "../shared/contracts";
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
  comfyReady: number | null;
  device: string | null;
  activeJobId: string | null;
  modelTrainingProvidersJson: string;
  lastError: string | null;
  videoDoctorJson: string | null;
  videoDoctorCheckedAt: string | null;
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
  return major > 1 || (major === 1 && minor >= 7);
}

export function supportsStoryPlanning(version: string | null) {
  const match = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 17);
}

export function supportsVideoExtensionGeneratedSound(version: string | null) {
  const match = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 20);
}

const RUNNER_COLUMNS = `id, owner_id as ownerId, name, version, comfy_url as comfyUrl,
  comfy_version as comfyVersion, comfy_ready as comfyReady, device, active_job_id as activeJobId, last_error as lastError,
  video_doctor_json as videoDoctorJson, video_doctor_checked_at as videoDoctorCheckedAt,
  model_training_providers_json as modelTrainingProvidersJson,
  last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, revoked_at as revokedAt`;

const VIDEO_DOCTOR_CODES = new Set<string>(VIDEO_DOCTOR_FINDING_CODES);
const VIDEO_DOCTOR_STATUSES = new Set(["ready", "working", "attention", "blocked", "unknown"]);
const VIDEO_DOCTOR_QUEUE_STATES = new Set(["idle", "busy", "unreachable", "invalid", "unknown"]);
const VIDEO_DOCTOR_LOG_STATES = new Set(["current", "stale", "unavailable", "not-configured"]);
const VIDEO_DOCTOR_API_STATES = new Set(["available", "unavailable", "unknown"]);
const VIDEO_DOCTOR_SEVERITIES = new Set(["info", "warning", "critical"]);
const VIDEO_DOCTOR_JOB_STATES = new Set(["queued", "running", "retaining", "completed", "failed", "cancelled"]);
const VIDEO_DOCTOR_FRESHNESS_MS = 3 * 60_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function diagnosticIdentifier(value: unknown, maximum: number) {
  const text = boundedText(value, maximum);
  return text && /^[a-z0-9_.:-]+$/i.test(text) ? text : null;
}

function diagnosticDate(value: unknown) {
  const text = boundedText(value, 40);
  const time = Date.parse(text);
  if (!Number.isFinite(time) || time > Date.now() + 60_000) return null;
  return new Date(time).toISOString();
}

function normalizeVideoDoctor(value: unknown, trustedStoredFields = false): VideoDoctorReport | null {
  const input = record(value);
  const queueInput = record(input?.queue);
  const logInput = record(input?.log);
  if (!input || input.schemaVersion !== VIDEO_DOCTOR_SCHEMA_VERSION || !queueInput || !logInput) return null;
  const status = boundedText(input.status, 20);
  const queueState = boundedText(queueInput.state, 20);
  const logState = boundedText(logInput.state, 24);
  const systemStats = boundedText(input.systemStats, 20);
  const checkedAt = diagnosticDate(input.checkedAt);
  if (!checkedAt || !VIDEO_DOCTOR_STATUSES.has(status) || !VIDEO_DOCTOR_QUEUE_STATES.has(queueState)
    || !VIDEO_DOCTOR_LOG_STATES.has(logState) || !VIDEO_DOCTOR_API_STATES.has(systemStats)) return null;
  const findings = (Array.isArray(input.findings) ? input.findings : []).slice(0, 8).flatMap((candidate): VideoDoctorFinding[] => {
    const item = record(candidate);
    const code = boundedText(item?.code, 50);
    const severity = boundedText(item?.severity, 20);
    if (!item || !VIDEO_DOCTOR_CODES.has(code) || !VIDEO_DOCTOR_SEVERITIES.has(severity)) return [];
    const count = item.count === null || item.count === undefined ? Number.NaN : Number(item.count);
    return [{
      code: code as VideoDoctorFinding["code"],
      severity: severity as VideoDoctorFinding["severity"],
      count: Number.isFinite(count) ? Math.max(0, Math.min(10_000, Math.round(count))) : null,
      nodeId: diagnosticIdentifier(item.nodeId, 80),
      nodeType: diagnosticIdentifier(item.nodeType, 120),
    }];
  });
  const storedStatus = boundedText(queueInput.jobStatus, 20);
  return {
    schemaVersion: VIDEO_DOCTOR_SCHEMA_VERSION,
    status: status as VideoDoctorReport["status"],
    canClaimVideo: input.canClaimVideo === true,
    checkedAt,
    systemStats: systemStats as VideoDoctorReport["systemStats"],
    queue: {
      state: queueState as VideoDoctorReport["queue"]["state"],
      running: Math.max(0, Math.min(100, Math.round(Number(queueInput.running) || 0))),
      pending: Math.max(0, Math.min(100, Math.round(Number(queueInput.pending) || 0))),
      promptId: diagnosticIdentifier(queueInput.promptId, 120),
      creativeStudioJobId: diagnosticIdentifier(queueInput.creativeStudioJobId, 100),
      promptStartedAt: diagnosticDate(queueInput.promptStartedAt),
      activeJobMatch: typeof queueInput.activeJobMatch === "boolean" ? queueInput.activeJobMatch : null,
      jobStatus: trustedStoredFields && VIDEO_DOCTOR_JOB_STATES.has(storedStatus)
        ? storedStatus as VideoDoctorReport["queue"]["jobStatus"] : null,
      blockedVideoJobs: trustedStoredFields ? Math.max(0, Math.min(1_000, Math.round(Number(queueInput.blockedVideoJobs) || 0))) : 0,
    },
    log: { state: logState as VideoDoctorReport["log"]["state"], updatedAt: diagnosticDate(logInput.updatedAt) },
    findings,
  };
}

async function enrichVideoDoctor(env: Env, runner: RunnerIdentity, report: VideoDoctorReport) {
  const jobId = report.queue.creativeStudioJobId;
  if (report.queue.state !== "busy" || !jobId || report.queue.activeJobMatch !== false) return report;
  const context = await env.DB.prepare(`select
    (select status from creative_jobs where owner_id = ? and id = ?) as jobStatus,
    (select upstream_id from creative_jobs where owner_id = ? and id = ?) as upstreamId,
    (select count(*) from creative_jobs where owner_id = ? and execution_target = 'local-comfyui'
      and modality = 'video' and status = 'queued') as blockedVideoJobs`)
    .bind(runner.ownerId, jobId, runner.ownerId, jobId, runner.ownerId)
    .first<{ jobStatus: string | null; upstreamId: string | null; blockedVideoJobs: number | null }>();
  const jobStatus = VIDEO_DOCTOR_JOB_STATES.has(context?.jobStatus ?? "")
    ? context!.jobStatus as VideoDoctorReport["queue"]["jobStatus"] : null;
  const terminal = jobStatus === "completed" || jobStatus === "failed" || jobStatus === "cancelled";
  const exactPrompt = Boolean(report.queue.promptId && context?.upstreamId === report.queue.promptId);
  const findings = terminal && exactPrompt
    ? [
      { code: "orphaned-terminal-prompt", severity: "critical", count: null, nodeId: null, nodeType: null } as VideoDoctorFinding,
      ...report.findings.filter((item) => item.code !== "unowned-comfy-prompt" && item.code !== "orphaned-terminal-prompt"),
    ].slice(0, 8)
    : report.findings;
  return {
    ...report,
    status: terminal && exactPrompt ? "blocked" as const : report.status,
    canClaimVideo: terminal && exactPrompt ? false : report.canClaimVideo,
    queue: {
      ...report.queue,
      jobStatus,
      blockedVideoJobs: Math.max(0, Math.min(1_000, Math.round(Number(context?.blockedVideoJobs) || 0))),
    },
    findings,
  };
}

function mapRunner(row: RunnerRow): LocalRunner {
  const live = Boolean(row.lastHeartbeatAt && Date.now() - new Date(row.lastHeartbeatAt).getTime() <= 90_000);
  const state: LocalRunner["state"] = row.revokedAt ? "revoked" : !live ? "offline" : row.activeJobId ? "busy" : "online";
  const {
    ownerId: _ownerId,
    modelTrainingProvidersJson,
    comfyReady: storedComfyReady,
    videoDoctorJson,
    videoDoctorCheckedAt,
    ...runner
  } = row;
  void _ownerId;
  let modelTrainingProviders: LocalRunner["modelTrainingProviders"] = [];
  try {
    const parsed = JSON.parse(modelTrainingProvidersJson || "[]") as unknown;
    if (Array.isArray(parsed)) modelTrainingProviders = parsed.filter((value): value is "ace-step-1.5-lora" => value === "ace-step-1.5-lora");
  } catch { modelTrainingProviders = []; }
  const storedVideoDoctor = (() => {
    try { return normalizeVideoDoctor(JSON.parse(videoDoctorJson || "null"), true); } catch { return null; }
  })();
  const doctorTime = Date.parse(videoDoctorCheckedAt || storedVideoDoctor?.checkedAt || "");
  const videoDoctor = storedVideoDoctor && Number.isFinite(doctorTime) && Date.now() - doctorTime <= VIDEO_DOCTOR_FRESHNESS_MS
    ? storedVideoDoctor : null;
  return { ...runner, comfyReady: storedComfyReady === null ? null : storedComfyReady === 1, videoDoctor, modelTrainingProviders, state };
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
    env.DB.prepare(`update creative_model_training_jobs set status = 'waiting-for-runner',
      runner_id = null, runner_lease_until = null, error = null, updated_at = ?
      where owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(now, ownerId, runnerId),
    env.DB.prepare(`update creative_prompt_enhancements set status = 'waiting-for-runner', progress = 0,
      runner_id = null, runner_lease_until = null, error = null, updated_at = ?, started_at = null
      where owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(now, ownerId, runnerId),
    env.DB.prepare(`update creative_video_script_drafts set status = 'waiting-for-runner', progress = 0,
      runner_id = null, runner_lease_until = null, error = null, updated_at = ?, started_at = null
      where owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(now, ownerId, runnerId),
    env.DB.prepare(`update creative_story_refreshes set status = 'waiting-for-runner', runner_id = null,
      runner_lease_until = null, error = null, updated_at = ?, started_at = null
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
  const comfyReady = typeof input.comfyReady === "boolean" ? (input.comfyReady ? 1 : 0) : null;
  const device = boundedText(input.device, 160) || null;
  const activeJobId = boundedText(input.activeJobId, 100) || null;
  const error = boundedText(input.error, 500) || null;
  const modelTrainingProviders = [...new Set((input.modelTrainingProviders ?? []).filter((provider) => provider === "ace-step-1.5-lora"))];
  const normalizedDoctor = normalizeVideoDoctor(input.videoDoctor);
  const videoDoctor = normalizedDoctor ? await enrichVideoDoctor(env, runner, normalizedDoctor) : null;
  await env.DB.prepare(`update creative_runners set version = ?, comfy_url = ?, comfy_version = ?, device = ?,
    comfy_ready = coalesce(?, comfy_ready), active_job_id = ?, model_training_providers_json = ?, last_error = ?,
    video_doctor_json = coalesce(?, video_doctor_json), video_doctor_checked_at = coalesce(?, video_doctor_checked_at),
    last_heartbeat_at = ? where id = ? and owner_id = ? and revoked_at is null`)
    .bind(version, comfyUrl, comfyVersion, device, comfyReady, activeJobId, JSON.stringify(modelTrainingProviders), error,
      videoDoctor ? JSON.stringify(videoDoctor) : null, videoDoctor?.checkedAt ?? null, now, runner.id, runner.ownerId).run();
  return mapRunner({
    ...runner, version, comfyUrl, comfyVersion, comfyReady: comfyReady ?? runner.comfyReady, device, activeJobId,
    modelTrainingProvidersJson: JSON.stringify(modelTrainingProviders), lastError: error,
    videoDoctorJson: videoDoctor ? JSON.stringify(videoDoctor) : runner.videoDoctorJson,
    videoDoctorCheckedAt: videoDoctor?.checkedAt ?? runner.videoDoctorCheckedAt, lastHeartbeatAt: now,
  });
}

async function automationJobMayContinue(env: Env, runner: RunnerIdentity, jobId: string, now: string) {
  const row = await env.DB.prepare(`select j.automation_session_id as automationSessionId,
    s.status as sessionStatus, s.cutoff_at as cutoffAt from creative_jobs j
    left join creative_overnight_sessions s on s.id = j.automation_session_id and s.owner_id = j.owner_id
    where j.id = ? and j.owner_id = ?`).bind(jobId, runner.ownerId)
    .first<{ automationSessionId: string | null; sessionStatus: string | null; cutoffAt: string | null }>();
  if (!row) throw new Error("job_not_found");
  if (!row.automationSessionId) return true;
  if (row.sessionStatus === "running" && row.cutoffAt && row.cutoffAt > now) return true;
  const error = row.cutoffAt && row.cutoffAt <= now ? "overnight_window_ended" : "overnight_session_not_running";
  await env.DB.batch([
    env.DB.prepare(`update creative_jobs set status = 'cancelled', error = ?, execution_stage = 'cancelled',
      stage_updated_at = ?, cancelled_at = ?, completed_at = ?, runner_lease_until = null, next_reconcile_at = null,
      reconcile_lease_until = null, updated_at = ? where id = ? and owner_id = ? and status in ('queued', 'running')`)
      .bind(error, now, now, now, now, jobId, runner.ownerId),
    env.DB.prepare(`update creative_runners set active_job_id = case when active_job_id = ? then null else active_job_id end,
      last_heartbeat_at = ? where id = ? and owner_id = ? and revoked_at is null`)
      .bind(jobId, now, runner.id, runner.ownerId),
  ]);
  return false;
}

export async function claimLocalRunnerJob(env: Env, runner: RunnerIdentity) {
  const now = new Date();
  const nowValue = now.toISOString();
  const generatedExtensionSoundSupported = supportsVideoExtensionGeneratedSound(runner.version) ? 1 : 0;
  const candidate = await env.DB.prepare(`select id from creative_jobs
    where owner_id = ? and execution_target = 'local-comfyui' and status in ('queued', 'running')
      and (modality != 'music' or ? = 1)
      and (coalesce(json_extract(settings_stamp_json, '$.videoOperation.audioMode'), '') != 'new-sound' or ? = 1)
      and (json_extract(settings_stamp_json, '$.modelAdapters[0].runnerId') is null
        or json_extract(settings_stamp_json, '$.modelAdapters[0].runnerId') = ?)
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)
      and (timeout_at is null or timeout_at > ?)
      and (not_before is null or not_before <= ?)
      and (automation_session_id is null or exists (
        select 1 from creative_overnight_sessions s where s.id = creative_jobs.automation_session_id
          and s.owner_id = creative_jobs.owner_id and s.status = 'running' and s.cutoff_at > ?
      ))
      and (json_extract(settings_stamp_json, '$.loveLoop.loopId') is null or exists (
        select 1 from creative_love_loops l where l.id = json_extract(creative_jobs.settings_stamp_json, '$.loveLoop.loopId')
          and l.owner_id = creative_jobs.owner_id and l.status = 'active'
      ))
    order by case when status = 'running' and runner_id = ? then 0 when status = 'running' then 1 else 2 end,
      case when modality = 'video' then 0 else 1 end, priority desc, created_at limit 1`)
    .bind(runner.ownerId, supportsSongPromptEnhancement(runner.version) ? 1 : 0, generatedExtensionSoundSupported,
      runner.id, nowValue, runner.id, nowValue, nowValue, nowValue, runner.id).first<{ id: string }>();
  if (!candidate) return null;
  const leaseUntil = new Date(now.getTime() + 2 * 60_000).toISOString();
  const claimed = await env.DB.prepare(`update creative_jobs set status = 'running', progress = max(progress, 5),
    runner_id = ?, runner_lease_until = ?, error = null, started_at = coalesce(started_at, ?),
    execution_stage = 'preparing-inputs', stage_updated_at = ?, updated_at = ?
    where id = ? and owner_id = ? and execution_target = 'local-comfyui' and status in ('queued', 'running')
      and (coalesce(json_extract(settings_stamp_json, '$.videoOperation.audioMode'), '') != 'new-sound' or ? = 1)
      and (json_extract(settings_stamp_json, '$.modelAdapters[0].runnerId') is null
        or json_extract(settings_stamp_json, '$.modelAdapters[0].runnerId') = ?)
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)
      and (timeout_at is null or timeout_at > ?) and (not_before is null or not_before <= ?)
      and (automation_session_id is null or exists (
        select 1 from creative_overnight_sessions s where s.id = creative_jobs.automation_session_id
          and s.owner_id = creative_jobs.owner_id and s.status = 'running' and s.cutoff_at > ?
      ))
      and (json_extract(settings_stamp_json, '$.loveLoop.loopId') is null or exists (
        select 1 from creative_love_loops l where l.id = json_extract(creative_jobs.settings_stamp_json, '$.loveLoop.loopId')
          and l.owner_id = creative_jobs.owner_id and l.status = 'active'
      ))`)
    .bind(runner.id, leaseUntil, nowValue, nowValue, nowValue, candidate.id, runner.ownerId, generatedExtensionSoundSupported,
      runner.id, nowValue, runner.id, nowValue, nowValue, nowValue).run();
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
  const nowValue = now.toISOString();
  const observationValue = boundedText(input.comfyObservationAt, 40);
  const observationTime = Date.parse(observationValue);
  const comfyObservationAt = stage === "rendering" && Number.isFinite(observationTime) && observationTime <= now.getTime() + 60_000
    ? new Date(Math.min(observationTime, now.getTime())).toISOString()
    : null;
  const stageUpdatedAt = stage === "rendering" ? comfyObservationAt : stage ? nowValue : null;
  const normalizedDoctor = normalizeVideoDoctor(input.videoDoctor);
  const videoDoctor = normalizedDoctor ? await enrichVideoDoctor(env, runner, normalizedDoctor) : null;
  if (!await automationJobMayContinue(env, runner, jobId, nowValue)) {
    const job = await jobById(env, runner.ownerId, jobId);
    if (!job) throw new Error("job_not_found");
    return { continue: false, job };
  }
  if (input.promptEnhancement) {
    const current = await jobById(env, runner.ownerId, jobId);
    if (!current) throw new Error("job_not_found");
    if (current.modality !== "music") throw new Error("song_prompt_enhancement_not_allowed");
    const parameterId = boundedText(input.promptEnhancement.parameterId, 160);
    const sourcePrompt = boundedText(input.promptEnhancement.sourcePrompt, 4_000);
    const enhancedPrompt = String(input.promptEnhancement.enhancedPrompt ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t ]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 8_000);
    const comfyPromptId = boundedText(input.promptEnhancement.comfyPromptId, 120);
    const schemaVersion = boundedText(input.promptEnhancement.schemaVersion, 80);
    const promptProfileId = boundedText(input.promptEnhancement.promptProfileId, 100);
    const targetModel = boundedText(input.promptEnhancement.targetModel, 100);
    const outputFormat = boundedText(input.promptEnhancement.outputFormat, 40);
    let expectedProfile = current.settingsStamp.musicPromptProfile;
    if (!expectedProfile) {
      const workflow = current.settingsStamp.workflow;
      if (!workflow) throw new Error("invalid_song_prompt_enhancement");
      const plan = await workflowExecutionPlan(env, runner.ownerId, workflow.workflowId, workflow.revisionId);
      expectedProfile = musicPromptProfileForIdentity({
        name: plan.workflow.name,
        description: plan.workflow.description,
        sourceFileName: plan.workflow.sourceFileName,
        models: plan.workflow.currentRevision.models,
        parameters: plan.workflow.currentRevision.parameters,
      });
    }
    const existing = current.settingsStamp.promptEnhancement;
    const idempotent = existing?.comfyPromptId === comfyPromptId && existing.enhancedPrompt === enhancedPrompt;
    const parameterSource = Object.prototype.hasOwnProperty.call(current.settingsStamp.parameters, parameterId)
      ? boundedText(current.settingsStamp.parameters[parameterId], 4_000)
      : "";
    const sourceWordCount = sourcePrompt.split(/\s+/).filter(Boolean).length;
    const enhancedWordCount = enhancedPrompt.split(/\s+/).filter(Boolean).length;
    const validLength = expectedProfile.outputFormat === "structured-caption"
      ? enhancedWordCount >= 180 && enhancedWordCount <= 475
      : enhancedWordCount >= 12 && enhancedWordCount <= 100;
    const validStructuredCaption = expectedProfile.outputFormat !== "structured-caption"
      || (/^### Global Metadata\s*\n/i.test(enhancedPrompt)
        && /\n\s*### Vocal Details\s*\n/i.test(enhancedPrompt)
        && /\n\s*### Arrangement\s*\n/i.test(enhancedPrompt));
    if (!idempotent && (!parameterId || sourcePrompt !== boundedText(current.settingsStamp.prompt, 4_000) || parameterSource !== sourcePrompt
      || !comfyPromptId || schemaVersion !== "creative-studio-song-prompt-enhancement/1.1"
      || promptProfileId !== expectedProfile.id || targetModel !== expectedProfile.targetModel || outputFormat !== expectedProfile.outputFormat
      || sourceWordCount < 3 || !validLength || !validStructuredCaption)) {
      throw new Error("invalid_song_prompt_enhancement");
    }
    if (!idempotent) {
      const promptEnhancement = {
        schemaVersion: "creative-studio-song-prompt-enhancement/1.1" as const,
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
        promptProfileId: expectedProfile.id,
        targetModel: expectedProfile.targetModel,
        outputFormat: expectedProfile.outputFormat,
      };
      const settingsStamp = {
        ...current.settingsStamp,
        prompt: enhancedPrompt,
        parameters: { ...current.settingsStamp.parameters, [parameterId]: enhancedPrompt },
        promptEnhancement,
      };
      const updated = await env.DB.prepare(`update creative_jobs set prompt = ?, settings_stamp_json = ?, execution_stage = 'enhancing-prompt',
        stage_updated_at = ?, updated_at = ? where id = ? and owner_id = ? and runner_id = ?
        and execution_target = 'local-comfyui' and status = 'running'
        and (automation_session_id is null or exists (
          select 1 from creative_overnight_sessions s where s.id = creative_jobs.automation_session_id
            and s.owner_id = creative_jobs.owner_id and s.status = 'running' and s.cutoff_at > ?
        ))`)
        .bind(enhancedPrompt, JSON.stringify(settingsStamp), now.toISOString(), now.toISOString(), jobId, runner.ownerId, runner.id, now.toISOString()).run();
      if (!updated.meta.changes) throw new Error("runner_job_not_completable");
    }
  }
  const [changed] = await env.DB.batch([
    env.DB.prepare(`update creative_jobs set progress = max(progress, ?), upstream_id = coalesce(upstream_id, ?),
      execution_stage = coalesce(?, execution_stage), stage_updated_at = case
        when ? is null then stage_updated_at
        when stage_updated_at is null or ? > stage_updated_at then ?
        else stage_updated_at end,
      runner_lease_until = ?, updated_at = ?
      where id = ? and owner_id = ? and runner_id = ? and execution_target = 'local-comfyui' and status = 'running'
        and (automation_session_id is null or exists (
          select 1 from creative_overnight_sessions s where s.id = creative_jobs.automation_session_id
            and s.owner_id = creative_jobs.owner_id and s.status = 'running' and s.cutoff_at > ?
        ))`)
      .bind(progress, upstreamId, stage, stageUpdatedAt, stageUpdatedAt, stageUpdatedAt,
        new Date(now.getTime() + 2 * 60_000).toISOString(), nowValue, jobId, runner.ownerId, runner.id, nowValue),
    env.DB.prepare(`update creative_runners set active_job_id = ?, last_error = null,
      video_doctor_json = coalesce(?, video_doctor_json), video_doctor_checked_at = coalesce(?, video_doctor_checked_at),
      last_heartbeat_at = ? where id = ? and owner_id = ? and revoked_at is null`)
      .bind(jobId, videoDoctor ? JSON.stringify(videoDoctor) : null, videoDoctor?.checkedAt ?? null, nowValue, runner.id, runner.ownerId),
  ]);
  if (!changed.meta.changes) await automationJobMayContinue(env, runner, jobId, nowValue);
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
    || route === "runner-training-complete" || route === "runner-training-fail"
    || route === "runner-model-training-dataset" || route === "runner-model-training-heartbeat"
    || route === "runner-model-training-complete" || route === "runner-model-training-fail"
    || route === "runner-prompt-enhancement-heartbeat" || route === "runner-prompt-enhancement-complete"
    || route === "runner-prompt-enhancement-fail"
    || route === "runner-video-script-heartbeat" || route === "runner-video-script-complete"
    || route === "runner-video-script-fail"
    || route === "runner-overnight-heartbeat" || route === "runner-overnight-complete"
    || route === "runner-overnight-fail"
    || route === "runner-story-plan-heartbeat" || route === "runner-story-plan-complete"
    || route === "runner-story-plan-fail";
}

export function localRunnerJobLabel(job: Job) {
  return job.settingsStamp.workflow ? `${job.settingsStamp.workflow.name} v${job.settingsStamp.workflow.version}` : job.modality;
}
