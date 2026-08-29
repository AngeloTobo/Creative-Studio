import {
  assessImagePerformance,
  compileVideoPromptWithSpeech,
  containsCommercialReferenceIdentity,
  generationControlSet,
  generationWorkflowPromptParameters,
  musicWorkflowPromptProfile,
  minimumOvernightOutputCount,
  normalizeOvernightPlan,
  normalizeVideoDurationSeconds,
  overnightPlanSlots,
  overnightTaskSeed,
  primaryWorkflowPromptParameter,
  videoWorkflowDurationParameters,
  videoWorkflowPromptProfile,
  workflowSupportsVideoDuration,
  type CompleteOvernightPlanRequest,
  type CreateOvernightSessionRequest,
  type FailOvernightPlanRequest,
  type GenerationModality,
  type GenerationSettingsStamp,
  type OvernightPlan,
  type OvernightPlanHeartbeatRequest,
  type OvernightPlannerBundle,
  type OvernightPlannerContext,
  type OvernightSession,
  type OvernightSessionProgress,
  type OvernightSessionStatus,
  type OvernightTask,
  type OvernightTaskStatus,
  type OvernightWorkflowSelection,
  type WorkflowParameter,
  type WorkflowScalar,
} from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import {
  cancelOwnedJob,
  createQueuedJob,
  generationRecipeById,
  listLocalDna,
  projectById,
} from "./repository";
import { assertCreativeDnaReviewed } from "./training";
import type { Env } from "./types";
import { createAutomationWorkflowRevision, workflowExecutionPlan } from "./workflows";
import { listWorldRecords } from "./worlds";

type RunnerIdentity = { id: string; ownerId: string; version: string | null };

type OvernightSessionRow = {
  id: string;
  projectId: string;
  dnaArtifactId: string;
  worldId: string | null;
  name: string;
  storySeed: string;
  storyCount: number;
  outputCount: number;
  modalitiesJson: string;
  exploration: OvernightSession["exploration"];
  workflowSelectionsJson: string;
  plannerContextJson: string;
  status: OvernightSessionStatus;
  scheduledFor: string;
  cutoffAt: string;
  maxFailures: number;
  maxBytes: number;
  planJson: string | null;
  planHash: string | null;
  plannerModel: string | null;
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

type OvernightTaskRow = {
  id: string;
  sessionId: string;
  ordinal: number;
  storyId: string;
  storyTitle: string;
  sceneId: string | null;
  sceneTitle: string | null;
  role: OvernightTask["role"];
  modality: GenerationModality;
  prompt: string;
  seed: number;
  status: OvernightTaskStatus;
  recipeId: string | null;
  recipeUpdatedAt: string | null;
  workflowId: string;
  workflowRevisionId: string;
  jobId: string | null;
  artifactId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  jobStatus: "queued" | "running" | "completed" | "failed" | "cancelled" | null;
  jobArtifactId: string | null;
  jobError: string | null;
  retainedSize: number | null;
  artifactStatus: "ready" | "accepted" | "rejected" | "archived" | null;
};

const SESSION_COLUMNS = `id, project_id as projectId, dna_artifact_id as dnaArtifactId, world_id as worldId,
  name, story_seed as storySeed, story_count as storyCount, output_count as outputCount,
  modalities_json as modalitiesJson, exploration, workflow_selections_json as workflowSelectionsJson,
  planner_context_json as plannerContextJson, status, scheduled_for as scheduledFor, cutoff_at as cutoffAt,
  max_failures as maxFailures, max_bytes as maxBytes, plan_json as planJson, plan_hash as planHash,
  planner_model as plannerModel, comfy_prompt_id as comfyPromptId, runner_id as runnerId,
  runner_lease_until as runnerLeaseUntil, error, idempotency_key as idempotencyKey,
  created_at as createdAt, updated_at as updatedAt, started_at as startedAt, completed_at as completedAt`;

const TASK_COLUMNS = `t.id, t.session_id as sessionId, t.ordinal, t.story_id as storyId, t.story_title as storyTitle,
  t.scene_id as sceneId, t.scene_title as sceneTitle, t.role, t.modality, t.prompt, t.seed, t.status,
  t.recipe_id as recipeId, t.recipe_updated_at as recipeUpdatedAt, t.workflow_id as workflowId,
  t.workflow_revision_id as workflowRevisionId, t.job_id as jobId, t.artifact_id as artifactId, t.error,
  t.created_at as createdAt, t.updated_at as updatedAt, j.status as jobStatus, j.artifact_id as jobArtifactId,
  j.error as jobError, a.retained_size as retainedSize, a.status as artifactStatus`;

const PAUSEABLE_SESSION_STATUSES = new Set<OvernightSessionStatus>(["armed", "planning", "running"]);
const TERMINAL_TASK_STATUSES = new Set<OvernightTaskStatus>(["completed", "failed", "cancelled", "skipped"]);

function storedJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function normalizedIdentity(value: unknown) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();
}

function withoutProtectedIdentities(value: unknown, identities: string[], maxLength: number) {
  let result = normalizedIdentity(value);
  for (const identity of identities) {
    if (!identity) continue;
    const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?:['\\u2019]s)?(?=$|[^\\p{L}\\p{N}_])`, "giu");
    result = result.replace(pattern, (_match, prefix: string) => prefix);
  }
  return boundedText(result.replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " "), maxLength);
}

function redactPlannerEvidence<T>(value: T, identities: string[]): T {
  if (typeof value === "string") return withoutProtectedIdentities(value, identities, 12_000) as T;
  if (Array.isArray(value)) return value.map((item) => redactPlannerEvidence(item, identities)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactPlannerEvidence(item, identities)])) as T;
  }
  return value;
}

function containsProtectedIdentity(value: string, identities: string[]) {
  return identities.some((identity) => identity && withoutProtectedIdentities(value, [identity], value.length + 1) !== normalizedIdentity(value));
}

function modalityForWorkflow(value: string): GenerationModality | null {
  if (value === "audio" || value === "music") return "music";
  if (value === "image" || value === "video") return value;
  return null;
}

function taskStatus(row: OvernightTaskRow): OvernightTaskStatus {
  if (!row.jobId || !row.jobStatus) return row.status;
  return row.jobStatus;
}

