import {
  LOVE_LOOP_DAILY_COUNT,
  LOVE_LOOP_GENERATION_SCHEMA_VERSION,
  LOVE_LOOP_PROMPT_POLICY_VERSION,
  LOVE_LOOP_SCHEDULE_VERSION,
  LOVE_LOOP_SCHEMA_VERSION,
  assertLoveLoopPromptPolicy,
  assessImagePerformance,
  assessVideoPerformance,
  canonicalGenerationPerformanceParameters,
  compileVideoPromptWithSpeech,
  generationControlSet,
  generationWorkflowPromptParameters,
  isValidLoveLoopTimezone,
  loveLoopDailyBlueprints,
  loveLoopLocalDate,
  loveLoopVideoPromptForProfile,
  normalizeVideoDurationSeconds,
  primaryWorkflowPromptParameter,
  videoWorkflowDurationParameters,
  videoWorkflowPromptProfile,
  workflowSupportsVideoDuration,
  type ConfigureLoveLoopRequest,
  type GenerationSettingsStamp,
  type LoveLoop,
  type LoveLoopDrop,
  type LoveLoopDropStatus,
  type LoveLoopModality,
  type LoveLoopStatus,
  type LoveLoopWorkflowSelection,
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

type LoveLoopRow = {
  id: string;
  projectId: string;
  dnaArtifactId: string;
  timezone: string;
  dailyCount: number;
  status: LoveLoopStatus;
  workflowSelectionsJson: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type LoveLoopDropRow = {
  id: string;
  loopId: string;
  localDate: string;
  ordinal: number;
  scheduledFor: string;
  modality: LoveLoopModality;
  title: string;
  conceptId: string;
  prompt: string;
  seed: number;
  status: LoveLoopDropStatus;
  workflowId: string;
  workflowRevisionId: string;
  recipeId: string | null;
  recipeUpdatedAt: string | null;
  jobId: string | null;
  artifactId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  jobStatus: "queued" | "running" | "completed" | "failed" | "cancelled" | null;
  jobArtifactId: string | null;
  jobError: string | null;
};

const LOOP_COLUMNS = `id, project_id as projectId, dna_artifact_id as dnaArtifactId, timezone,
  daily_count as dailyCount, status, workflow_selections_json as workflowSelectionsJson,
  last_error as lastError, created_at as createdAt, updated_at as updatedAt`;

const DROP_COLUMNS = `d.id, d.loop_id as loopId, d.local_date as localDate, d.ordinal,
  d.scheduled_for as scheduledFor, d.modality, d.title, d.concept_id as conceptId, d.prompt, d.seed,
  d.status, d.workflow_id as workflowId, d.workflow_revision_id as workflowRevisionId,
  d.recipe_id as recipeId, d.recipe_updated_at as recipeUpdatedAt, d.job_id as jobId,
  d.artifact_id as artifactId, d.error, d.created_at as createdAt, d.updated_at as updatedAt,
  j.status as jobStatus, j.artifact_id as jobArtifactId, j.error as jobError`;

const MISSED_WINDOW_GRACE_MS = 2 * 60 * 60_000;
const MATERIALIZATION_RECOVERY_MS = 2 * 60_000;

function storedJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function workflowModality(value: string): LoveLoopModality | null {
  return value === "image" || value === "video" ? value : null;
}

function effectiveParameters(parameters: WorkflowParameter[], values: Record<string, WorkflowScalar> | null) {
  return parameters.map((parameter) => ({
    ...parameter,
    value: values && Object.prototype.hasOwnProperty.call(values, parameter.id) ? values[parameter.id] : parameter.value,
  }));
}

function dropStatus(row: LoveLoopDropRow): LoveLoopDropStatus {
  return row.jobStatus ?? row.status;
}

function publicDrop(row: LoveLoopDropRow): LoveLoopDrop {
  return {
    id: row.id,
    loopId: row.loopId,
    localDate: row.localDate,
    ordinal: Math.max(1, Math.min(3, Number(row.ordinal))) as 1 | 2 | 3,
    scheduledFor: row.scheduledFor,
    modality: row.modality,
    title: row.title,
    conceptId: row.conceptId,
    prompt: row.prompt,
    seed: Number(row.seed),
    status: dropStatus(row),
    jobId: row.jobId,
    artifactId: row.jobArtifactId ?? row.artifactId,
    error: row.jobError ?? row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loopRowForOwner(env: Env, ownerId: string) {
  return env.DB.prepare(`select ${LOOP_COLUMNS} from creative_love_loops where owner_id = ?`)
    .bind(ownerId).first<LoveLoopRow>();
}

async function dropRows(env: Env, ownerId: string, loopId: string, limit = 21) {
  const result = await env.DB.prepare(`select ${DROP_COLUMNS} from creative_love_loop_drops d
    left join creative_jobs j on j.id = d.job_id and j.owner_id = d.owner_id
    where d.owner_id = ? and d.loop_id = ? order by d.scheduled_for desc limit ?`)
    .bind(ownerId, loopId, limit).all<LoveLoopDropRow>();
  return result.results ?? [];
}

function publicLoop(row: LoveLoopRow, drops: LoveLoopDropRow[]): LoveLoop {
  return {
    schemaVersion: LOVE_LOOP_SCHEMA_VERSION,
    id: row.id,
    projectId: row.projectId,
    dnaArtifactId: row.dnaArtifactId,
    timezone: row.timezone,
    dailyCount: LOVE_LOOP_DAILY_COUNT,
    status: row.status,
    workflowSelections: storedJson<LoveLoopWorkflowSelection[]>(row.workflowSelectionsJson, []),
    drops: drops.map(publicDrop),
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function loveLoopForOwner(env: Env, ownerId: string): Promise<LoveLoop | null> {
  const row = await loopRowForOwner(env, ownerId);
  if (!row) return null;
  return publicLoop(row, await dropRows(env, ownerId, row.id));
}

async function validatedDna(env: Env, ownerId: string, projectId: string, dnaArtifactId: string) {
  const project = await projectById(env, ownerId, projectId);
  if (!project || project.status !== "active") throw new Error("project_not_found");
  const dna = (await listLocalDna(env, ownerId)).find((item) => item.artifactId === dnaArtifactId);
  if (!dna || dna.projectId !== projectId) throw new Error("creative_dna_not_found");
  await assertCreativeDnaReviewed(env, ownerId, dna);
  return dna;
}

async function validatedWorkflowSelections(
  env: Env,
  ownerId: string,
  projectId: string,
  requests: ConfigureLoveLoopRequest["workflowSelections"],
) {
  if (!Array.isArray(requests) || requests.length !== 2
    || requests.filter((item) => item.modality === "image").length !== 1
    || requests.filter((item) => item.modality === "video").length !== 1) {
    throw new Error("love_loop_workflows_required");
  }
  const selections: LoveLoopWorkflowSelection[] = [];
  for (const modality of ["image", "video"] as const) {
    const request = requests.find((item) => item.modality === modality)!;
    const plan = await workflowExecutionPlan(env, ownerId, boundedText(request.workflowId, 100), boundedText(request.workflowRevisionId, 100));
    if (plan.workflow.projectId !== projectId || workflowModality(plan.workflow.modality) !== modality
      || plan.workflow.currentRevision.parameters.some((parameter) => parameter.kind === "media")
      || !generationWorkflowPromptParameters(plan.workflow.currentRevision.parameters).length
      || !primaryWorkflowPromptParameter(plan.workflow.currentRevision.parameters, modality)) {
      throw new Error("love_loop_prompt_only_workflow_required");
    }
    const recipeId = boundedText(request.recipeId, 100) || null;
    const recipe = recipeId ? await generationRecipeById(env, ownerId, recipeId) : null;
    if (recipeId && (!recipe || recipe.archivedAt || recipe.workflowId !== plan.workflow.id
      || recipe.workflowRevisionId !== plan.workflow.currentRevision.id || recipe.mediaKind !== modality
      || (recipe.projectId !== null && recipe.projectId !== projectId) || recipe.worldId !== null
      || recipe.sourceKinds.length !== 1 || recipe.sourceKinds[0] !== "prompt")) {
      throw new Error("love_loop_recipe_mismatch");
    }
    const parameters = effectiveParameters(plan.workflow.currentRevision.parameters, recipe?.parameters ?? null);
    if (modality === "image") {
      if (assessImagePerformance(Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter.value]))).requiresExplicitCustom) {
        throw new Error("love_loop_fast_image_required");
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
        promptProfileId: "creative-studio-image-direct-prompt/1.0",
        promptOutputFormat: "natural-language",
        videoDurationSeconds: null,
        estimatedDurationMs: recipe?.evidenceSummary.medianDurationMs ?? null,
      });
      continue;
    }
    const durationParameters = videoWorkflowDurationParameters(parameters);
    const duration = normalizeVideoDurationSeconds(durationParameters[0]?.value);
    if (!durationParameters.length || duration === null
      || durationParameters.some((parameter) => Number(parameter.value) !== duration)
      || !workflowSupportsVideoDuration({ ...plan.workflow, currentRevision: { ...plan.workflow.currentRevision, parameters } }, duration)) {
      throw new Error("love_loop_fast_video_required");
    }
    const assessment = assessVideoPerformance({
      parameters: canonicalGenerationPerformanceParameters(parameters),
      models: plan.workflow.currentRevision.models,
      inputAssetIds: [],
      inputArtifactIds: [],
      prompt: "",
      videoDurationSeconds: duration,
    });
    if (assessment.requiresExplicitHeavy) throw new Error("love_loop_fast_video_required");
    const profile = videoWorkflowPromptProfile({ ...plan.workflow, currentRevision: { ...plan.workflow.currentRevision, parameters } }, "text-to-video");
    selections.push({
      modality,
      recipeId,
      recipeUpdatedAt: recipe?.updatedAt ?? null,
      workflowId: plan.workflow.id,
      workflowRevisionId: plan.workflow.currentRevision.id,
      workflowName: plan.workflow.name,
      workflowVersion: plan.workflow.currentRevision.version,
      targetModel: recipe?.modelIdentifier ?? profile.targetModel ?? plan.workflow.currentRevision.models[0] ?? null,
      promptProfileId: profile.id,
      promptOutputFormat: profile.outputFormat,
      videoDurationSeconds: duration,
      estimatedDurationMs: recipe?.evidenceSummary.medianDurationMs ?? null,
    });
  }
  return selections;
}

async function insertCurrentDay(env: Env, ownerId: string, row: LoveLoopRow, now = new Date(), refreshOpen = false) {
  const localDate = loveLoopLocalDate(now, row.timezone);
  const existing = await env.DB.prepare(`select count(*) as count from creative_love_loop_drops
    where owner_id = ? and loop_id = ? and local_date = ?`)
    .bind(ownerId, row.id, localDate).first<{ count: number }>();
  if (!refreshOpen && Number(existing?.count ?? 0) >= LOVE_LOOP_DAILY_COUNT) return localDate;
  const dna = await validatedDna(env, ownerId, row.projectId, row.dnaArtifactId);
  const selections = storedJson<LoveLoopWorkflowSelection[]>(row.workflowSelectionsJson, []);
  const blueprints = loveLoopDailyBlueprints(row.id, localDate, row.timezone, dna.shared);
  const createdAt = now.toISOString();
  const statements = blueprints.flatMap((blueprint) => {
    const selection = selections.find((item) => item.modality === blueprint.modality);
    if (!selection) throw new Error("love_loop_workflows_required");
    const insert = env.DB.prepare(`insert or ignore into creative_love_loop_drops (
      id, owner_id, loop_id, local_date, ordinal, scheduled_for, modality, title, concept_id, prompt, seed,
      status, workflow_id, workflow_revision_id, recipe_id, recipe_updated_at, job_id, artifact_id, error, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, null, null, null, ?, ?)`)
      .bind(id("lovedrop"), ownerId, row.id, blueprint.localDate, blueprint.ordinal, blueprint.scheduledFor,
        blueprint.modality, blueprint.title, blueprint.conceptId, assertLoveLoopPromptPolicy(blueprint.prompt), blueprint.seed,
        selection.workflowId, selection.workflowRevisionId, selection.recipeId, selection.recipeUpdatedAt, createdAt, createdAt);
    if (!refreshOpen) return [insert];
    const refresh = env.DB.prepare(`update creative_love_loop_drops set scheduled_for = ?, modality = ?, title = ?,
      concept_id = ?, prompt = ?, seed = ?, status = 'planned', workflow_id = ?, workflow_revision_id = ?,
      recipe_id = ?, recipe_updated_at = ?, error = null, updated_at = ?
      where owner_id = ? and loop_id = ? and local_date = ? and ordinal = ? and job_id is null and artifact_id is null`)
      .bind(blueprint.scheduledFor, blueprint.modality, blueprint.title, blueprint.conceptId,
        assertLoveLoopPromptPolicy(blueprint.prompt), blueprint.seed, selection.workflowId, selection.workflowRevisionId,
        selection.recipeId, selection.recipeUpdatedAt, createdAt, ownerId, row.id, blueprint.localDate, blueprint.ordinal);
    return [insert, refresh];
  });
  await env.DB.batch(statements);
  return localDate;
}

export async function configureLoveLoop(env: Env, ownerId: string, input: ConfigureLoveLoopRequest) {
  const existing = await loopRowForOwner(env, ownerId);
  if (existing && existing.status !== "disabled" && existing.status !== "needs-attention") {
    throw new Error("love_loop_already_configured");
  }
  const projectId = boundedText(input.projectId, 100);
  const dnaArtifactId = boundedText(input.dnaArtifactId, 100);
  const timezone = boundedText(input.timezone, 80);
  if (!projectId || !dnaArtifactId || !isValidLoveLoopTimezone(timezone)) throw new Error("invalid_love_loop");
  await validatedDna(env, ownerId, projectId, dnaArtifactId);
  const selections = await validatedWorkflowSelections(env, ownerId, projectId, input.workflowSelections);
  const loopId = existing?.id ?? id("love");
  const now = new Date().toISOString();
  if (existing) {
    const previousMs = Date.parse(existing.updatedAt);
    const lockAt = new Date(Math.max(Date.now(), Number.isFinite(previousMs) ? previousMs + 1 : Date.now())).toISOString();
    const locked = await env.DB.prepare(`update creative_love_loops set status = 'paused', last_error = 'love_loop_reconfiguring', updated_at = ?
      where id = ? and owner_id = ? and status in ('disabled', 'needs-attention') and updated_at = ?`)
      .bind(lockAt, existing.id, ownerId, existing.updatedAt).run();
    if (!locked.meta.changes) throw new Error("love_loop_already_configured");
    try {
      await cancelQueuedDrops(env, ownerId, existing.id, "love_loop_reconfigured");
      const configured = await env.DB.prepare(`update creative_love_loops set project_id = ?, dna_artifact_id = ?, timezone = ?,
        daily_count = 3, workflow_selections_json = ?
        where id = ? and owner_id = ? and status = 'paused' and last_error = 'love_loop_reconfiguring' and updated_at = ?`)
        .bind(projectId, dnaArtifactId, timezone, JSON.stringify(selections), existing.id, ownerId, lockAt).run();
      if (!configured.meta.changes) throw new Error("love_loop_already_configured");
      await env.DB.prepare(`update creative_love_loop_drops set status = 'skipped', error = 'love_loop_reconfigured', updated_at = ?
        where owner_id = ? and loop_id = ? and status = 'planned' and job_id is null`)
        .bind(lockAt, ownerId, existing.id).run();
      const refreshed = await loopRowForOwner(env, ownerId);
      if (!refreshed) throw new Error("love_loop_not_found");
      await insertCurrentDay(env, ownerId, refreshed, new Date(lockAt), true);
      const activeAt = new Date(Math.max(Date.now(), Date.parse(lockAt) + 1)).toISOString();
      const activated = await env.DB.prepare(`update creative_love_loops set status = 'active', last_error = null, updated_at = ?
        where id = ? and owner_id = ? and status = 'paused' and last_error = 'love_loop_reconfiguring' and updated_at = ?`)
        .bind(activeAt, existing.id, ownerId, lockAt).run();
      if (!activated.meta.changes) throw new Error("love_loop_already_configured");
      return loveLoopForOwner(env, ownerId) as Promise<LoveLoop>;
    } catch (caught) {
      const failure = boundedText(caught instanceof Error ? caught.message : "love_loop_reconfiguration_failed", 500);
      await env.DB.prepare(`update creative_love_loops set status = 'needs-attention', last_error = ?, updated_at = ?
        where id = ? and owner_id = ? and status = 'paused' and last_error = 'love_loop_reconfiguring'`)
        .bind(failure, new Date().toISOString(), existing.id, ownerId).run();
      throw caught;
    }
  }
  try {
    await env.DB.prepare(`insert into creative_love_loops (
      id, owner_id, project_id, dna_artifact_id, timezone, daily_count, status,
      workflow_selections_json, last_error, created_at, updated_at
    ) values (?, ?, ?, ?, ?, 3, 'active', ?, null, ?, ?)`)
      .bind(loopId, ownerId, projectId, dnaArtifactId, timezone, JSON.stringify(selections), now, now).run();
  } catch (caught) {
    const winner = await loopRowForOwner(env, ownerId);
    if (winner) return publicLoop(winner, await dropRows(env, ownerId, winner.id));
    throw caught;
  }
  const row = await loopRowForOwner(env, ownerId);
  if (!row) throw new Error("love_loop_not_found");
  await insertCurrentDay(env, ownerId, row);
  return loveLoopForOwner(env, ownerId) as Promise<LoveLoop>;
}

async function cancelQueuedDrops(env: Env, ownerId: string, loopId: string, error: string) {
  const rows = await dropRows(env, ownerId, loopId, 100);
  const stamped = await env.DB.prepare(`select id from creative_jobs where owner_id = ? and status = 'queued'
    and json_extract(settings_stamp_json, '$.loveLoop.loopId') = ?`)
    .bind(ownerId, loopId).all<{ id: string }>();
  const queuedJobIds = new Set((stamped.results ?? []).map((job) => job.id));
  for (const row of rows) {
    if (row.jobId && row.jobStatus === "queued") queuedJobIds.add(row.jobId);
  }
  for (const jobId of queuedJobIds) {
    await cancelOwnedJob(env, ownerId, jobId).catch(() => undefined);
    await env.DB.prepare(`update creative_jobs set error = ?, updated_at = ? where id = ? and owner_id = ? and status = 'cancelled'
      and json_extract(settings_stamp_json, '$.loveLoop.loopId') = ?`)
      .bind(error, new Date().toISOString(), jobId, ownerId, loopId).run();
  }
  const remaining = await env.DB.prepare(`select count(*) as count from creative_jobs where owner_id = ? and status = 'queued'
    and json_extract(settings_stamp_json, '$.loveLoop.loopId') = ?`)
    .bind(ownerId, loopId).first<{ count: number }>();
  if (Number(remaining?.count ?? 0) > 0) throw new Error("love_loop_cancel_incomplete");
  const now = new Date().toISOString();
  await env.DB.prepare(`update creative_love_loop_drops set status = 'cancelled', error = ?, updated_at = ?
    where owner_id = ? and loop_id = ? and status = 'queued' and job_id is null`)
    .bind(error, now, ownerId, loopId).run();
}

export async function pauseLoveLoop(env: Env, ownerId: string) {
  const current = await loopRowForOwner(env, ownerId);
  if (!current) throw new Error("love_loop_not_found");
  if (current.status === "paused") return publicLoop(current, await dropRows(env, ownerId, current.id));
  if (current.status === "disabled") throw new Error("love_loop_not_resumable");
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`update creative_love_loops set status = 'paused', last_error = null, updated_at = ?
    where id = ? and owner_id = ? and status in ('active', 'needs-attention')`)
    .bind(now, current.id, ownerId).run();
  if (!changed.meta.changes) throw new Error("love_loop_not_pauseable");
  await cancelQueuedDrops(env, ownerId, current.id, "love_loop_paused");
  return loveLoopForOwner(env, ownerId) as Promise<LoveLoop>;
}

export async function resumeLoveLoop(env: Env, ownerId: string) {
  const current = await loopRowForOwner(env, ownerId);
  if (!current) throw new Error("love_loop_not_found");
  if (current.status === "active") return publicLoop(current, await dropRows(env, ownerId, current.id));
  if (current.lastError === "love_loop_reconfiguring") throw new Error("love_loop_not_resumable");
  if (current.status !== "paused") throw new Error("love_loop_not_resumable");
  const selections = storedJson<LoveLoopWorkflowSelection[]>(current.workflowSelectionsJson, []);
  await validatedDna(env, ownerId, current.projectId, current.dnaArtifactId);
  await validatedWorkflowSelections(env, ownerId, current.projectId, selections.map((selection) => ({
    modality: selection.modality,
    recipeId: selection.recipeId,
    workflowId: selection.workflowId,
    workflowRevisionId: selection.workflowRevisionId,
  })));
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`update creative_love_loops set status = 'active', last_error = null, updated_at = ?
    where id = ? and owner_id = ? and status = 'paused'`)
    .bind(now, current.id, ownerId).run();
  if (!changed.meta.changes) throw new Error("love_loop_not_resumable");
  const row = await loopRowForOwner(env, ownerId);
  if (!row) throw new Error("love_loop_not_found");
  await insertCurrentDay(env, ownerId, row);
  return loveLoopForOwner(env, ownerId) as Promise<LoveLoop>;
}

