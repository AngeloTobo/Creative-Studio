import {
  GEMMA_VIDEO_PROMPT_MODEL,
  MINIMAX_PICTURE_ALIGNMENT_INSTRUCTION,
  VIDEO_PROMPT_ENHANCED_MAX_LENGTH,
  VIDEO_PROMPT_SOURCE_MAX_LENGTH,
  normalizeEnhancedVideoPrompt,
  normalizeVideoDurationSeconds,
  videoWorkflowDurationProfile,
  containsCommercialReferenceIdentity,
  videoWorkflowPromptProfile,
  type CreateVideoPromptEnhancementRequest,
  type RunnerCompletePromptEnhancementRequest,
  type VideoPromptEnhancement,
  type VideoPromptEnhancementStamp,
} from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import type { Env } from "./types";
import { workflowExecutionPlan } from "./workflows";
import { projectById, runnerInputById } from "./repository";
import { listWorldRecords } from "./worlds";

type PromptEnhancementRow = {
  id: string;
  ownerId: string;
  projectId: string;
  workflowId: string;
  workflowRevisionId: string;
  workflowName: string;
  status: VideoPromptEnhancement["status"];
  progress: number;
  sourcePrompt: string;
  enhancedPrompt: string | null;
  provider: "local-comfyui";
  promptProfileId: VideoPromptEnhancement["promptProfileId"];
  targetModel: string;
  outputFormat: VideoPromptEnhancement["outputFormat"];
  inputMode: VideoPromptEnhancement["inputMode"];
  sourceId: string | null;
  videoDurationSeconds: VideoPromptEnhancement["videoDurationSeconds"];
  model: typeof GEMMA_VIDEO_PROMPT_MODEL | null;
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

const COLUMNS = `id, owner_id as ownerId, project_id as projectId, workflow_id as workflowId,
  workflow_revision_id as workflowRevisionId, workflow_name as workflowName, status, progress,
  source_prompt as sourcePrompt, enhanced_prompt as enhancedPrompt, provider,
  prompt_profile_id as promptProfileId, target_model as targetModel, output_format as outputFormat,
  input_mode as inputMode, source_id as sourceId, video_duration_seconds as videoDurationSeconds,
  model, comfy_prompt_id as comfyPromptId, runner_id as runnerId,
  runner_lease_until as runnerLeaseUntil, error, idempotency_key as idempotencyKey,
  created_at as createdAt, updated_at as updatedAt, started_at as startedAt, completed_at as completedAt`;

function boundedPrompt(value: unknown, limit: number) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit);
}

function publicEnhancement(row: PromptEnhancementRow): VideoPromptEnhancement {
  const { ownerId: _ownerId, runnerLeaseUntil: _runnerLeaseUntil, idempotencyKey: _idempotencyKey, ...result } = row;
  void _ownerId;
  void _runnerLeaseUntil;
  void _idempotencyKey;
  return result;
}

function semverAtLeast(version: string | null | undefined, major: number, minor: number) {
  const match = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const actualMajor = Number(match[1]);
  return actualMajor > major || (actualMajor === major && Number(match[2]) >= minor);
}

export function supportsVideoPromptEnhancement(version: string | null | undefined) {
  return semverAtLeast(version, 1, 10);
}

async function rowById(env: Env, ownerId: string, enhancementId: string) {
  return env.DB.prepare(`select ${COLUMNS} from creative_prompt_enhancements where id = ? and owner_id = ?`)
    .bind(enhancementId, ownerId).first<PromptEnhancementRow>();
}

export async function videoPromptEnhancementById(env: Env, ownerId: string, enhancementId: string) {
  const row = await rowById(env, ownerId, boundedText(enhancementId, 100));
  if (!row) throw new Error("prompt_enhancement_not_found");
  return publicEnhancement(row);
}

