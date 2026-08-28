import {
  GEMMA_VIDEO_SCRIPT_MODEL,
  VIDEO_SCRIPT_SCENE_MAX_LENGTH,
  VIDEO_SCRIPT_SOURCE_MAX_LENGTH,
  containsCommercialReferenceIdentity,
  normalizeGeneratedVideoScript,
  normalizeOwnerVideoScript,
  normalizeVideoScriptSeedPhrases,
  normalizeVideoDurationSeconds,
  type CreateVideoScriptDraftRequest,
  type RunnerCompleteVideoScriptDraftRequest,
  type UpdateVideoScriptDraftRequest,
  type VideoScriptDraft,
  type VideoSpeechStamp,
  type VideoScriptStamp,
} from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import { projectById } from "./repository";
import type { Env } from "./types";
import { listWorldRecords } from "./worlds";

type VideoScriptDraftRow = {
  id: string;
  ownerId: string;
  projectId: string;
  status: VideoScriptDraft["status"];
  progress: number;
  mode: VideoScriptDraft["mode"];
  seedPhrasesJson: string;
  sourceScript: string | null;
  sceneDirection: string;
  videoDurationSeconds: VideoScriptDraft["videoDurationSeconds"];
  generatedScript: string | null;
  currentScript: string | null;
  editRevision: number;
  provider: "local-comfyui";
  model: typeof GEMMA_VIDEO_SCRIPT_MODEL | null;
  comfyPromptId: string | null;
  runnerId: string | null;
  runnerLeaseUntil: string | null;
  error: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

const COLUMNS = `id, owner_id as ownerId, project_id as projectId, status, progress, mode,
  seed_phrases_json as seedPhrasesJson, source_script as sourceScript, scene_direction as sceneDirection,
  video_duration_seconds as videoDurationSeconds, generated_script as generatedScript,
  current_script as currentScript, edit_revision as editRevision, provider, model, comfy_prompt_id as comfyPromptId,
  runner_id as runnerId, runner_lease_until as runnerLeaseUntil, error, idempotency_key as idempotencyKey,
  created_at as createdAt, updated_at as updatedAt, started_at as startedAt, completed_at as completedAt`;

function boundedMultiline(value: unknown, limit: number) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit + 1);
}

function publicDraft(row: VideoScriptDraftRow): VideoScriptDraft {
  const { ownerId: _ownerId, runnerLeaseUntil: _runnerLeaseUntil, idempotencyKey: _idempotencyKey,
    seedPhrasesJson, ...draft } = row;
  void _ownerId;
  void _runnerLeaseUntil;
  void _idempotencyKey;
  return { ...draft, seedPhrases: JSON.parse(seedPhrasesJson) as string[] };
}

function semverAtLeast(version: string | null | undefined, major: number, minor: number) {
  const match = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const actualMajor = Number(match[1]);
  return actualMajor > major || (actualMajor === major && Number(match[2]) >= minor);
}

export function supportsVideoScriptDrafts(version: string | null | undefined) {
  return semverAtLeast(version, 1, 11);
}

async function rowById(env: Env, ownerId: string, draftId: string) {
  return env.DB.prepare(`select ${COLUMNS} from creative_video_script_drafts where id = ? and owner_id = ?`)
    .bind(draftId, ownerId).first<VideoScriptDraftRow>();
}

export async function videoScriptDraftById(env: Env, ownerId: string, draftId: string) {
  const row = await rowById(env, ownerId, boundedText(draftId, 100));
  if (!row) throw new Error("video_script_draft_not_found");
  return publicDraft(row);
}

export async function listVideoScriptDrafts(env: Env, ownerId: string) {
  const rows = await env.DB.prepare(`select ${COLUMNS} from creative_video_script_drafts
    where owner_id = ? order by case when status in ('waiting-for-runner', 'running') then 0 else 1 end,
    updated_at desc limit 30`).bind(ownerId).all<VideoScriptDraftRow>();
  return (rows.results ?? []).map(publicDraft);
}