export async function disableLoveLoop(env: Env, ownerId: string) {
  const current = await loopRowForOwner(env, ownerId);
  if (!current) throw new Error("love_loop_not_found");
  if (current.status === "disabled") return publicLoop(current, await dropRows(env, ownerId, current.id));
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`update creative_love_loops set status = 'disabled', last_error = null, updated_at = ?
    where id = ? and owner_id = ? and status in ('active', 'paused', 'needs-attention')`)
    .bind(now, current.id, ownerId).run();
  if (!changed.meta.changes) throw new Error("love_loop_not_pauseable");
  await cancelQueuedDrops(env, ownerId, current.id, "love_loop_disabled");
  await env.DB.prepare(`update creative_love_loop_drops set status = 'skipped', error = 'love_loop_disabled', updated_at = ?
    where owner_id = ? and loop_id = ? and status = 'planned'`)
    .bind(now, ownerId, current.id).run();
  return loveLoopForOwner(env, ownerId) as Promise<LoveLoop>;
}

async function syncDropJobs(env: Env, ownerId: string, loopId: string, failureWindowStart: string) {
  const rows = await dropRows(env, ownerId, loopId, 100);
  const now = new Date().toISOString();
  for (const row of rows) {
    if (!row.jobId || !row.jobStatus) continue;
    const nextStatus = row.jobStatus as LoveLoopDropStatus;
    const artifactId = row.jobArtifactId ?? row.artifactId;
    const error = row.jobError ?? row.error;
    if (row.status === nextStatus && row.artifactId === artifactId && row.error === error) continue;
    await env.DB.prepare(`update creative_love_loop_drops set status = ?, artifact_id = ?, error = ?, updated_at = ?
      where id = ? and owner_id = ?`).bind(nextStatus, artifactId, error, now, row.id, ownerId).run();
  }
  const terminal = (await dropRows(env, ownerId, loopId, 20))
    .filter((row) => ["completed", "failed"].includes(dropStatus(row)) && row.updatedAt > failureWindowStart)
    .slice(0, 3);
  if (terminal.length === 3 && terminal.every((row) => dropStatus(row) === "failed")) {
    await env.DB.prepare(`update creative_love_loops set status = 'needs-attention', last_error = 'love_loop_failure_limit_reached', updated_at = ?
      where id = ? and owner_id = ? and status = 'active'`).bind(now, loopId, ownerId).run();
  }
}