export async function listVideoPromptEnhancements(env: Env, ownerId: string) {
  const rows = await env.DB.prepare(`select ${COLUMNS} from creative_prompt_enhancements
    where owner_id = ? order by case when status in ('waiting-for-runner', 'running') then 0 else 1 end,
    updated_at desc limit 30`).bind(ownerId).all<PromptEnhancementRow>();
  return (rows.results ?? []).map(publicEnhancement);
}

export async function createVideoPromptEnhancement(
  env: Env,
  ownerId: string,
  input: CreateVideoPromptEnhancementRequest,
) {
  const projectId = boundedText(input.projectId, 100);
  const workflowId = boundedText(input.workflowId, 100);
  const revisionId = boundedText(input.workflowRevisionId, 100);
  const sourcePrompt = boundedPrompt(input.sourcePrompt, VIDEO_PROMPT_SOURCE_MAX_LENGTH);
  const inputMode = input.inputMode;
  const sourceId = boundedText(input.sourceId, 100) || null;
  const videoDurationSeconds = normalizeVideoDurationSeconds(input.videoDurationSeconds);
  const idempotencyKey = boundedText(input.idempotencyKey, 100);
  if (!projectId || !workflowId || !revisionId || sourcePrompt.length < 4
    || !["image-to-video", "text-to-video", "video-extension"].includes(inputMode)
    || videoDurationSeconds === null
    || (inputMode === "text-to-video" ? sourceId !== null : sourceId === null)) {
    throw new Error("invalid_prompt_enhancement_request");
  }
  if (!/^[a-z0-9_-]{16,100}$/i.test(idempotencyKey)) throw new Error("invalid_idempotency_key");
  const project = await projectById(env, ownerId, projectId);
  if (!project) throw new Error("project_not_found");
  if (project.status === "archived") throw new Error("project_archived");
  const existing = await env.DB.prepare(`select ${COLUMNS} from creative_prompt_enhancements where owner_id = ? and idempotency_key = ?`)
    .bind(ownerId, idempotencyKey).first<PromptEnhancementRow>();
  if (existing) {
    if (existing.projectId !== projectId || existing.workflowId !== workflowId || existing.workflowRevisionId !== revisionId
      || existing.sourcePrompt !== sourcePrompt || existing.inputMode !== inputMode || existing.sourceId !== sourceId
      || existing.videoDurationSeconds !== videoDurationSeconds) throw new Error("prompt_enhancement_idempotency_conflict");
    return publicEnhancement(existing);
  }
  const plan = await workflowExecutionPlan(env, ownerId, workflowId, revisionId);
  // Workflows are an owner-wide model library. Their project is import
  // provenance; the active project below still owns the helper request,
  // sources, continuity checks, generated job, and retained output.
  if (plan.workflow.modality !== "video") throw new Error("prompt_enhancement_video_workflow_required");
  const worldRecords = await listWorldRecords(env, ownerId);
  if (containsCommercialReferenceIdentity(sourcePrompt,
    worldRecords.canonReferences.filter((reference) => reference.projectId === projectId && reference.source.kind === "commercial-reference"))) {
    throw new Error("continuity_commercial_identity_in_prompt");
  }
  const durationProfile = videoWorkflowDurationProfile(plan.workflow);
  if (videoDurationSeconds > durationProfile.maxSeconds) throw new Error("video_duration_not_supported_by_model");
  const imageInputAvailable = plan.workflow.currentRevision.parameters.some((parameter) => parameter.kind === "media" && parameter.mediaKind === "image");
  if (inputMode !== "text-to-video" && !imageInputAvailable) throw new Error("prompt_enhancement_image_workflow_required");
  if (sourceId) {
    const source = await runnerInputById(env, ownerId, sourceId);
    if (!source) throw new Error("runner_input_source_not_found");
    if (source.projectId !== projectId) throw new Error("runner_input_project_mismatch");
    if ((inputMode === "image-to-video" && source.kind !== "image") || (inputMode === "video-extension" && source.kind !== "video")) {
      throw new Error("runner_input_media_mismatch");
    }
  }
  const profile = videoWorkflowPromptProfile(plan.workflow, inputMode);
  const enhancementId = id("promptenh");
  const now = new Date().toISOString();
  await env.DB.prepare(`insert into creative_prompt_enhancements
    (id, owner_id, project_id, workflow_id, workflow_revision_id, workflow_name, status, progress,
      source_prompt, enhanced_prompt, provider, prompt_profile_id, target_model, output_format, input_mode,
      source_id, video_duration_seconds,
      model, comfy_prompt_id, runner_id, runner_lease_until, error, idempotency_key,
      created_at, updated_at, started_at, completed_at)
    values (?, ?, ?, ?, ?, ?, 'waiting-for-runner', 0, ?, null, 'local-comfyui', ?, ?, ?, ?, ?, ?,
      null, null, null, null, null, ?, ?, ?, null, null)`)
    .bind(enhancementId, ownerId, projectId, workflowId, revisionId, plan.workflow.name, sourcePrompt,
      profile.id, profile.targetModel, profile.outputFormat, inputMode, sourceId, videoDurationSeconds, idempotencyKey, now, now).run();
  return videoPromptEnhancementById(env, ownerId, enhancementId);
}