export async function createVideoScriptDraft(env: Env, ownerId: string, input: CreateVideoScriptDraftRequest) {
  const projectId = boundedText(input.projectId, 100);
  const mode = input.mode;
  const seedPhrases = mode === "build" ? normalizeVideoScriptSeedPhrases(input.seedPhrases) : [];
  const sourceScript = mode === "tighten"
    ? boundedMultiline(input.sourceScript, VIDEO_SCRIPT_SOURCE_MAX_LENGTH)
    : null;
  const sceneDirection = boundedMultiline(input.sceneDirection, VIDEO_SCRIPT_SCENE_MAX_LENGTH);
  const videoDurationSeconds = normalizeVideoDurationSeconds(input.videoDurationSeconds);
  const idempotencyKey = boundedText(input.idempotencyKey, 100);
  if (!projectId || (mode !== "build" && mode !== "tighten")
    || (mode === "tighten" && (!sourceScript || sourceScript.length < 2 || sourceScript.length > VIDEO_SCRIPT_SOURCE_MAX_LENGTH))
    || sceneDirection.length > VIDEO_SCRIPT_SCENE_MAX_LENGTH
    || videoDurationSeconds === null) throw new Error("invalid_video_script_request");
  if (!/^[a-z0-9_-]{16,100}$/i.test(idempotencyKey)) throw new Error("invalid_idempotency_key");

  const existing = await env.DB.prepare(`select ${COLUMNS} from creative_video_script_drafts where owner_id = ? and idempotency_key = ?`)
    .bind(ownerId, idempotencyKey).first<VideoScriptDraftRow>();
  if (existing) {
    if (existing.projectId !== projectId || existing.mode !== mode
      || existing.seedPhrasesJson !== JSON.stringify(seedPhrases) || existing.sourceScript !== sourceScript
      || existing.sceneDirection !== sceneDirection || existing.videoDurationSeconds !== videoDurationSeconds) {
      throw new Error("video_script_idempotency_conflict");
    }
    return publicDraft(existing);
  }

  const project = await projectById(env, ownerId, projectId);
  if (!project || project.status !== "active") throw new Error("project_not_found");
  const worldRecords = await listWorldRecords(env, ownerId);
  const commercialReferences = worldRecords.canonReferences
    .filter((reference) => reference.projectId === projectId && reference.source.kind === "commercial-reference");
  if (containsCommercialReferenceIdentity(`${seedPhrases.join("\n")}\n${sourceScript ?? ""}\n${sceneDirection}`, commercialReferences)) {
    throw new Error("continuity_commercial_identity_in_prompt");
  }

  const draftId = id("videoscript");
  const now = new Date().toISOString();
  await env.DB.prepare(`insert into creative_video_script_drafts
    (id, owner_id, project_id, status, progress, mode, seed_phrases_json, source_script, scene_direction,
      video_duration_seconds, generated_script, current_script, edit_revision, provider, model, comfy_prompt_id, runner_id,
      runner_lease_until, error, idempotency_key, created_at, updated_at, started_at, completed_at)
    values (?, ?, ?, 'waiting-for-runner', 0, ?, ?, ?, ?, ?, null, null, 0, 'local-comfyui', null, null, null,
      null, null, ?, ?, ?, null, null)`)
    .bind(draftId, ownerId, projectId, mode, JSON.stringify(seedPhrases), sourceScript, sceneDirection, videoDurationSeconds,
      idempotencyKey, now, now).run();
  return videoScriptDraftById(env, ownerId, draftId);
}