async function materializeDrop(env: Env, ownerId: string, loop: LoveLoopRow, drop: LoveLoopDropRow) {
  const current = await loopRowForOwner(env, ownerId);
  if (!current || current.id !== loop.id || current.status !== "active") throw new Error("love_loop_not_active");
  const selection = storedJson<LoveLoopWorkflowSelection[]>(loop.workflowSelectionsJson, [])
    .find((item) => item.modality === drop.modality);
  if (!selection || selection.workflowId !== drop.workflowId || selection.workflowRevisionId !== drop.workflowRevisionId) {
    throw new Error("love_loop_workflow_changed");
  }
  const recipe = drop.recipeId ? await generationRecipeById(env, ownerId, drop.recipeId) : null;
  if (drop.recipeId && (!recipe || recipe.archivedAt || recipe.updatedAt !== drop.recipeUpdatedAt
    || recipe.workflowId !== drop.workflowId || recipe.workflowRevisionId !== drop.workflowRevisionId
    || recipe.sourceKinds.length !== 1 || recipe.sourceKinds[0] !== "prompt")) throw new Error("love_loop_recipe_changed");
  const base = await workflowExecutionPlan(env, ownerId, drop.workflowId, drop.workflowRevisionId);
  if (base.workflow.projectId !== loop.projectId || workflowModality(base.workflow.modality) !== drop.modality
    || base.workflow.currentRevision.parameters.some((parameter) => parameter.kind === "media")) {
    throw new Error("love_loop_workflow_changed");
  }
  let prompt = assertLoveLoopPromptPolicy(drop.prompt);
  let videoSpeech: GenerationSettingsStamp["videoSpeech"];
  const parameters = effectiveParameters(base.workflow.currentRevision.parameters, recipe?.parameters ?? null);
  if (drop.modality === "video") {
    const profile = videoWorkflowPromptProfile({ ...base.workflow, currentRevision: { ...base.workflow.currentRevision, parameters } }, "text-to-video");
    const duration = normalizeVideoDurationSeconds(selection.videoDurationSeconds);
    if (!duration) throw new Error("love_loop_fast_video_required");
    const compiled = compileVideoPromptWithSpeech(loveLoopVideoPromptForProfile(prompt, profile.outputFormat, duration), { mode: "no-speech" }, profile);
    prompt = compiled.prompt;
    videoSpeech = compiled.speech;
  }
  const values: Record<string, WorkflowScalar> = Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter.value]));
  for (const parameter of generationWorkflowPromptParameters(parameters)) values[parameter.id] = prompt;
  for (const parameter of generationControlSet(parameters).seed) values[parameter.id] = drop.seed;
  const workflow = await createAutomationWorkflowRevision(env, ownerId, base.workflow.id, {
    baseRevisionId: base.workflow.currentRevision.id,
    values,
  });
  const parameterValues = Object.fromEntries(workflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value]));
  if (drop.modality === "image" && assessImagePerformance(parameterValues).requiresExplicitCustom) {
    throw new Error("love_loop_fast_image_required");
  }
  let videoDurationSeconds: GenerationSettingsStamp["videoDurationSeconds"];
  let videoPerformance: GenerationSettingsStamp["videoPerformance"];
  if (drop.modality === "video") {
    videoDurationSeconds = normalizeVideoDurationSeconds(selection.videoDurationSeconds) ?? undefined;
    if (!videoDurationSeconds) throw new Error("love_loop_fast_video_required");
    const assessment = assessVideoPerformance({
      parameters: canonicalGenerationPerformanceParameters(workflow.currentRevision.parameters),
      models: workflow.currentRevision.models,
      inputAssetIds: [],
      inputArtifactIds: [],
      prompt,
      videoDurationSeconds,
    });
    if (assessment.requiresExplicitHeavy) throw new Error("love_loop_fast_video_required");
    videoPerformance = {
      schemaVersion: "creative-studio-video-performance/1.0",
      mode: "fast-default",
      workflowRevisionId: workflow.currentRevision.id,
      workload: { ...assessment.workload, requiresExplicitHeavy: false, reasons: [] },
    };
  }
  const dna = await validatedDna(env, ownerId, loop.projectId, loop.dnaArtifactId);
  const createdAt = new Date().toISOString();
  const settingsStamp: GenerationSettingsStamp = {
    schemaVersion: 1,
    source: "comfyui-workflow",
    createdAt,
    reusedFromJobId: null,
    prompt,
    provider: "local-comfyui",
    modality: drop.modality,
    performanceMode: drop.modality === "image" ? "fast-default" : undefined,
    videoPerformance,
    videoDurationSeconds,
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
    videoSpeech,
    loveLoop: {
      schemaVersion: LOVE_LOOP_GENERATION_SCHEMA_VERSION,
      loopId: loop.id,
      dropId: drop.id,
      localDate: drop.localDate,
      ordinal: Math.max(1, Math.min(3, Number(drop.ordinal))) as 1 | 2 | 3,
      scheduledFor: drop.scheduledFor,
      title: drop.title,
      conceptId: drop.conceptId,
      seed: Number(drop.seed),
      scheduleVersion: LOVE_LOOP_SCHEDULE_VERSION,
      promptPolicyVersion: LOVE_LOOP_PROMPT_POLICY_VERSION,
      privacyMode: "symbolic-roles",
      subjectRole: "owner-artist",
      relationshipRole: "husband",
      likenessMode: "none",
      dnaArtifactId: loop.dnaArtifactId,
      recipeId: drop.recipeId,
      recipeUpdatedAt: drop.recipeUpdatedAt,
    },
  };
  const created = await createQueuedJob(env, ownerId, {
    projectId: loop.projectId,
    dna,
    modality: drop.modality,
    // Stable during one active configuration so crash recovery relinks the same
    // job; renewed after an explicit repair so a cancelled old attempt stays dead.
    idempotencyKey: `love_${loop.id}_${drop.localDate}_${drop.ordinal}_${loop.updatedAt.replace(/\D/g, "").slice(0, 17)}`.slice(0, 100),
    reconcileEmail: null,
    provider: "local-comfyui",
    promptOverride: prompt,
    settingsStampOverride: settingsStamp,
    executionTarget: "local-comfyui",
    workflowId: workflow.id,
    workflowRevisionId: workflow.currentRevision.id,
    priority: 5,
  });
  const linked = await env.DB.prepare(`update creative_love_loop_drops set job_id = ?,
    status = 'queued', error = null, updated_at = ? where id = ? and owner_id = ? and status = 'queued' and job_id is null`)
    .bind(created.job.id, createdAt, drop.id, ownerId).run();
  const stillActive = await env.DB.prepare(`select id from creative_love_loops where id = ? and owner_id = ? and status = 'active'`)
    .bind(loop.id, ownerId).first<{ id: string }>();
  if (!linked.meta.changes || !stillActive) {
    await cancelOwnedJob(env, ownerId, created.job.id).catch(() => undefined);
    throw new Error("love_loop_not_active");
  }
}

