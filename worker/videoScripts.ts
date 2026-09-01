import {
  GEMMA_VIDEO_SCRIPT_MODEL,
  VIDEO_SCRIPT_SCENE_MAX_LENGTH,
  VIDEO_SCRIPT_SOURCE_MAX_LENGTH,
  compileVideoPromptWithSpeech,
  containsCommercialReferenceIdentity,
  deterministicReplacementVideoPrompt,
  isVideoScriptPromptProfile,
  normalizeGeneratedFullVideoScript,
  normalizeGeneratedVideoScript,
  normalizeOwnerFullVideoScript,
  normalizeOwnerVideoScript,
  normalizeVideoDurationSeconds,
  normalizeVideoScriptSeedPhrases,
  videoScriptInputRequestsSpeech,
  videoWorkflowDurationParameters,
  videoWorkflowPromptProfile,
  workflowSupportsVideoDuration,
  type CreateVideoScriptDraftRequest,
  type EvolutionRole,
  type RunnerCompleteVideoScriptDraftRequest,
  type UpdateVideoScriptDraftRequest,
  type VideoPromptInputMode,
  type VideoPromptProfile,
  type VideoGenerationVariant,
  type VideoScriptDraft,
  type VideoScriptPromptDerivation,
  type RunnerVideoScriptSource,
  type VideoScriptSourceProvenance,
  type VideoScriptStamp,
  type VideoScriptUse,
  type VideoSpeechStamp,
} from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import { projectById, runnerInputById } from "./repository";
import type { Env } from "./types";
import { listWorldRecords } from "./worlds";
import { workflowExecutionPlan } from "./workflows";

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
  scriptFormat: "dialogue-v1" | "full-script-v2";
  workflowId: string | null;
  workflowRevisionId: string | null;
  workflowName: string | null;
  workflowVersion: number | null;
  promptProfileId: string | null;
  promptProfileLabel: string | null;
  targetModel: string | null;
  outputFormat: string | null;
  promptMinimumWords: number | null;
  promptMaximumWords: number | null;
  inputMode: VideoPromptInputMode | null;
  sourceId: string | null;
  sourceOrigin: "upload" | "artifact" | null;
  sourceKind: "image" | "video" | null;
  sourceName: string | null;
  generatedSpokenText: string | null;
  currentSpokenText: string | null;
};

const COLUMNS = `id, owner_id as ownerId, project_id as projectId, status, progress, mode,
  seed_phrases_json as seedPhrasesJson, source_script as sourceScript, scene_direction as sceneDirection,
  video_duration_seconds as videoDurationSeconds, generated_script as generatedScript,
  current_script as currentScript, edit_revision as editRevision, provider, model, comfy_prompt_id as comfyPromptId,
  runner_id as runnerId, runner_lease_until as runnerLeaseUntil, error, idempotency_key as idempotencyKey,
  created_at as createdAt, updated_at as updatedAt, started_at as startedAt, completed_at as completedAt,
  script_format as scriptFormat, workflow_id as workflowId, workflow_revision_id as workflowRevisionId,
  workflow_name as workflowName, workflow_version as workflowVersion, prompt_profile_id as promptProfileId,
  prompt_profile_label as promptProfileLabel, target_model as targetModel, output_format as outputFormat,
  prompt_minimum_words as promptMinimumWords, prompt_maximum_words as promptMaximumWords,
  input_mode as inputMode, source_id as sourceId, source_origin as sourceOrigin, source_kind as sourceKind,
  source_name as sourceName, generated_spoken_text as generatedSpokenText, current_spoken_text as currentSpokenText`;

function boundedMultiline(value: unknown, limit: number) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit + 1);
}