function publicTask(row: OvernightTaskRow): OvernightTask {
  return {
    id: row.id,
    sessionId: row.sessionId,
    ordinal: Number(row.ordinal),
    storyId: row.storyId,
    storyTitle: row.storyTitle,
    sceneId: row.sceneId,
    sceneTitle: row.sceneTitle,
    role: row.role,
    modality: row.modality,
    prompt: row.prompt,
    seed: Number(row.seed),
    status: taskStatus(row),
    jobId: row.jobId,
    artifactId: row.jobArtifactId ?? row.artifactId,
    recipeId: row.recipeId,
    error: row.jobError ?? row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sessionProgress(rows: OvernightTaskRow[]): OvernightSessionProgress {
  const statuses = rows.map(taskStatus);
  return {
    planned: rows.length,
    queued: statuses.filter((status) => status === "queued").length,
    running: statuses.filter((status) => status === "running").length,
    completed: statuses.filter((status) => status === "completed").length,
    failed: statuses.filter((status) => status === "failed").length,
    cancelled: statuses.filter((status) => status === "cancelled" || status === "skipped").length,
    readyForReview: rows.filter((row) => taskStatus(row) === "completed" && row.artifactStatus === "ready").length,
    decided: rows.filter((row) => taskStatus(row) === "completed" && row.artifactStatus !== null && row.artifactStatus !== "ready").length,
    retainedBytes: rows.reduce((total, row) => total + Number(row.retainedSize ?? 0), 0),
  };
}

function publicSession(row: OvernightSessionRow, taskRows: OvernightTaskRow[]): OvernightSession {
  return {
    id: row.id,
    projectId: row.projectId,
    dnaArtifactId: row.dnaArtifactId,
    worldId: row.worldId,
    name: row.name,
    storySeed: row.storySeed,
    storyCount: Number(row.storyCount),
    outputCount: Number(row.outputCount),
    modalities: storedJson<GenerationModality[]>(row.modalitiesJson, []),
    exploration: row.exploration,
    workflowSelections: storedJson<OvernightWorkflowSelection[]>(row.workflowSelectionsJson, []),
    status: row.status,
    scheduledFor: row.scheduledFor,
    cutoffAt: row.cutoffAt,
    maxFailures: Number(row.maxFailures),
    maxBytes: Number(row.maxBytes),
    plan: storedJson<OvernightPlan | null>(row.planJson, null),
    planHash: row.planHash,
    tasks: taskRows.map(publicTask).sort((left, right) => left.ordinal - right.ordinal),
    progress: sessionProgress(taskRows),
    runnerId: row.runnerId,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

async function taskRowsForSessions(env: Env, ownerId: string, sessionIds: string[]) {
  if (!sessionIds.length) return [];
  const placeholders = sessionIds.map(() => "?").join(", ");
  const result = await env.DB.prepare(`select ${TASK_COLUMNS} from creative_overnight_tasks t
    left join creative_jobs j on j.id = t.job_id and j.owner_id = t.owner_id
    left join creative_artifacts a on a.id = coalesce(j.artifact_id, t.artifact_id) and a.owner_id = t.owner_id
    where t.owner_id = ? and t.session_id in (${placeholders}) order by t.session_id, t.ordinal`)
    .bind(ownerId, ...sessionIds).all<OvernightTaskRow>();
  return result.results ?? [];
}

async function sessionRowById(env: Env, ownerId: string, sessionId: string) {
  return env.DB.prepare(`select ${SESSION_COLUMNS} from creative_overnight_sessions where id = ? and owner_id = ?`)
    .bind(boundedText(sessionId, 100), ownerId).first<OvernightSessionRow>();
}

async function expireOverdueSessions(env: Env, ownerId: string, projectId: string | null = null) {
  const now = new Date().toISOString();
  const projectClause = projectId ? " and project_id = ?" : "";
  const statement = env.DB.prepare(`update creative_overnight_sessions set status = 'failed', error = 'overnight_window_ended',
    runner_lease_until = null, completed_at = coalesce(completed_at, ?), updated_at = ?
    where owner_id = ?${projectClause} and status in ('armed', 'planning') and cutoff_at <= ?`);
  if (projectId) await statement.bind(now, now, ownerId, projectId, now).run();
  else await statement.bind(now, now, ownerId, now).run();
  const running = await env.DB.prepare(`select ${SESSION_COLUMNS} from creative_overnight_sessions
    where owner_id = ?${projectClause} and status in ('running', 'paused') and cutoff_at <= ? order by created_at limit 10`);
  const rows = projectId
    ? await running.bind(ownerId, projectId, now).all<OvernightSessionRow>()
    : await running.bind(ownerId, now).all<OvernightSessionRow>();
  for (const row of rows.results ?? []) await endExpiredRunningSession(env, ownerId, row);
}

async function compareAndSetSessionStatus(
  env: Env,
  ownerId: string,
  sessionId: string,
  expected: OvernightSessionStatus[],
  status: OvernightSessionStatus,
  error: string | null = null,
  preserveLease = false,
) {
  if (!expected.length) return false;
  const now = new Date().toISOString();
  const placeholders = expected.map(() => "?").join(", ");
  const changed = await env.DB.prepare(`update creative_overnight_sessions set status = ?, error = ?,
    runner_lease_until = case when ? = 1 then runner_lease_until else null end,
    completed_at = case when ? in ('completed', 'failed', 'cancelled') then coalesce(completed_at, ?) else completed_at end,
    updated_at = ? where id = ? and owner_id = ? and status in (${placeholders})`)
    .bind(status, error, preserveLease ? 1 : 0, status, now, now, sessionId, ownerId, ...expected).run();
  return Boolean(changed.meta.changes);
}

async function cancelActiveSessionJobs(env: Env, ownerId: string, sessionId: string, error: string, preserveLease = false) {
  const now = new Date().toISOString();
  await env.DB.prepare(`update creative_jobs set status = 'cancelled', error = ?, execution_stage = 'cancelled',
    stage_updated_at = ?, cancelled_at = ?, completed_at = ?, runner_lease_until = case when ? = 1 then runner_lease_until else null end, next_reconcile_at = null,
    reconcile_lease_until = null, updated_at = ? where owner_id = ? and automation_session_id = ?
      and status in ('queued', 'running')`)
    .bind(error, now, now, now, preserveLease ? 1 : 0, now, ownerId, sessionId).run();
}

async function preserveCompletedAndEndTasks(env: Env, ownerId: string, sessionId: string, mode: "cancelled" | "cutoff") {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`update creative_overnight_tasks set status = 'completed', artifact_id = coalesce(artifact_id,
      (select j.artifact_id from creative_jobs j where j.id = creative_overnight_tasks.job_id and j.owner_id = creative_overnight_tasks.owner_id)),
      error = null, updated_at = ? where owner_id = ? and session_id = ? and exists (
        select 1 from creative_jobs j where j.id = creative_overnight_tasks.job_id and j.owner_id = creative_overnight_tasks.owner_id
          and j.status = 'completed'
      )`).bind(now, ownerId, sessionId),
    env.DB.prepare(`update creative_overnight_tasks set status = case when ? = 'cutoff' and status = 'planned' then 'skipped' else 'cancelled' end,
      error = case when ? = 'cutoff' then 'overnight_window_ended' else 'overnight_cancelled' end, updated_at = ?
      where owner_id = ? and session_id = ? and status not in ('completed', 'failed')`)
      .bind(mode, mode, now, ownerId, sessionId),
  ]);
}

export async function overnightSessionById(env: Env, ownerId: string, sessionId: string) {
  const row = await sessionRowById(env, ownerId, sessionId);
  if (!row) throw new Error("overnight_session_not_found");
  const tasks = await taskRowsForSessions(env, ownerId, [row.id]);
  return publicSession(row, tasks);
}

export async function listOvernightSessions(env: Env, ownerId: string): Promise<OvernightSession[]> {
  await expireOverdueSessions(env, ownerId);
  const result = await env.DB.prepare(`select ${SESSION_COLUMNS} from creative_overnight_sessions
    where owner_id = ? order by created_at desc limit 30`).bind(ownerId).all<OvernightSessionRow>();
  const rows = result.results ?? [];
  const tasks = await taskRowsForSessions(env, ownerId, rows.map((row) => row.id));
  const bySession = new Map<string, OvernightTaskRow[]>();
  for (const task of tasks) bySession.set(task.sessionId, [...(bySession.get(task.sessionId) ?? []), task]);
  return rows.map((row) => publicSession(row, bySession.get(row.id) ?? []));
}

function normalizedIso(value: unknown, error: string) {
  const text = boundedText(value, 40);
  const time = Date.parse(text);
  if (!text || !Number.isFinite(time)) throw new Error(error);
  return new Date(time).toISOString();
}

function effectiveParameters(parameters: WorkflowParameter[], values: Record<string, WorkflowScalar> | null) {
  return parameters.map((parameter) => ({
    ...parameter,
    value: values && Object.prototype.hasOwnProperty.call(values, parameter.id) ? values[parameter.id] : parameter.value,
  }));
}

async function normalizedWorkflowSelections(
  env: Env,
  ownerId: string,
  projectId: string,
  worldId: string | null,
  modalities: GenerationModality[],
  requests: CreateOvernightSessionRequest["workflowSelections"],
) {
  if (!Array.isArray(requests) || requests.length !== modalities.length) throw new Error("overnight_workflow_selection_required");
  const selections: OvernightWorkflowSelection[] = [];
  for (const modality of modalities) {
    const request = requests.find((item) => item.modality === modality);
    if (!request || requests.filter((item) => item.modality === modality).length !== 1) throw new Error("overnight_workflow_selection_required");
    const plan = await workflowExecutionPlan(env, ownerId, boundedText(request.workflowId, 100), boundedText(request.workflowRevisionId, 100));
    if (plan.workflow.projectId !== projectId || modalityForWorkflow(plan.workflow.modality) !== modality) {
      throw new Error("overnight_workflow_project_mismatch");
    }
    if (plan.workflow.currentRevision.parameters.some((parameter) => parameter.kind === "media")) {
      throw new Error("overnight_source_free_workflow_required");
    }
    if (!generationWorkflowPromptParameters(plan.workflow.currentRevision.parameters).length
      || !primaryWorkflowPromptParameter(plan.workflow.currentRevision.parameters, plan.workflow.modality)) {
      throw new Error("overnight_prompt_workflow_required");
    }
    const recipeId = boundedText(request.recipeId, 100) || null;
    const recipe = recipeId ? await generationRecipeById(env, ownerId, recipeId) : null;
    if (recipeId && (!recipe || recipe.archivedAt || recipe.workflowId !== plan.workflow.id
      || recipe.workflowRevisionId !== plan.workflow.currentRevision.id || recipe.mediaKind !== modality
      || (recipe.projectId !== null && recipe.projectId !== projectId)
      || (recipe.worldId !== null && recipe.worldId !== worldId)
      || recipe.sourceKinds.length !== 1 || recipe.sourceKinds[0] !== "prompt")) {
      throw new Error("overnight_recipe_mismatch");
    }
    const parameters = effectiveParameters(plan.workflow.currentRevision.parameters, recipe?.parameters ?? null);
    if (modality === "image" && assessImagePerformance(Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter.value]))).requiresExplicitCustom) {
      throw new Error("overnight_image_fast_workflow_required");
    }
    let promptProfileId: OvernightWorkflowSelection["promptProfileId"] = null;
    let promptOutputFormat: OvernightWorkflowSelection["promptOutputFormat"] = null;
    let videoDurationSeconds: number | null = null;
    if (modality === "video") {
      const profile = videoWorkflowPromptProfile({ ...plan.workflow, currentRevision: { ...plan.workflow.currentRevision, parameters } }, "text-to-video");
      promptProfileId = profile.id;
      promptOutputFormat = profile.outputFormat;
      const durationParameters = videoWorkflowDurationParameters(parameters);
      const duration = normalizeVideoDurationSeconds(durationParameters[0]?.value);
      if (!durationParameters.length || duration === null || durationParameters.some((parameter) => Number(parameter.value) !== duration)
        || !workflowSupportsVideoDuration({ ...plan.workflow, currentRevision: { ...plan.workflow.currentRevision, parameters } }, duration)) {
        throw new Error("overnight_video_duration_invalid");
      }
      videoDurationSeconds = duration;
    } else if (modality === "music") {
      const profile = musicWorkflowPromptProfile({ ...plan.workflow, currentRevision: { ...plan.workflow.currentRevision, parameters } });
      promptProfileId = profile.id;
      promptOutputFormat = profile.outputFormat;
    }
    selections.push({
      modality,
      recipeId,
      recipeUpdatedAt: recipe?.updatedAt ?? null,
      workflowId: plan.workflow.id,
      workflowRevisionId: plan.workflow.currentRevision.id,
      workflowName: plan.workflow.name,
      workflowVersion: plan.workflow.currentRevision.version,
      targetModel: recipe?.modelIdentifier ?? plan.workflow.currentRevision.models[0] ?? null,
      promptProfileId,
      promptOutputFormat,
      videoDurationSeconds,
      estimatedDurationMs: recipe?.evidenceSummary.medianDurationMs ?? null,
    });
  }
  return selections;
}