export async function claimVideoScriptDraft(
  env: Env,
  runner: { id: string; ownerId: string; version: string | null },
) {
  if (!supportsVideoScriptDrafts(runner.version)) return null;
  const now = new Date();
  const nowValue = now.toISOString();
  const candidate = await env.DB.prepare(`select id from creative_video_script_drafts
    where owner_id = ? and status in ('waiting-for-runner', 'running')
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)
    order by case when runner_id = ? then 0 else 1 end, created_at limit 1`)
    .bind(runner.ownerId, nowValue, runner.id, runner.id).first<{ id: string }>();
  if (!candidate) return null;
  const leaseUntil = new Date(now.getTime() + 2 * 60_000).toISOString();
  const changed = await env.DB.prepare(`update creative_video_script_drafts
    set status = 'running', progress = max(progress, 5), runner_id = ?, runner_lease_until = ?,
      error = null, started_at = coalesce(started_at, ?), updated_at = ?
    where id = ? and owner_id = ? and status in ('waiting-for-runner', 'running')
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)`)
    .bind(runner.id, leaseUntil, nowValue, nowValue, candidate.id, runner.ownerId, nowValue, runner.id).run();
  if (!changed.meta.changes) return null;
  await env.DB.prepare("update creative_runners set active_job_id = ?, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
    .bind(candidate.id, nowValue, runner.id, runner.ownerId).run();
  return { videoScriptDraft: await videoScriptDraftById(env, runner.ownerId, candidate.id) };
}

export async function heartbeatVideoScriptDraft(
  env: Env,
  runner: { id: string; ownerId: string },
  draftId: string,
  progressValue: unknown,
) {
  const now = new Date();
  const nowValue = now.toISOString();
  const progress = Math.max(5, Math.min(94, Math.round(Number(progressValue) || 5)));
  const changed = await env.DB.prepare(`update creative_video_script_drafts
    set progress = max(progress, ?), runner_lease_until = ?, updated_at = ?
    where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
    .bind(progress, new Date(now.getTime() + 2 * 60_000).toISOString(), nowValue,
      boundedText(draftId, 100), runner.ownerId, runner.id).run();
  if (!changed.meta.changes) throw new Error("video_script_draft_not_completable");
  await env.DB.prepare("update creative_runners set active_job_id = ?, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
    .bind(draftId, nowValue, runner.id, runner.ownerId).run();
  return videoScriptDraftById(env, runner.ownerId, draftId);
}

export async function completeVideoScriptDraft(
  env: Env,
  runner: { id: string; ownerId: string },
  draftId: string,
  input: RunnerCompleteVideoScriptDraftRequest,
) {
  const current = await rowById(env, runner.ownerId, boundedText(draftId, 100));
  if (!current) throw new Error("video_script_draft_not_found");
  if (current.status !== "running" || current.runnerId !== runner.id) throw new Error("video_script_draft_not_completable");
  const generatedScript = normalizeGeneratedVideoScript(input.output, current.videoDurationSeconds);
  const comfyPromptId = boundedText(input.comfyPromptId, 120);
  if (!comfyPromptId) throw new Error("invalid_video_script_result");
  const now = new Date().toISOString();
  const [updated] = await env.DB.batch([
    env.DB.prepare(`update creative_video_script_drafts set status = 'completed', progress = 100,
      generated_script = ?, current_script = ?, edit_revision = 0, model = ?, comfy_prompt_id = ?, runner_lease_until = null, error = null,
      updated_at = ?, completed_at = ? where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(generatedScript, generatedScript, GEMMA_VIDEO_SCRIPT_MODEL, comfyPromptId, now, now, current.id, runner.ownerId, runner.id),
    env.DB.prepare("update creative_runners set active_job_id = null, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ? and active_job_id = ?")
      .bind(now, runner.id, runner.ownerId, current.id),
  ]);
  if (!updated.meta.changes) throw new Error("video_script_draft_not_completable");
  return videoScriptDraftById(env, runner.ownerId, current.id);
}

export async function updateVideoScriptDraft(
  env: Env,
  ownerId: string,
  draftId: string,
  input: UpdateVideoScriptDraftRequest,
) {
  const row = await rowById(env, ownerId, boundedText(draftId, 100));
  if (!row) throw new Error("video_script_draft_not_found");
  if (row.status !== "completed" || !row.generatedScript) throw new Error("video_script_draft_not_ready");
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("invalid_video_script_revision");
  const currentScript = normalizeOwnerVideoScript(input.currentScript, row.videoDurationSeconds);
  const worldRecords = await listWorldRecords(env, ownerId);
  const commercialReferences = worldRecords.canonReferences
    .filter((reference) => reference.projectId === row.projectId && reference.source.kind === "commercial-reference");
  if (containsCommercialReferenceIdentity(currentScript, commercialReferences)) {
    throw new Error("continuity_commercial_identity_in_prompt");
  }
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`update creative_video_script_drafts
    set current_script = ?, edit_revision = edit_revision + 1, updated_at = ?
    where id = ? and owner_id = ? and status = 'completed' and edit_revision = ?`)
    .bind(currentScript, now, row.id, ownerId, expectedRevision).run();
  if (!changed.meta.changes) throw new Error("video_script_version_conflict");
  return videoScriptDraftById(env, ownerId, row.id);
}