function promptProfileFromRow(row: VideoScriptDraftRow): VideoPromptProfile {
  const stored = {
    id: row.promptProfileId,
    label: row.promptProfileLabel,
    targetModel: row.targetModel,
    outputFormat: row.outputFormat,
  };
  if (!isVideoScriptPromptProfile(stored)
    || !Number.isInteger(row.promptMinimumWords) || Number(row.promptMinimumWords) < 1
    || !Number.isInteger(row.promptMaximumWords) || Number(row.promptMaximumWords) < Number(row.promptMinimumWords)) {
    throw new Error("video_script_profile_invalid");
  }
  return {
    ...stored,
    minimumWords: Number(row.promptMinimumWords),
    maximumWords: Number(row.promptMaximumWords),
  };
}

function sourceFromRow(row: VideoScriptDraftRow): VideoScriptSourceProvenance | null {
  if (!row.sourceId && !row.sourceOrigin && !row.sourceKind && !row.sourceName) return null;
  if (!row.sourceId || !row.sourceOrigin || !row.sourceKind || !row.sourceName) throw new Error("video_script_source_invalid");
  return { id: row.sourceId, source: row.sourceOrigin, kind: row.sourceKind, name: row.sourceName };
}

function commonDraft(row: VideoScriptDraftRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    progress: Number(row.progress),
    mode: row.mode,
    seedPhrases: JSON.parse(row.seedPhrasesJson) as string[],
    sourceScript: row.sourceScript,
    sceneDirection: row.sceneDirection,
    videoDurationSeconds: row.videoDurationSeconds,
    generatedScript: row.generatedScript,
    currentScript: row.currentScript,
    editRevision: Number(row.editRevision),
    provider: row.provider,
    model: row.model,
    comfyPromptId: row.comfyPromptId,
    runnerId: row.runnerId,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function publicDraft(row: VideoScriptDraftRow): VideoScriptDraft {
  const common = commonDraft(row);
  if (row.scriptFormat === "dialogue-v1") return { ...common, scriptFormat: "dialogue-v1" };
  if (!row.workflowId || !row.workflowRevisionId || !row.workflowName || !Number.isInteger(row.workflowVersion)
    || !row.inputMode) throw new Error("video_script_context_invalid");
  return {
    ...common,
    scriptFormat: "full-script-v2",
    workflowId: row.workflowId,
    workflowRevisionId: row.workflowRevisionId,
    workflowName: row.workflowName,
    workflowVersion: Number(row.workflowVersion),
    promptProfile: promptProfileFromRow(row),
    inputMode: row.inputMode,
    source: sourceFromRow(row),
    generatedSpokenText: row.generatedSpokenText,
    currentSpokenText: row.currentSpokenText,
  };
}

function semverAtLeast(version: string | null | undefined, major: number, minor: number) {
  const match = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const actualMajor = Number(match[1]);
  return actualMajor > major || (actualMajor === major && Number(match[2]) >= minor);
}

/** Public Script Builder capability means the full-script v2 runner is online. */
export function supportsVideoScriptDrafts(version: string | null | undefined) {
  return semverAtLeast(version, 1, 12);
}

async function rowById(env: Env, ownerId: string, draftId: string) {
  return env.DB.prepare(`select ${COLUMNS} from creative_video_script_drafts where id = ? and owner_id = ?`)
    .bind(draftId, ownerId).first<VideoScriptDraftRow>();
}

async function runnerSourceForDraft(env: Env, ownerId: string, row: VideoScriptDraftRow): Promise<RunnerVideoScriptSource | null> {
  if (row.scriptFormat === "dialogue-v1") return null;
  const provenance = sourceFromRow(row);
  if (row.inputMode === "text-to-video") {
    if (provenance) throw new Error("video_script_source_unexpected");
    return null;
  }
  if (!provenance) throw new Error("video_script_source_required");
  const source = await runnerInputById(env, ownerId, provenance.id);
  if (!source || source.projectId !== row.projectId || source.source !== provenance.source
    || source.kind !== provenance.kind || source.name !== provenance.name) {
    throw new Error("video_script_source_context_mismatch");
  }
  return {
    id: source.id,
    projectId: source.projectId,
    source: source.source,
    kind: source.kind as "image" | "video",
    name: source.name,
    originalFileName: source.originalFileName,
    mimeType: source.mimeType,
    size: source.size,
  };
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

function normalizedInputMode(value: unknown): VideoPromptInputMode {
  if (value !== "image-to-video" && value !== "text-to-video" && value !== "video-extension") {
    throw new Error("invalid_video_script_input_mode");
  }
  return value;
}

async function resolveSource(
  env: Env,
  ownerId: string,
  projectId: string,
  inputMode: VideoPromptInputMode,
  sourceIdValue: unknown,
): Promise<VideoScriptSourceProvenance | null> {
  const sourceId = boundedText(sourceIdValue, 100) || null;
  if (inputMode === "text-to-video") {
    if (sourceId) throw new Error("video_script_source_unexpected");
    return null;
  }
  if (!sourceId) throw new Error("video_script_source_required");
  const source = await runnerInputById(env, ownerId, sourceId);
  if (!source) throw new Error("video_script_source_not_found");
  if (source.projectId !== projectId) throw new Error("video_script_source_project_mismatch");
  const expectedKind = inputMode === "image-to-video" ? "image" : "video";
  if (source.kind !== expectedKind) throw new Error("video_script_source_kind_mismatch");
  return { id: source.id, source: source.source, kind: source.kind, name: source.name };
}

export async function createVideoScriptDraft(env: Env, ownerId: string, input: CreateVideoScriptDraftRequest) {
  if (input.scriptFormat !== "full-script-v2") throw new Error("invalid_video_script_request");
  const projectId = boundedText(input.projectId, 100);
  const workflowId = boundedText(input.workflowId, 100);
  const workflowRevisionId = boundedText(input.workflowRevisionId, 100);
  const mode = input.mode;
  const seedPhrases = mode === "build" ? normalizeVideoScriptSeedPhrases(input.seedPhrases) : [];
  const sourceScript = mode === "tighten" ? boundedMultiline(input.sourceScript, VIDEO_SCRIPT_SOURCE_MAX_LENGTH) : null;
  const sceneDirection = boundedMultiline(input.sceneDirection, VIDEO_SCRIPT_SCENE_MAX_LENGTH);
  const videoDurationSeconds = normalizeVideoDurationSeconds(input.videoDurationSeconds);
  const idempotencyKey = boundedText(input.idempotencyKey, 100);
  const inputMode = normalizedInputMode(input.inputMode);
  if (!projectId || !workflowId || !workflowRevisionId || (mode !== "build" && mode !== "tighten")
    || (mode === "tighten" && (!sourceScript || sourceScript.length < 2 || sourceScript.length > VIDEO_SCRIPT_SOURCE_MAX_LENGTH))
    || sceneDirection.length > VIDEO_SCRIPT_SCENE_MAX_LENGTH || videoDurationSeconds === null) {
    throw new Error("invalid_video_script_request");
  }
  if (!/^[a-z0-9_-]{16,100}$/i.test(idempotencyKey)) throw new Error("invalid_idempotency_key");

  const project = await projectById(env, ownerId, projectId);
  if (!project || project.status !== "active") throw new Error("project_not_found");
  const plan = await workflowExecutionPlan(env, ownerId, workflowId, workflowRevisionId);
  // A workflow's project records where it entered the owner's reusable model
  // library. Script drafts belong to the active project, while source and
  // continuity validation below remain active-project scoped.
  if (plan.workflow.modality !== "video") throw new Error("video_script_workflow_mismatch");
  const durationParameters = videoWorkflowDurationParameters(plan.workflow.currentRevision.parameters);
  if (!durationParameters.length || !workflowSupportsVideoDuration(plan.workflow, videoDurationSeconds)
    || durationParameters.some((parameter) => Number(parameter.value) !== videoDurationSeconds)) {
    throw new Error("video_script_duration_mismatch");
  }
  const mediaParameters = plan.workflow.currentRevision.parameters.filter((parameter) => parameter.kind === "media");
  if (inputMode === "text-to-video" && mediaParameters.length) throw new Error("video_script_input_mode_mismatch");
  if (inputMode !== "text-to-video" && !mediaParameters.some((parameter) => parameter.mediaKind === "image")) {
    throw new Error("video_script_input_mode_mismatch");
  }
  const source = await resolveSource(env, ownerId, projectId, inputMode, input.sourceId);
  const profile = videoWorkflowPromptProfile(plan.workflow, inputMode);

  const existing = await env.DB.prepare(`select ${COLUMNS} from creative_video_script_drafts where owner_id = ? and idempotency_key = ?`)
    .bind(ownerId, idempotencyKey).first<VideoScriptDraftRow>();
  if (existing) {
    if (existing.scriptFormat !== "full-script-v2" || existing.projectId !== projectId || existing.mode !== mode
      || existing.seedPhrasesJson !== JSON.stringify(seedPhrases) || existing.sourceScript !== sourceScript
      || existing.sceneDirection !== sceneDirection || existing.videoDurationSeconds !== videoDurationSeconds
      || existing.workflowId !== workflowId || existing.workflowRevisionId !== workflowRevisionId
      || existing.inputMode !== inputMode || existing.sourceId !== source?.id) {
      throw new Error("video_script_idempotency_conflict");
    }
    return publicDraft(existing);
  }

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
      runner_lease_until, error, idempotency_key, created_at, updated_at, started_at, completed_at,
      script_format, workflow_id, workflow_revision_id, workflow_name, workflow_version, prompt_profile_id,
      prompt_profile_label, target_model, output_format, prompt_minimum_words, prompt_maximum_words, input_mode,
      source_id, source_origin, source_kind, source_name, generated_spoken_text, current_spoken_text)
    values (?, ?, ?, 'waiting-for-runner', 0, ?, ?, ?, ?, ?, null, null, 0, 'local-comfyui', null, null, null,
      null, null, ?, ?, ?, null, null, 'full-script-v2', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null)`)
    .bind(draftId, ownerId, projectId, mode, JSON.stringify(seedPhrases), sourceScript, sceneDirection, videoDurationSeconds,
      idempotencyKey, now, now, workflowId, workflowRevisionId, plan.workflow.name, plan.workflow.currentRevision.version,
      profile.id, profile.label, profile.targetModel, profile.outputFormat, profile.minimumWords, profile.maximumWords,
      inputMode, source?.id ?? null, source?.source ?? null, source?.kind ?? null, source?.name ?? null).run();
  return videoScriptDraftById(env, ownerId, draftId);
}

export async function claimVideoScriptDraft(env: Env, runner: { id: string; ownerId: string; version: string | null }) {
  if (!semverAtLeast(runner.version, 1, 11)) return null;
  const acceptsV2 = semverAtLeast(runner.version, 1, 12) ? 1 : 0;
  const now = new Date();
  const nowValue = now.toISOString();
  const candidate = await env.DB.prepare(`select ${COLUMNS} from creative_video_script_drafts
    where owner_id = ? and status in ('waiting-for-runner', 'running')
      and (script_format = 'dialogue-v1' or (script_format = 'full-script-v2' and ? = 1))
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)
    order by case when runner_id = ? then 0 else 1 end, created_at limit 1`)
    .bind(runner.ownerId, acceptsV2, nowValue, runner.id, runner.id).first<VideoScriptDraftRow>();
  if (!candidate) return null;
  const source = await runnerSourceForDraft(env, runner.ownerId, candidate);
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
  return { videoScriptDraft: await videoScriptDraftById(env, runner.ownerId, candidate.id), source };
}

export async function heartbeatVideoScriptDraft(env: Env, runner: { id: string; ownerId: string }, draftId: string, progressValue: unknown) {
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
  let generatedScript: string;
  let generatedSpokenText: string | null = null;
  if (current.scriptFormat === "full-script-v2") {
    if (!current.inputMode) throw new Error("video_script_context_invalid");
    const output = normalizeGeneratedFullVideoScript(input.output, current.videoDurationSeconds,
      promptProfileFromRow(current), current.inputMode, videoScriptInputRequestsSpeech({
        seedPhrases: JSON.parse(current.seedPhrasesJson) as string[],
        sourceScript: current.sourceScript,
        sceneDirection: current.sceneDirection,
      }));
    generatedScript = output.fullScript;
    generatedSpokenText = output.spokenText;
  } else {
    generatedScript = normalizeGeneratedVideoScript(input.output, current.videoDurationSeconds);
  }
  const comfyPromptId = boundedText(input.comfyPromptId, 120);
  if (!comfyPromptId) throw new Error("invalid_video_script_result");
  const now = new Date().toISOString();
  const [updated] = await env.DB.batch([
    env.DB.prepare(`update creative_video_script_drafts set status = 'completed', progress = 100,
      generated_script = ?, current_script = ?, generated_spoken_text = ?, current_spoken_text = ?, edit_revision = 0,
      model = ?, comfy_prompt_id = ?, runner_lease_until = null, error = null, updated_at = ?, completed_at = ?
      where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(generatedScript, generatedScript, generatedSpokenText, generatedSpokenText, GEMMA_VIDEO_SCRIPT_MODEL,
        comfyPromptId, now, now, current.id, runner.ownerId, runner.id),
    env.DB.prepare("update creative_runners set active_job_id = null, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ? and active_job_id = ?")
      .bind(now, runner.id, runner.ownerId, current.id),
  ]);
  if (!updated.meta.changes) throw new Error("video_script_draft_not_completable");
  return videoScriptDraftById(env, runner.ownerId, current.id);
}