async function reconcileLoop(env: Env, ownerId: string, row: LoveLoopRow, now = new Date()) {
  if (row.status !== "active") return;
  const nowValue = now.toISOString();
  const localDate = await insertCurrentDay(env, ownerId, row, now);
  await syncDropJobs(env, ownerId, row.id, row.updatedAt);
  const current = await loopRowForOwner(env, ownerId);
  if (!current || current.status !== "active") return;
  const recoveryBefore = new Date(now.getTime() - MATERIALIZATION_RECOVERY_MS).toISOString();
  await env.DB.prepare(`update creative_love_loop_drops set status = 'planned', error = null, updated_at = ?
    where owner_id = ? and loop_id = ? and status = 'queued' and job_id is null and updated_at <= ?`)
    .bind(nowValue, ownerId, row.id, recoveryBefore).run();
  await env.DB.prepare(`update creative_love_loop_drops set status = 'skipped', error = 'love_loop_window_missed', updated_at = ?
    where owner_id = ? and loop_id = ? and status = 'planned'
      and (local_date < ? or scheduled_for < ?)`)
    .bind(nowValue, ownerId, row.id, localDate, new Date(now.getTime() - MISSED_WINDOW_GRACE_MS).toISOString()).run();
  const rows = await dropRows(env, ownerId, row.id, 100);
  if (rows.some((drop) => dropStatus(drop) === "queued" || dropStatus(drop) === "running")) return;
  const next = rows
    .filter((drop) => drop.localDate === localDate && drop.status === "planned" && Date.parse(drop.scheduledFor) <= now.getTime())
    .sort((left, right) => Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor))[0];
  if (!next) return;
  const reserved = await env.DB.prepare(`update creative_love_loop_drops set status = 'queued', error = null, updated_at = ?
    where id = ? and owner_id = ? and status = 'planned' and scheduled_for <= ?
      and exists (select 1 from creative_love_loops l where l.id = creative_love_loop_drops.loop_id
        and l.owner_id = creative_love_loop_drops.owner_id and l.status = 'active')`)
    .bind(nowValue, next.id, ownerId, nowValue).run();
  if (!reserved.meta.changes) return;
  try {
    await materializeDrop(env, ownerId, current, { ...next, status: "queued", updatedAt: nowValue });
  } catch (caught) {
    const error = boundedText(caught instanceof Error ? caught.message : "love_loop_materialization_failed", 500);
    await env.DB.batch([
      env.DB.prepare(`update creative_love_loop_drops set status = 'failed', error = ?, updated_at = ?
        where id = ? and owner_id = ? and job_id is null`).bind(error, new Date().toISOString(), next.id, ownerId),
      env.DB.prepare(`update creative_love_loops set status = 'needs-attention', last_error = ?, updated_at = ?
        where id = ? and owner_id = ? and status = 'active'`).bind(error, new Date().toISOString(), row.id, ownerId),
    ]);
  }
}

/** Uses the existing Local Runner claim cadence. It adds no browser timer, cron, Queue, or AFDFW request. */
export async function reconcileLoveLoops(env: Env, ownerId: string) {
  const row = await loopRowForOwner(env, ownerId);
  if (row) await reconcileLoop(env, ownerId, row);
}