async function plannerContext(env: Env, ownerId: string, projectId: string, dnaArtifactId: string, worldId: string | null) {
  const project = await projectById(env, ownerId, projectId);
  if (!project || project.status !== "active") throw new Error("project_not_found");
  const dna = (await listLocalDna(env, ownerId)).find((item) => item.artifactId === dnaArtifactId);
  if (!dna || dna.projectId !== projectId) throw new Error("creative_dna_not_found");
  await assertCreativeDnaReviewed(env, ownerId, dna);
  const records = await listWorldRecords(env, ownerId);
  const world = worldId ? records.worlds.find((item) => item.id === worldId && item.projectId === projectId && item.status === "active") : null;
  if (worldId && !world) throw new Error("overnight_world_not_found");
  const protectedIdentities = [...new Set([
    dna.source.kind === "commercial_reference" ? normalizedIdentity(dna.source.referenceLabel) : "",
    ...records.canonReferences
      .filter((reference) => reference.projectId === projectId && reference.source.kind === "commercial-reference")
      .map((reference) => reference.source.kind === "commercial-reference" ? normalizedIdentity(reference.source.identity) : ""),
  ].filter(Boolean))];
  const safe = (value: unknown, maxLength: number) => withoutProtectedIdentities(value, protectedIdentities, maxLength);
  const context: OvernightPlannerContext = {
    project: {
      name: safe(project.name, 100),
      description: safe(project.description, 800),
      currentDirection: safe(project.note, 800),
    },
    creativeDna: {
      name: safe(dna.name, 100),
      directive: safe(dna.source.directive, 1_200),
      dimensions: dna.shared,
      imageLanguage: safe(dna.generationPrompts.image, 1_500),
      musicLanguage: safe(dna.generationPrompts.music, 1_500),
    },
    world: world ? {
      name: safe(world.name, 100),
      premise: safe(world.premise, 1_200),
      entities: records.worldEntities
        .filter((entity) => entity.worldId === world.id && entity.status === "active")
        .slice(0, 24)
        .map((entity) => ({
          kind: entity.kind,
          name: safe(entity.name, 100),
          summary: safe(entity.summary, 500),
          attributes: entity.attributes.slice(0, 12).map((attribute) => ({
            facet: attribute.facet,
            value: safe(attribute.value, 240),
          })),
        })),
      rules: records.continuityRules
        .filter((rule) => rule.worldId === world.id && rule.status === "active")
        .slice(0, 32)
        .map((rule) => ({ strength: rule.strength, facet: rule.facet, instruction: safe(rule.instruction, 500), modalities: rule.modalities })),
      canonNotes: records.canonReferences
        .filter((reference) => reference.worldId === world.id && reference.status === "canonical")
        .flatMap((reference) => reference.continuityNotes)
        .slice(0, 48)
        .map((note) => ({ facet: note.facet, value: safe(note.value, 360) })),
    } : null,
  };
  return { context, dna };
}