export async function updateVideoScriptDraft(env: Env, ownerId: string, draftId: string, input: UpdateVideoScriptDraftRequest) {
  const row = await rowById(env, ownerId, boundedText(draftId, 100));
  if (!row) throw new Error("video_script_draft_not_found");
  if (row.status !== "completed" || !row.generatedScript) throw new Error("video_script_draft_not_ready");
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("invalid_video_script_revision");
  if (input.scriptFormat && input.scriptFormat !== row.scriptFormat) throw new Error("video_script_format_mismatch");

  let currentScript: string;
  let currentSpokenText: string | null = null;
  if (row.scriptFormat === "full-script-v2") {
    if (input.scriptFormat !== "full-script-v2" || !row.inputMode) throw new Error("video_script_format_mismatch");
    const normalized = normalizeOwnerFullVideoScript(input.currentScript, input.currentSpokenText,
      row.videoDurationSeconds, promptProfileFromRow(row), row.inputMode,
      videoScriptInputRequestsSpeech({
        seedPhrases: JSON.parse(row.seedPhrasesJson) as string[],
        sourceScript: row.sourceScript,
        sceneDirection: row.sceneDirection,
      }));
    currentScript = normalized.fullScript;
    currentSpokenText = normalized.spokenText;
  } else {
    if (input.scriptFormat === "full-script-v2") throw new Error("video_script_format_mismatch");
    currentScript = normalizeOwnerVideoScript(input.currentScript, row.videoDurationSeconds);
  }
  const worldRecords = await listWorldRecords(env, ownerId);
  const commercialReferences = worldRecords.canonReferences
    .filter((reference) => reference.projectId === row.projectId && reference.source.kind === "commercial-reference");
  if (containsCommercialReferenceIdentity(`${currentScript}\n${currentSpokenText ?? ""}`, commercialReferences)) {
    throw new Error("continuity_commercial_identity_in_prompt");
  }
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`update creative_video_script_drafts
    set current_script = ?, current_spoken_text = ?, edit_revision = edit_revision + 1, updated_at = ?
    where id = ? and owner_id = ? and status = 'completed' and edit_revision = ?`)
    .bind(currentScript, currentSpokenText, now, row.id, ownerId, expectedRevision).run();
  if (!changed.meta.changes) throw new Error("video_script_version_conflict");
  return videoScriptDraftById(env, ownerId, row.id);
}