export async function failVideoScriptDraft(
  env: Env,
  runner: { id: string; ownerId: string },
  draftId: string,
  errorValue: unknown,
) {
  const error = boundedText(errorValue, 500) || "video_script_generation_failed";
  const now = new Date().toISOString();
  const [updated] = await env.DB.batch([
    env.DB.prepare(`update creative_video_script_drafts set status = 'failed', runner_lease_until = null,
      error = ?, updated_at = ?, completed_at = ? where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(error, now, now, boundedText(draftId, 100), runner.ownerId, runner.id),
    env.DB.prepare("update creative_runners set active_job_id = null, last_error = ?, last_heartbeat_at = ? where id = ? and owner_id = ? and active_job_id = ?")
      .bind(error, now, runner.id, runner.ownerId, draftId),
  ]);
  if (!updated.meta.changes) throw new Error("video_script_draft_not_completable");
  return videoScriptDraftById(env, runner.ownerId, draftId);
}

export async function videoScriptStampForJob(env: Env, ownerId: string, input: {
  requestId: unknown;
  appliedScript: unknown;
  editRevision: unknown;
  projectId: string;
  videoDurationSeconds: VideoScriptDraft["videoDurationSeconds"];
  videoSpeech: VideoSpeechStamp;
}): Promise<VideoScriptStamp> {
  const row = await rowById(env, ownerId, boundedText(input.requestId, 100));
  if (!row) throw new Error("video_script_draft_not_found");
  if (row.status !== "completed" || !row.generatedScript || !row.currentScript || !row.model || !row.comfyPromptId) {
    throw new Error("video_script_draft_not_ready");
  }
  if (row.projectId !== input.projectId || row.videoDurationSeconds !== input.videoDurationSeconds) {
    throw new Error("video_script_context_mismatch");
  }
  const appliedScript = normalizeOwnerVideoScript(input.appliedScript, row.videoDurationSeconds);
  const editRevision = Number(input.editRevision);
  if (!Number.isInteger(editRevision) || editRevision !== row.editRevision || appliedScript !== row.currentScript) {
    throw new Error("video_script_applied_text_mismatch");
  }
  if (input.videoSpeech.mode !== "exact-script" || input.videoSpeech.authoredText !== appliedScript
    || input.videoSpeech.spokenText !== appliedScript) throw new Error("video_script_speech_mismatch");
  const worldRecords = await listWorldRecords(env, ownerId);
  const commercialReferences = worldRecords.canonReferences
    .filter((reference) => reference.projectId === row.projectId && reference.source.kind === "commercial-reference");
  if (containsCommercialReferenceIdentity(appliedScript, commercialReferences)) {
    throw new Error("continuity_commercial_identity_in_prompt");
  }
  return {
    schemaVersion: "creative-studio-video-script/1.0",
    requestId: row.id,
    mode: row.mode,
    seedPhrases: JSON.parse(row.seedPhrasesJson) as string[],
    sourceScript: row.sourceScript,
    sceneDirection: row.sceneDirection,
    generatedScript: row.generatedScript,
    appliedScript,
    editRevision: row.editRevision,
    editedAfterGeneration: appliedScript !== row.generatedScript,
    videoDurationSeconds: row.videoDurationSeconds,
    provider: "local-comfyui",
    workflowId: "gemma4-video-script-builder",
    workflowVersion: 1,
    model: row.model,
    comfyPromptId: row.comfyPromptId,
    createdAt: row.completedAt ?? row.updatedAt,
  };
}