export async function createOvernightSession(env: Env, ownerId: string, input: CreateOvernightSessionRequest) {
  const projectId = boundedText(input.projectId, 100);
  const dnaArtifactId = boundedText(input.dnaArtifactId, 100);
  const worldId = boundedText(input.worldId, 100) || null;
  const storySeed = String(input.storySeed ?? "").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const storyCount = Number(input.storyCount);
  const outputCount = Number(input.outputCount);
  const modalities = [...new Set(Array.isArray(input.modalities) ? input.modalities : [])];
  const scheduledFor = normalizedIso(input.scheduledFor, "overnight_schedule_invalid");
  const cutoffAt = normalizedIso(input.cutoffAt, "overnight_schedule_invalid");
  const scheduledTime = Date.parse(scheduledFor);
  const cutoffTime = Date.parse(cutoffAt);
  const maxFailures = Number(input.maxFailures);
  const maxBytes = Number(input.maxBytes);
  const idempotencyKey = boundedText(input.idempotencyKey, 100);
  if (!projectId || !dnaArtifactId || storySeed.length < 4 || storySeed.length > 2_000
    || !Number.isInteger(storyCount) || storyCount < 1 || storyCount > 3
    || !Number.isInteger(outputCount) || outputCount < 3 || outputCount > 8
    || !modalities.length || modalities.some((modality) => !["image", "video", "music"].includes(modality))
    || outputCount < Math.max(3, minimumOvernightOutputCount(modalities as GenerationModality[], storyCount))
    || !["familiar", "exploratory", "wild"].includes(input.exploration)
    || scheduledTime < Date.now() - 5 * 60_000 || scheduledTime > Date.now() + 7 * 24 * 60 * 60_000
    || cutoffTime < scheduledTime + 30 * 60_000 || cutoffTime > scheduledTime + 12 * 60 * 60_000
    || !Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > 3
    || !Number.isInteger(maxBytes) || maxBytes < 100 * 1024 * 1024 || maxBytes > 2 * 1024 * 1024 * 1024
    || !/^[a-z0-9_-]{16,100}$/i.test(idempotencyKey)) throw new Error("invalid_overnight_session");
  const existing = await env.DB.prepare(`select ${SESSION_COLUMNS} from creative_overnight_sessions where owner_id = ? and idempotency_key = ?`)
    .bind(ownerId, idempotencyKey).first<OvernightSessionRow>();
  if (existing) return overnightSessionById(env, ownerId, existing.id);
  const { context } = await plannerContext(env, ownerId, projectId, dnaArtifactId, worldId);
  const selections = await normalizedWorkflowSelections(env, ownerId, projectId, worldId, modalities, input.workflowSelections);
  await expireOverdueSessions(env, ownerId, projectId);
  const currentActive = await env.DB.prepare(`select id from creative_overnight_sessions where owner_id = ? and project_id = ?
    and status in ('armed', 'planning', 'running', 'paused', 'needs-attention') limit 1`).bind(ownerId, projectId).first<{ id: string }>();
  if (currentActive) throw new Error("overnight_session_already_active");
  const sessionId = id("overnight");
  const now = new Date().toISOString();
  const name = boundedText(input.name, 100) || `Night Studio · ${new Date(scheduledFor).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  try {
    await env.DB.prepare(`insert into creative_overnight_sessions (
      id, owner_id, project_id, dna_artifact_id, world_id, name, story_seed, story_count, output_count,
      modalities_json, exploration, workflow_selections_json, planner_context_json, status, scheduled_for, cutoff_at,
      max_failures, max_bytes, plan_json, plan_hash, planner_model, comfy_prompt_id, runner_id, runner_lease_until,
      error, idempotency_key, created_at, updated_at, started_at, completed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'armed', ?, ?, ?, ?, null, null, null, null, null, null, null, ?, ?, ?, null, null)`)
      .bind(sessionId, ownerId, projectId, dnaArtifactId, worldId, name, storySeed, storyCount, outputCount,
        JSON.stringify(modalities), input.exploration, JSON.stringify(selections), JSON.stringify(context), scheduledFor,
        cutoffAt, maxFailures, maxBytes, idempotencyKey, now, now).run();
  } catch (caught) {
    const idempotent = await env.DB.prepare(`select ${SESSION_COLUMNS} from creative_overnight_sessions where owner_id = ? and idempotency_key = ?`)
      .bind(ownerId, idempotencyKey).first<OvernightSessionRow>();
    if (idempotent) return overnightSessionById(env, ownerId, idempotent.id);
    const winner = await env.DB.prepare(`select id from creative_overnight_sessions where owner_id = ? and project_id = ?
      and status in ('armed', 'planning', 'running', 'paused', 'needs-attention') limit 1`).bind(ownerId, projectId).first<{ id: string }>();
    if (winner) throw new Error("overnight_session_already_active", { cause: caught });
    throw caught;
  }
  return overnightSessionById(env, ownerId, sessionId);
}

export async function pauseOvernightSession(env: Env, ownerId: string, sessionId: string) {
  const current = await sessionRowById(env, ownerId, sessionId);
  if (!current) throw new Error("overnight_session_not_found");
  if (!PAUSEABLE_SESSION_STATUSES.has(current.status)) throw new Error("overnight_session_not_pauseable");
  if (!await compareAndSetSessionStatus(env, ownerId, current.id, [current.status], "paused", null, true)) {
    throw new Error("overnight_session_not_pauseable");
  }
  await cancelActiveSessionJobs(env, ownerId, current.id, "overnight_paused", true);
  return overnightSessionById(env, ownerId, current.id);
}

export async function resumeOvernightSession(env: Env, ownerId: string, sessionId: string) {
  const current = await sessionRowById(env, ownerId, sessionId);
  if (!current) throw new Error("overnight_session_not_found");
  if (current.status !== "paused") throw new Error("overnight_session_not_resumable");
  if (Date.parse(current.cutoffAt) <= Date.now()) throw new Error("overnight_window_ended");
  const status: OvernightSessionStatus = current.planJson ? "running" : "armed";
  const now = new Date().toISOString();
  const [transition] = await env.DB.batch([
    env.DB.prepare(`update creative_overnight_sessions set status = ?, error = null, updated_at = ?
      where id = ? and owner_id = ? and status = 'paused' and cutoff_at > ?`)
      .bind(status, now, current.id, ownerId, now),
    env.DB.prepare(`update creative_jobs set status = 'queued', progress = 1, upstream_id = null, artifact_id = null,
      error = null, started_at = null, execution_stage = 'queued', stage_updated_at = ?, completed_at = null,
      cancelled_at = null, next_reconcile_at = null, reconcile_lease_until = null,
      not_before = case when runner_lease_until is not null and runner_lease_until > ? then runner_lease_until else ? end,
      updated_at = ? where owner_id = ? and automation_session_id = ? and status = 'cancelled'
        and error = 'overnight_paused' and artifact_id is null and exists (
          select 1 from creative_overnight_sessions s where s.id = creative_jobs.automation_session_id
            and s.owner_id = creative_jobs.owner_id and s.status = ? and s.cutoff_at > ?
        )`)
      .bind(now, now, now, now, ownerId, current.id, status, now),
    env.DB.prepare(`update creative_overnight_tasks set status = 'queued', error = null, updated_at = ?
      where owner_id = ? and session_id = ? and job_id in (
        select j.id from creative_jobs j where j.owner_id = ? and j.automation_session_id = ? and j.status = 'queued'
      )`).bind(now, ownerId, current.id, ownerId, current.id),
  ]);
  if (!transition.meta.changes) {
    throw new Error("overnight_session_not_resumable");
  }
  await reconcileOvernightSessions(env, ownerId);
  return overnightSessionById(env, ownerId, current.id);
}

export async function cancelOvernightSession(env: Env, ownerId: string, sessionId: string) {
  const current = await sessionRowById(env, ownerId, sessionId);
  if (!current) throw new Error("overnight_session_not_found");
  if (["completed", "failed", "cancelled"].includes(current.status)) return overnightSessionById(env, ownerId, current.id);
  if (!await compareAndSetSessionStatus(env, ownerId, current.id, [current.status], "cancelled")) {
    const latest = await sessionRowById(env, ownerId, current.id);
    if (latest && ["completed", "failed", "cancelled"].includes(latest.status)) return overnightSessionById(env, ownerId, current.id);
    throw new Error("overnight_session_not_pauseable");
  }
  await cancelActiveSessionJobs(env, ownerId, current.id, "overnight_cancelled");
  await preserveCompletedAndEndTasks(env, ownerId, current.id, "cancelled");
  return overnightSessionById(env, ownerId, current.id);
}

async function plannerBundle(env: Env, ownerId: string, row: OvernightSessionRow): Promise<OvernightPlannerBundle> {
  const dna = (await listLocalDna(env, ownerId)).find((item) => item.artifactId === row.dnaArtifactId);
  const records = await listWorldRecords(env, ownerId);
  const protectedIdentities = [...new Set([
    dna?.source.kind === "commercial_reference" ? normalizedIdentity(dna.source.referenceLabel) : "",
    ...records.canonReferences
      .filter((reference) => reference.projectId === row.projectId && reference.source.kind === "commercial-reference")
      .map((reference) => reference.source.kind === "commercial-reference" ? normalizedIdentity(reference.source.identity) : ""),
  ].filter(Boolean))];
  const storedContext = storedJson<OvernightPlannerContext>(row.plannerContextJson, {
    project: { name: "", description: "", currentDirection: "" },
    creativeDna: { name: "", directive: "", dimensions: {}, imageLanguage: "", musicLanguage: "" },
    world: null,
  });
  const baseSession = publicSession(row, []);
  const musicRole = baseSession.workflowSelections.find((selection) => selection.modality === "music")?.promptOutputFormat === "structured-caption"
    ? "soundtrack" as const
    : "soundscape" as const;
  const session: OvernightSession = {
    ...baseSession,
    storySeed: withoutProtectedIdentities(baseSession.storySeed, protectedIdentities, 2_000),
    workflowSelections: baseSession.workflowSelections.map((selection) => ({
      ...selection,
      workflowName: withoutProtectedIdentities(selection.workflowName, protectedIdentities, 160),
      targetModel: selection.targetModel ? withoutProtectedIdentities(selection.targetModel, protectedIdentities, 180) : null,
    })),
  };
  return {
    session,
    slots: overnightPlanSlots(storedJson(row.modalitiesJson, []), Number(row.outputCount), Number(row.storyCount), musicRole),
    context: redactPlannerEvidence(storedContext, protectedIdentities),
  };
}

export async function claimOvernightPlan(env: Env, runner: RunnerIdentity) {
  const now = new Date();
  const nowValue = now.toISOString();
  await expireOverdueSessions(env, runner.ownerId);
  const candidate = await env.DB.prepare(`select ${SESSION_COLUMNS} from creative_overnight_sessions
    where owner_id = ? and status in ('armed', 'planning') and scheduled_for <= ? and cutoff_at > ?
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)
    order by case when runner_id = ? then 0 else 1 end, scheduled_for, created_at limit 1`)
    .bind(runner.ownerId, nowValue, nowValue, nowValue, runner.id, runner.id).first<OvernightSessionRow>();
  if (!candidate) return null;
  const leaseUntil = new Date(now.getTime() + 2 * 60_000).toISOString();
  const changed = await env.DB.prepare(`update creative_overnight_sessions set status = 'planning', runner_id = ?, runner_lease_until = ?,
    error = null, started_at = coalesce(started_at, ?), updated_at = ? where id = ? and owner_id = ?
    and status in ('armed', 'planning') and scheduled_for <= ? and cutoff_at > ?
    and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)`)
    .bind(runner.id, leaseUntil, nowValue, nowValue, candidate.id, runner.ownerId, nowValue, nowValue, nowValue, runner.id).run();
  if (!changed.meta.changes) return null;
  return plannerBundle(env, runner.ownerId, { ...candidate, status: "planning", runnerId: runner.id, runnerLeaseUntil: leaseUntil, startedAt: candidate.startedAt ?? nowValue, updatedAt: nowValue });
}

export async function heartbeatOvernightPlan(env: Env, runner: RunnerIdentity, sessionId: string, input: OvernightPlanHeartbeatRequest) {
  const progress = Number(input.progress);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error("overnight_plan_not_completable");
  const now = new Date();
  const changed = await env.DB.prepare(`update creative_overnight_sessions set runner_lease_until = ?, updated_at = ?
    where id = ? and owner_id = ? and runner_id = ? and status = 'planning' and cutoff_at > ?`)
    .bind(new Date(now.getTime() + 2 * 60_000).toISOString(), now.toISOString(), boundedText(sessionId, 100), runner.ownerId, runner.id, now.toISOString()).run();
  if (!changed.meta.changes) throw new Error("overnight_plan_not_completable");
  return overnightSessionById(env, runner.ownerId, sessionId);
}

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function completeOvernightPlan(env: Env, runner: RunnerIdentity, sessionId: string, input: CompleteOvernightPlanRequest) {
  const current = await sessionRowById(env, runner.ownerId, sessionId);
  if (!current) throw new Error("overnight_session_not_found");
  const selections = storedJson<OvernightWorkflowSelection[]>(current.workflowSelectionsJson, []);
  const musicRole = selections.find((selection) => selection.modality === "music")?.promptOutputFormat === "structured-caption"
    ? "soundtrack" as const
    : "soundscape" as const;
  const slots = overnightPlanSlots(storedJson(current.modalitiesJson, []), Number(current.outputCount), Number(current.storyCount), musicRole);
  const plan = normalizeOvernightPlan(input.plan, slots, Number(current.storyCount));
  const planJson = JSON.stringify(plan);
  const planHash = await digest(planJson);
  if (current.planHash) {
    if (current.planHash !== planHash) throw new Error("overnight_plan_conflict");
    return overnightSessionById(env, runner.ownerId, current.id);
  }
  if (current.status !== "planning" || current.runnerId !== runner.id) throw new Error("overnight_plan_not_completable");
  const comfyPromptId = boundedText(input.comfyPromptId, 120);
  const plannerModel = boundedText(input.plannerModel, 180);
  if (!comfyPromptId || !plannerModel) throw new Error("overnight_plan_result_invalid");
  const worldRecords = await listWorldRecords(env, runner.ownerId);
  const commercialReferences = worldRecords.canonReferences.filter((reference) => reference.projectId === current.projectId
    && reference.source.kind === "commercial-reference");
  const dna = (await listLocalDna(env, runner.ownerId)).find((item) => item.artifactId === current.dnaArtifactId);
  const protectedIdentities = [
    dna?.source.kind === "commercial_reference" ? normalizedIdentity(dna.source.referenceLabel) : "",
    ...commercialReferences.map((reference) => reference.source.kind === "commercial-reference" ? normalizedIdentity(reference.source.identity) : ""),
  ].filter(Boolean);
  const combinedPrompts = plan.outputs.map((output) => output.prompt).join("\n");
  if (containsCommercialReferenceIdentity(combinedPrompts, commercialReferences)
    || containsProtectedIdentity(combinedPrompts, protectedIdentities)) throw new Error("continuity_commercial_identity_in_prompt");
  if (/\b(?:as an ai|language model|workflow id|model path|comfyui|schemaVersion)\b/i.test(combinedPrompts)) {
    throw new Error("overnight_plan_metadata_leak");
  }
  const now = new Date().toISOString();
  const statements = plan.outputs.map((output) => {
    const story = plan.stories[output.storyIndex - 1];
    const selection = selections.find((item) => item.modality === output.modality);
    if (!story || !selection) throw new Error("overnight_plan_output_invalid");
    const taskId = id("nighttask");
    const storyId = `story-${output.storyIndex}`;
    const sceneId = output.sceneIndex === null ? null : `scene-${output.storyIndex}-${output.sceneIndex}`;
    return env.DB.prepare(`insert into creative_overnight_tasks (
      id, owner_id, session_id, ordinal, story_id, story_title, scene_id, scene_title, role, modality, prompt, seed,
      status, recipe_id, recipe_updated_at, workflow_id, workflow_revision_id, job_id, artifact_id, error, created_at, updated_at
    ) select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, null, null, null, ?, ?
      where exists (select 1 from creative_overnight_sessions s where s.id = ? and s.owner_id = ?
        and s.runner_id = ? and s.status = 'planning' and s.plan_hash is null and s.cutoff_at > ?)`)
      .bind(taskId, runner.ownerId, current.id, output.ordinal, storyId, story.title, sceneId,
        output.sceneIndex === null ? null : output.title, output.role, output.modality, output.prompt,
        overnightTaskSeed(current.id, output.ordinal), selection.recipeId, selection.recipeUpdatedAt,
        selection.workflowId, selection.workflowRevisionId, now, now, current.id, runner.ownerId, runner.id, now);
  });
  const results = await env.DB.batch([
    ...statements,
    env.DB.prepare(`update creative_overnight_sessions set status = 'running', plan_json = ?, plan_hash = ?, planner_model = ?,
      comfy_prompt_id = ?, runner_lease_until = null, error = null, updated_at = ? where id = ? and owner_id = ?
      and runner_id = ? and status = 'planning' and plan_hash is null and cutoff_at > ?`)
      .bind(planJson, planHash, plannerModel, comfyPromptId, now, current.id, runner.ownerId, runner.id, now),
  ]);
  if (results.some((result) => !result.meta.changes)) throw new Error("overnight_plan_not_completable");
  await reconcileOvernightSessions(env, runner.ownerId);
  return overnightSessionById(env, runner.ownerId, current.id);
}

export async function failOvernightPlan(env: Env, runner: RunnerIdentity, sessionId: string, input: FailOvernightPlanRequest) {
  const error = boundedText(input.error, 500) || "overnight_planning_failed";
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`update creative_overnight_sessions set status = 'failed',
    error = case when cutoff_at <= ? then 'overnight_window_ended' else ? end, runner_lease_until = null,
    completed_at = ?, updated_at = ? where id = ? and owner_id = ? and runner_id = ? and status = 'planning'`)
    .bind(now, error, now, now, boundedText(sessionId, 100), runner.ownerId, runner.id).run();
  if (!changed.meta.changes) throw new Error("overnight_plan_not_completable");
  return overnightSessionById(env, runner.ownerId, sessionId);
}

async function syncTaskJobs(env: Env, ownerId: string, sessionId: string) {
  const rows = await taskRowsForSessions(env, ownerId, [sessionId]);
  const now = new Date().toISOString();
  for (const row of rows) {
    if (!row.jobId || !row.jobStatus) continue;
    const nextStatus = row.jobStatus as OvernightTaskStatus;
    const artifactId = row.jobArtifactId ?? row.artifactId;
    const error = row.jobError ?? row.error;
    if (row.status === nextStatus && row.artifactId === artifactId && row.error === error) continue;
    await env.DB.prepare(`update creative_overnight_tasks set status = ?, artifact_id = ?, error = ?, updated_at = ?
      where id = ? and owner_id = ?`).bind(nextStatus, artifactId, error, now, row.id, ownerId).run();
  }
}

async function materializeTask(env: Env, ownerId: string, session: OvernightSessionRow, task: OvernightTaskRow) {
  const currentSession = await sessionRowById(env, ownerId, session.id);
  if (!currentSession || currentSession.status !== "running" || Date.parse(currentSession.cutoffAt) <= Date.now()) {
    throw new Error("overnight_session_not_running");
  }
  const selections = storedJson<OvernightWorkflowSelection[]>(session.workflowSelectionsJson, []);
  const selection = selections.find((item) => item.modality === task.modality);
  if (!selection || selection.workflowId !== task.workflowId) throw new Error("overnight_workflow_selection_missing");
  const recipe = task.recipeId ? await generationRecipeById(env, ownerId, task.recipeId) : null;
  if (task.recipeId && (!recipe || recipe.archivedAt || recipe.updatedAt !== task.recipeUpdatedAt
    || recipe.workflowId !== selection.workflowId || recipe.workflowRevisionId !== selection.workflowRevisionId
    || recipe.sourceKinds.length !== 1 || recipe.sourceKinds[0] !== "prompt")) throw new Error("overnight_recipe_changed");
  const base = await workflowExecutionPlan(env, ownerId, selection.workflowId, selection.workflowRevisionId);
  if (base.workflow.projectId !== session.projectId || modalityForWorkflow(base.workflow.modality) !== task.modality
    || base.workflow.currentRevision.parameters.some((parameter) => parameter.kind === "media")) {
    throw new Error("overnight_workflow_changed");
  }
  let prompt = task.prompt;
  let videoSpeech: GenerationSettingsStamp["videoSpeech"];
  if (task.modality === "video") {
    const profile = videoWorkflowPromptProfile(base.workflow, "text-to-video");
    const compiled = compileVideoPromptWithSpeech(prompt, { mode: "no-speech" }, profile);
    prompt = compiled.prompt;
    videoSpeech = compiled.speech;
  }
  const values: Record<string, WorkflowScalar> = Object.fromEntries(base.workflow.currentRevision.parameters
    .map((parameter) => [parameter.id, recipe?.parameters[parameter.id] ?? parameter.value]));
  for (const parameter of generationWorkflowPromptParameters(base.workflow.currentRevision.parameters)) values[parameter.id] = prompt;
  for (const parameter of generationControlSet(base.workflow.currentRevision.parameters).seed) values[parameter.id] = task.seed;
  const workflow = await createAutomationWorkflowRevision(env, ownerId, base.workflow.id, {
    baseRevisionId: base.workflow.currentRevision.id,
    values,
  });
  const parameterValues = Object.fromEntries(workflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value]));
  if (task.modality === "image" && assessImagePerformance(parameterValues).requiresExplicitCustom) {
    throw new Error("overnight_image_fast_workflow_required");
  }
  const dna = (await listLocalDna(env, ownerId)).find((item) => item.artifactId === session.dnaArtifactId);
  if (!dna || dna.projectId !== session.projectId) throw new Error("creative_dna_not_found");
  await assertCreativeDnaReviewed(env, ownerId, dna);
  const planHash = session.planHash;
  if (!planHash) throw new Error("overnight_plan_missing");
  const createdAt = new Date().toISOString();
  const videoDuration = task.modality === "video" ? normalizeVideoDurationSeconds(selection.videoDurationSeconds) ?? undefined : undefined;
  const settingsStamp: GenerationSettingsStamp = {
    schemaVersion: 1,
    source: "comfyui-workflow",
    createdAt,
    reusedFromJobId: null,
    prompt,
    provider: "local-comfyui",
    modality: task.modality,
    performanceMode: task.modality === "image" ? "fast-default" : undefined,
    videoDurationSeconds: videoDuration,
    workflow: {
      workflowId: workflow.id,
      revisionId: workflow.currentRevision.id,
      version: workflow.currentRevision.version,
      name: workflow.name,
      format: workflow.currentRevision.format,
      contentHash: workflow.currentRevision.contentHash,
    },
    parameters: parameterValues,
    models: workflow.currentRevision.models,
    workloadEvidence: { source: "workflow-revision", profileId: workflow.currentRevision.id, label: `${workflow.name} v${workflow.currentRevision.version}` },
    inputAssetIds: [],
    inputArtifactIds: [],
    inputSources: [],
    inputBindings: {},
    musicPromptProfile: task.modality === "music" ? musicWorkflowPromptProfile(workflow) : undefined,
    videoSpeech,
    overnight: {
      schemaVersion: "creative-studio-overnight-generation/1.0",
      sessionId: session.id,
      taskId: task.id,
      storyId: task.storyId,
      storyTitle: task.storyTitle,
      sceneId: task.sceneId,
      taskTitle: task.sceneTitle ?? task.storyTitle,
      role: task.role,
      recipeId: task.recipeId,
      recipeUpdatedAt: task.recipeUpdatedAt,
      planHash,
      seed: task.seed,
    },
  };
  const created = await createQueuedJob(env, ownerId, {
    projectId: session.projectId,
    dna,
    modality: task.modality,
    idempotencyKey: `overnight_${session.id}_${task.id}`.slice(0, 100),
    reconcileEmail: null,
    provider: "local-comfyui",
    promptOverride: prompt,
    settingsStampOverride: settingsStamp,
    executionTarget: "local-comfyui",
    workflowId: workflow.id,
    workflowRevisionId: workflow.currentRevision.id,
    priority: 10,
    automationSessionId: session.id,
  });
  const linked = await env.DB.prepare(`update creative_overnight_tasks set status = 'queued', job_id = ?, workflow_revision_id = ?,
    error = null, updated_at = ? where id = ? and owner_id = ? and status = 'planned'`)
    .bind(created.job.id, workflow.currentRevision.id, createdAt, task.id, ownerId).run();
  const stillRunning = await env.DB.prepare(`select id from creative_overnight_sessions where id = ? and owner_id = ?
    and status = 'running' and cutoff_at > ?`).bind(session.id, ownerId, createdAt).first<{ id: string }>();
  if (!linked.meta.changes || !stillRunning) {
    await cancelOwnedJob(env, ownerId, created.job.id).catch(() => undefined);
    if (linked.meta.changes) {
      await env.DB.prepare(`update creative_overnight_tasks set status = 'cancelled', error = 'overnight_session_not_running', updated_at = ?
        where id = ? and owner_id = ? and job_id = ? and status in ('queued', 'running')`)
        .bind(new Date().toISOString(), task.id, ownerId, created.job.id).run();
    }
    throw new Error("overnight_session_not_running");
  }
}

async function endExpiredRunningSession(env: Env, ownerId: string, row: OvernightSessionRow) {
  if (!await compareAndSetSessionStatus(env, ownerId, row.id, ["running", "paused"], "failed", "overnight_window_ended")) return;
  await cancelActiveSessionJobs(env, ownerId, row.id, "overnight_window_ended");
  await preserveCompletedAndEndTasks(env, ownerId, row.id, "cutoff");
}

async function reconcileSession(env: Env, ownerId: string, row: OvernightSessionRow) {
  if (row.status !== "running") return;
  if (Date.parse(row.cutoffAt) <= Date.now()) {
    await endExpiredRunningSession(env, ownerId, row);
    return;
  }
  await syncTaskJobs(env, ownerId, row.id);
  const tasks = await taskRowsForSessions(env, ownerId, [row.id]);
  const progress = sessionProgress(tasks);
  const active = tasks.some((task) => taskStatus(task) === "queued" || taskStatus(task) === "running");
  const now = new Date().toISOString();
  if (progress.failed >= Number(row.maxFailures)) {
    await compareAndSetSessionStatus(env, ownerId, row.id, ["running"], "needs-attention", "overnight_failure_limit_reached");
    return;
  }
  if (progress.retainedBytes >= Number(row.maxBytes)) {
    await compareAndSetSessionStatus(env, ownerId, row.id, ["running"], "needs-attention", "overnight_storage_limit_reached");
    return;
  }
  const unfinished = tasks.filter((task) => !TERMINAL_TASK_STATUSES.has(taskStatus(task)));
  if (!unfinished.length && tasks.length) {
    await compareAndSetSessionStatus(env, ownerId, row.id, ["running"], progress.completed ? "completed" : "failed", progress.completed ? null : "overnight_no_outputs_completed");
    return;
  }
  if (Date.parse(row.cutoffAt) <= Date.now()) {
    await endExpiredRunningSession(env, ownerId, row);
    return;
  }
  if (active) return;
  const next = tasks
    .filter((task) => taskStatus(task) === "planned")
    .sort((left, right) => {
      const order = (modality: GenerationModality) => modality === "image" ? 0 : modality === "video" ? 1 : 2;
      return order(left.modality) - order(right.modality) || left.ordinal - right.ordinal;
    })[0];
  if (!next) return;
  try {
    await materializeTask(env, ownerId, row, next);
  } catch (caught) {
    const error = boundedText(caught instanceof Error ? caught.message : "overnight_task_materialization_failed", 500);
    await env.DB.prepare(`update creative_overnight_tasks set status = 'failed', error = ?, updated_at = ?
      where id = ? and owner_id = ? and status = 'planned' and exists (
        select 1 from creative_overnight_sessions s where s.id = creative_overnight_tasks.session_id
          and s.owner_id = creative_overnight_tasks.owner_id and s.status = 'running' and s.cutoff_at > ?
      )`).bind(error, now, next.id, ownerId, now).run();
  }
}

/** Runner-driven orchestration: no browser polling, Cloudflare Queue, or new cron is needed. */
export async function reconcileOvernightSessions(env: Env, ownerId: string) {
  await expireOverdueSessions(env, ownerId);
  const result = await env.DB.prepare(`select ${SESSION_COLUMNS} from creative_overnight_sessions
    where owner_id = ? and status = 'running' order by created_at limit 10`).bind(ownerId).all<OvernightSessionRow>();
  for (const row of result.results ?? []) await reconcileSession(env, ownerId, row);
}