export async function failVideoScriptDraft(env: Env, runner: { id: string; ownerId: string }, draftId: string, errorValue: unknown) {
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

type VideoScriptStampContext = {
  projectId: string;
  videoDurationSeconds: VideoScriptDraft["videoDurationSeconds"];
  videoSpeech: VideoSpeechStamp;
};

type FullVideoScriptStampContext = Extract<VideoScriptUse, { scriptFormat: "full-script-v2" }> & VideoScriptStampContext & {
  workflowId: string;
  workflowRevisionId: string;
  promptProfileId: string;
  promptOutputFormat: string;
  inputMode: VideoPromptInputMode;
  sourceId: string | null;
  /** Worker-authoritative prompt read from the exact workflow revision used by this job. */
  jobPrompt: string;
  videoVariant?: VideoGenerationVariant | null;
  promptEnhancementRequestId?: string | null;
  evolution?: { studyId: string; role: EvolutionRole } | null;
};

type DialogueVideoScriptStampContext = Extract<VideoScriptUse, { scriptFormat: "dialogue-v1" }> & VideoScriptStampContext;

function speechStampMatches(actual: VideoSpeechStamp, expected: VideoSpeechStamp) {
  return actual.schemaVersion === expected.schemaVersion && actual.mode === expected.mode
    && actual.authoredText === expected.authoredText && actual.spokenText === expected.spokenText
    && actual.directive === expected.directive;
}

const PROMPT_DERIVATION_STOP_WORDS = new Set([
  "about", "after", "again", "against", "along", "also", "and", "are", "before", "behind", "being", "between",
  "but", "camera", "does", "each", "from", "have", "into", "just", "more", "only", "over", "scene", "shot", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "through", "under", "until", "very", "while",
  "with", "without",
]);

function promptDerivationTokens(value: string) {
  const tokens = value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const distinctive = tokens.filter((token) => token.length >= 4 && !PROMPT_DERIVATION_STOP_WORDS.has(token));
  return distinctive.length >= 8 ? distinctive : tokens.filter((token) => token.length >= 2);
}

function reviewedPromptCoverage(reviewedPrompt: string, jobPrompt: string) {
  const reviewed = promptDerivationTokens(reviewedPrompt);
  const available = new Map<string, number>();
  for (const token of promptDerivationTokens(jobPrompt)) available.set(token, (available.get(token) ?? 0) + 1);
  let matched = 0;
  for (const token of reviewed) {
    const count = available.get(token) ?? 0;
    if (count > 0) {
      matched += 1;
      available.set(token, count - 1);
    }
  }
  return reviewed.length ? Math.round((matched / reviewed.length) * 100) : 0;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function containsDeterministicVariantPrompt(jobPrompt: string, expected: string) {
  const core = expected.replace(/[.\s]+$/, "").trim();
  return core.length >= 20 && jobPrompt.includes(core);
}

async function videoScriptPromptDerivation(input: {
  reviewedPrompt: string;
  jobPrompt: string;
  source: VideoScriptSourceProvenance | null;
  videoVariant?: VideoGenerationVariant | null;
  promptEnhancementRequestId?: string | null;
  evolution?: { studyId: string; role: EvolutionRole } | null;
}): Promise<VideoScriptPromptDerivation> {
  const coverage = reviewedPromptCoverage(input.reviewedPrompt, input.jobPrompt);
  const variant = input.videoVariant ?? null;
  const promptEnhancementRequestId = boundedText(input.promptEnhancementRequestId, 100) || null;
  const evolution = input.evolution ? {
    studyId: boundedText(input.evolution.studyId, 120),
    role: input.evolution.role,
  } : null;
  if (evolution && (!/^evolve_[a-z0-9-]{8,100}$/i.test(evolution.studyId)
    || !["refine", "correct", "discovery"].includes(evolution.role))) {
    throw new Error("video_script_prompt_derivation_invalid");
  }

  let kind: VideoScriptPromptDerivation["kind"];
  let relation: VideoScriptPromptDerivation["relation"];
  if (evolution) {
    if (!variant || coverage < 50) throw new Error("video_script_job_prompt_mismatch");
    kind = "evolution-branch";
    relation = "typed-evolution-branch";
  } else if (variant?.role === "left-field" || variant?.role === "awe") {
    const expected = deterministicReplacementVideoPrompt(variant, Boolean(input.source));
    if (!expected || !containsDeterministicVariantPrompt(input.jobPrompt, expected)) {
      throw new Error("video_script_job_prompt_mismatch");
    }
    kind = "video-variant";
    relation = "deterministic-creative-variant";
  } else if (coverage >= 60) {
    kind = variant ? "video-variant" : "reviewed-script";
    relation = "substantial-reviewed-overlap";
  } else if (variant?.role === "enhanced" && promptEnhancementRequestId) {
    kind = "prompt-enhancement";
    relation = "typed-prompt-enhancement";
  } else {
    throw new Error("video_script_job_prompt_mismatch");
  }

  return {
    schemaVersion: "creative-studio-video-script-prompt-derivation/1.0",
    kind,
    relation,
    reviewedTokenCoverage: coverage,
    reviewedPromptSha256: await sha256(input.reviewedPrompt),
    jobPromptSha256: await sha256(input.jobPrompt),
    videoVariant: variant ? {
      schemaVersion: variant.schemaVersion,
      pairId: variant.pairId,
      role: variant.role,
    } : null,
    promptEnhancementRequestId,
    evolution,
  };
}

export async function videoScriptStampForJob(
  env: Env,
  ownerId: string,
  input: DialogueVideoScriptStampContext | FullVideoScriptStampContext,
): Promise<VideoScriptStamp> {
  const row = await rowById(env, ownerId, boundedText(input.requestId, 100));
  if (!row) throw new Error("video_script_draft_not_found");
  if (row.status !== "completed" || !row.generatedScript || !row.currentScript || !row.model || !row.comfyPromptId) {
    throw new Error("video_script_draft_not_ready");
  }
  if (row.projectId !== input.projectId || row.videoDurationSeconds !== input.videoDurationSeconds) {
    throw new Error("video_script_context_mismatch");
  }
  const editRevision = Number(input.editRevision);
  if (!Number.isInteger(editRevision) || editRevision !== row.editRevision) throw new Error("video_script_applied_text_mismatch");
  const worldRecords = await listWorldRecords(env, ownerId);
  const commercialReferences = worldRecords.canonReferences
    .filter((reference) => reference.projectId === row.projectId && reference.source.kind === "commercial-reference");

  if (row.scriptFormat === "dialogue-v1") {
    if (input.scriptFormat !== "dialogue-v1") throw new Error("video_script_format_mismatch");
    const appliedScript = normalizeOwnerVideoScript(input.appliedScript, row.videoDurationSeconds);
    if (appliedScript !== row.currentScript) throw new Error("video_script_applied_text_mismatch");
    if (input.videoSpeech.mode !== "exact-script" || input.videoSpeech.authoredText !== appliedScript
      || input.videoSpeech.spokenText !== appliedScript) throw new Error("video_script_speech_mismatch");
    if (containsCommercialReferenceIdentity(appliedScript, commercialReferences)) {
      throw new Error("continuity_commercial_identity_in_prompt");
    }
    return {
      schemaVersion: "creative-studio-video-script/1.0",
      scriptFormat: "dialogue-v1",
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

  if (input.scriptFormat !== "full-script-v2" || !row.inputMode || !row.workflowId || !row.workflowRevisionId
    || !row.workflowName || !Number.isInteger(row.workflowVersion)) throw new Error("video_script_format_mismatch");
  const profile = promptProfileFromRow(row);
  const speechRequested = videoScriptInputRequestsSpeech({
    seedPhrases: JSON.parse(row.seedPhrasesJson) as string[],
    sourceScript: row.sourceScript,
    sceneDirection: row.sceneDirection,
  });
  const applied = normalizeOwnerFullVideoScript(input.appliedPrompt, input.appliedSpokenText,
    row.videoDurationSeconds, profile, row.inputMode, speechRequested);
  if (applied.fullScript !== row.currentScript || applied.spokenText !== row.currentSpokenText) {
    throw new Error("video_script_applied_text_mismatch");
  }
  const generationWorkflowRevisionId = boundedText(input.workflowRevisionId, 100);
  if (!generationWorkflowRevisionId || row.workflowId !== input.workflowId || row.promptProfileId !== input.promptProfileId
    || row.outputFormat !== input.promptOutputFormat || row.inputMode !== input.inputMode
    || (sourceFromRow(row)?.id ?? null) !== (boundedText(input.sourceId, 100) || null)) {
    throw new Error("video_script_context_mismatch");
  }
  const compiled = compileVideoPromptWithSpeech(applied.fullScript,
    applied.spokenText === null ? { mode: "no-speech" } : { mode: "exact-script", text: applied.spokenText }, profile);
  if (!speechStampMatches(input.videoSpeech, compiled.speech)) throw new Error("video_script_speech_mismatch");
  const jobPrompt = String(input.jobPrompt ?? "").replace(/\r\n?/g, "\n").trim();
  if (jobPrompt.length < 4 || jobPrompt.length > 4_000 || !jobPrompt.includes(compiled.speech.directive)) {
    throw new Error("video_script_job_prompt_mismatch");
  }
  const source = sourceFromRow(row);
  const promptDerivation = await videoScriptPromptDerivation({
    reviewedPrompt: applied.fullScript,
    jobPrompt,
    source,
    videoVariant: input.videoVariant,
    promptEnhancementRequestId: input.promptEnhancementRequestId,
    evolution: input.evolution,
  });
  if (containsCommercialReferenceIdentity(`${applied.fullScript}\n${applied.spokenText ?? ""}\n${jobPrompt}`, commercialReferences)) {
    throw new Error("continuity_commercial_identity_in_prompt");
  }
  return {
    schemaVersion: "creative-studio-video-script/2.0",
    scriptFormat: "full-script-v2",
    requestId: row.id,
    mode: row.mode,
    seedPhrases: JSON.parse(row.seedPhrasesJson) as string[],
    sourceScript: row.sourceScript,
    sceneDirection: row.sceneDirection,
    generatedScript: row.generatedScript,
    generatedSpokenText: row.generatedSpokenText,
    appliedPrompt: applied.fullScript,
    appliedSpokenText: applied.spokenText,
    jobPrompt,
    editRevision: row.editRevision,
    editedAfterGeneration: applied.fullScript !== row.generatedScript || applied.spokenText !== row.generatedSpokenText,
    videoDurationSeconds: row.videoDurationSeconds,
    provider: "local-comfyui",
    workflow: {
      id: row.workflowId,
      name: row.workflowName,
      builderRevisionId: row.workflowRevisionId,
      builderVersion: Number(row.workflowVersion),
      generationRevisionId: generationWorkflowRevisionId,
    },
    promptProfile: profile,
    inputMode: row.inputMode,
    source,
    sourceMaterialization: row.inputMode === "image-to-video" ? "source-image"
      : row.inputMode === "video-extension" ? "video-final-frame" : "none",
    promptDerivation,
    builderWorkflowId: "gemma4-video-script-builder",
    builderWorkflowVersion: 2,
    model: row.model,
    comfyPromptId: row.comfyPromptId,
    createdAt: row.completedAt ?? row.updatedAt,
  };
}