export async function claimVideoPromptEnhancement(
  env: Env,
  runner: { id: string; ownerId: string; version: string | null },
) {
  if (!supportsVideoPromptEnhancement(runner.version)) return null;
  const now = new Date();
  const nowValue = now.toISOString();
  const candidate = await env.DB.prepare(`select id from creative_prompt_enhancements
    where owner_id = ? and status in ('waiting-for-runner', 'running')
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)
    order by case when runner_id = ? then 0 else 1 end, created_at limit 1`)
    .bind(runner.ownerId, nowValue, runner.id, runner.id).first<{ id: string }>();
  if (!candidate) return null;
  const leaseUntil = new Date(now.getTime() + 2 * 60_000).toISOString();
  const claimed = await env.DB.prepare(`update creative_prompt_enhancements
    set status = 'running', progress = max(progress, 5), runner_id = ?, runner_lease_until = ?,
      error = null, started_at = coalesce(started_at, ?), updated_at = ?
    where id = ? and owner_id = ? and status in ('waiting-for-runner', 'running')
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)`)
    .bind(runner.id, leaseUntil, nowValue, nowValue, candidate.id, runner.ownerId, nowValue, runner.id).run();
  if (!claimed.meta.changes) return null;
  await env.DB.prepare("update creative_runners set active_job_id = ?, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
    .bind(candidate.id, nowValue, runner.id, runner.ownerId).run();
  const row = await rowById(env, runner.ownerId, candidate.id);
  if (!row) throw new Error("prompt_enhancement_not_found");
  const source = row.sourceId ? await runnerInputById(env, runner.ownerId, row.sourceId) : null;
  if (row.sourceId && (!source || source.projectId !== row.projectId
    || (row.inputMode === "image-to-video" && source.kind !== "image")
    || (row.inputMode === "video-extension" && source.kind !== "video"))) {
    throw new Error("prompt_enhancement_source_unavailable");
  }
  return {
    promptEnhancement: publicEnhancement(row),
    source: source ? {
      id: source.id,
      projectId: source.projectId,
      kind: source.kind as "image" | "video",
      name: source.name,
      originalFileName: source.originalFileName,
      mimeType: source.mimeType,
      size: source.size,
      source: source.source,
    } : null,
  };
}

export async function heartbeatVideoPromptEnhancement(
  env: Env,
  runner: { id: string; ownerId: string },
  enhancementId: string,
  progressValue: unknown,
) {
  const now = new Date();
  const nowValue = now.toISOString();
  const progress = Math.max(5, Math.min(94, Math.round(Number(progressValue) || 5)));
  const changed = await env.DB.prepare(`update creative_prompt_enhancements
    set progress = max(progress, ?), runner_lease_until = ?, updated_at = ?
    where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
    .bind(progress, new Date(now.getTime() + 2 * 60_000).toISOString(), nowValue,
      boundedText(enhancementId, 100), runner.ownerId, runner.id).run();
  if (!changed.meta.changes) throw new Error("prompt_enhancement_not_completable");
  await env.DB.prepare("update creative_runners set active_job_id = ?, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
    .bind(enhancementId, nowValue, runner.id, runner.ownerId).run();
  return videoPromptEnhancementById(env, runner.ownerId, enhancementId);
}

export async function completeVideoPromptEnhancement(
  env: Env,
  runner: { id: string; ownerId: string },
  enhancementId: string,
  input: RunnerCompletePromptEnhancementRequest,
) {
  const current = await rowById(env, runner.ownerId, boundedText(enhancementId, 100));
  if (!current) throw new Error("prompt_enhancement_not_found");
  if (current.status !== "running" || current.runnerId !== runner.id) throw new Error("prompt_enhancement_not_completable");
  const comfyPromptId = boundedText(input.comfyPromptId, 120);
  if (!comfyPromptId) throw new Error("invalid_prompt_enhancement_result");
  const evidenceAt = new Date().toISOString();
  const recorded = await env.DB.prepare(`update creative_prompt_enhancements
    set comfy_prompt_id = ?, updated_at = ?
    where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
    .bind(comfyPromptId, evidenceAt, current.id, runner.ownerId, runner.id).run();
  if (!recorded.meta.changes) throw new Error("prompt_enhancement_not_completable");
  const profile = videoPromptProfileForStored(current);
  const enhancedPrompt = normalizeEnhancedVideoPrompt(input.enhancedPrompt, profile, {
    videoDurationSeconds: current.videoDurationSeconds,
    inputMode: current.inputMode,
  });
  const now = new Date().toISOString();
  const [updated] = await env.DB.batch([
    env.DB.prepare(`update creative_prompt_enhancements set status = 'completed', progress = 100,
      enhanced_prompt = ?, model = ?, comfy_prompt_id = ?, runner_lease_until = null, error = null,
      updated_at = ?, completed_at = ? where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(enhancedPrompt, GEMMA_VIDEO_PROMPT_MODEL, comfyPromptId, now, now, current.id, runner.ownerId, runner.id),
    env.DB.prepare("update creative_runners set active_job_id = null, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ? and active_job_id = ?")
      .bind(now, runner.id, runner.ownerId, current.id),
  ]);
  if (!updated.meta.changes) throw new Error("prompt_enhancement_not_completable");
  return videoPromptEnhancementById(env, runner.ownerId, current.id);
}

function videoPromptProfileForStored(row: Pick<PromptEnhancementRow, "promptProfileId" | "targetModel" | "outputFormat">) {
  if (row.promptProfileId === "minimax-h3-i2v-motion/1.0") {
    return { id: row.promptProfileId, label: "MiniMax H3 I2VA motion direction", targetModel: row.targetModel,
      outputFormat: row.outputFormat, minimumWords: 60, maximumWords: 180 } as const;
  }
  if (row.promptProfileId === "ltx-2.5-motion/1.0") {
    return { id: row.promptProfileId, label: "LTX 2.5 chronological motion direction", targetModel: row.targetModel,
      outputFormat: row.outputFormat, minimumWords: 35, maximumWords: 200 } as const;
  }
  return { id: "generic-video-motion/1.0" as const, label: "Model-ready video motion direction", targetModel: row.targetModel,
    outputFormat: row.outputFormat, minimumWords: 35, maximumWords: 160 } as const;
}

export async function failVideoPromptEnhancement(
  env: Env,
  runner: { id: string; ownerId: string },
  enhancementId: string,
  errorValue: unknown,
) {
  const error = boundedText(errorValue, 500) || "video_prompt_enhancement_failed";
  const now = new Date().toISOString();
  const [updated] = await env.DB.batch([
    env.DB.prepare(`update creative_prompt_enhancements set status = 'failed', runner_lease_until = null,
      error = ?, updated_at = ?, completed_at = ? where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(error, now, now, boundedText(enhancementId, 100), runner.ownerId, runner.id),
    env.DB.prepare("update creative_runners set active_job_id = null, last_error = ?, last_heartbeat_at = ? where id = ? and owner_id = ? and active_job_id = ?")
      .bind(error, now, runner.id, runner.ownerId, enhancementId),
  ]);
  if (!updated.meta.changes) throw new Error("prompt_enhancement_not_completable");
  return videoPromptEnhancementById(env, runner.ownerId, enhancementId);
}

export async function videoPromptEnhancementStampForJob(env: Env, ownerId: string, input: {
  requestId: unknown;
  basePrompt: unknown;
  appliedPrompt: unknown;
  projectId: string;
  workflowId: string;
  workflowRevisionId: string;
  promptProfileId: VideoPromptEnhancement["promptProfileId"];
  promptOutputFormat: VideoPromptEnhancement["outputFormat"];
  videoDurationSeconds: VideoPromptEnhancement["videoDurationSeconds"];
  inputMode: VideoPromptEnhancement["inputMode"];
  sourceId: string | null;
}): Promise<VideoPromptEnhancementStamp> {
  const row = await rowById(env, ownerId, boundedText(input.requestId, 100));
  if (!row) throw new Error("prompt_enhancement_not_found");
  if (row.status !== "completed" || !row.enhancedPrompt || !row.model || !row.comfyPromptId) {
    throw new Error("prompt_enhancement_not_ready");
  }
  if (row.projectId !== input.projectId || row.workflowId !== input.workflowId || row.promptProfileId !== input.promptProfileId
    || row.outputFormat !== input.promptOutputFormat || row.videoDurationSeconds !== input.videoDurationSeconds
    || row.inputMode !== input.inputMode || (row.sourceId ?? null) !== (input.sourceId ?? null)) {
    throw new Error("prompt_enhancement_context_mismatch");
  }
  const basePrompt = boundedPrompt(input.basePrompt, VIDEO_PROMPT_ENHANCED_MAX_LENGTH);
  const appliedPrompt = boundedPrompt(input.appliedPrompt, VIDEO_PROMPT_ENHANCED_MAX_LENGTH);
  if (basePrompt.length < 4 || appliedPrompt.length < 4) throw new Error("invalid_prompt_enhancement_use");
  if (row.outputFormat === "minimax-h3-timeline") {
    const hasFrame = row.inputMode === "image-to-video" || row.inputMode === "video-extension";
    const appliedLines = appliedPrompt.split("\n");
    const canonicalFrameAlignment = appliedLines[0] === MINIMAX_PICTURE_ALIGNMENT_INSTRUCTION
      && !/<?Picture\s+1>?/i.test(appliedLines.slice(1).join("\n"));
    if ((hasFrame && !canonicalFrameAlignment) || (!hasFrame && /<?Picture\s+1>?/i.test(appliedPrompt))) {
      throw new Error("prompt_enhancement_picture_alignment_mismatch");
    }
  }
  return {
    schemaVersion: "creative-studio-video-prompt-enhancement/1.0",
    requestId: row.id,
    generationWorkflowId: row.workflowId,
    generationWorkflowRevisionId: input.workflowRevisionId,
    enhancementWorkflowRevisionId: row.workflowRevisionId,
    sourcePrompt: row.sourcePrompt,
    enhancedPrompt: row.enhancedPrompt,
    basePrompt,
    appliedPrompt,
    editedAfterEnhancement: basePrompt !== row.enhancedPrompt,
    provider: "local-comfyui",
    workflowId: "gemma4-video-prompt-enhancer",
    workflowVersion: 1,
    model: GEMMA_VIDEO_PROMPT_MODEL,
    comfyPromptId: row.comfyPromptId,
    sourceWordCount: row.sourcePrompt.split(/\s+/).filter(Boolean).length,
    enhancedWordCount: row.enhancedPrompt.split(/\s+/).filter(Boolean).length,
    createdAt: row.completedAt ?? row.updatedAt,
    promptProfileId: row.promptProfileId,
    targetModel: row.targetModel,
    outputFormat: row.outputFormat,
  };
}
