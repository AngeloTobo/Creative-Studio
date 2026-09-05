import type {
  CompleteModelTrainingDatasetRequest,
  CompleteModelTrainingJobRequest,
  CreateModelTrainingJobRequest,
  GenerationModelAdapterBinding,
  ModelAdapter,
  ModelAdapterEvaluation,
  ModelAdapterReview,
  ModelAdapterReviewDecision,
  ModelTrainingDataset,
  ModelTrainingDatasetItem,
  ModelTrainingJob,
  ModelTrainingProvider,
  ModelTrainingStage,
  ReviewModelTrainingDatasetRequest,
} from "../shared/contracts";
import {
  MODEL_ADAPTER_SCHEMA_VERSION,
  modelTrainingRecipe,
  normalizeAdapterStrength,
  normalizeModelTrainingConcept,
} from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import { listLocalDna, listMediaAssets, projectById } from "./repository";
import type { RunnerIdentity } from "./runner";
import type { Env } from "./types";

type JobRow = {
  id: string;
  projectId: string;
  dnaArtifactId: string | null;
  adapterId: string | null;
  name: string;
  target: ModelTrainingJob["target"];
  provider: ModelTrainingJob["provider"];
  conceptJson: string;
  recipeJson: string;
  assetIdsJson: string;
  instrumental: number;
  datasetJson: string | null;
  status: ModelTrainingJob["status"];
  stage: ModelTrainingJob["stage"];
  progress: number;
  runnerId: string | null;
  runnerLeaseUntil: string | null;
  upstreamId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type AdapterRow = {
  id: string;
  projectId: string;
  dnaArtifactId: string | null;
  trainingJobId: string;
  name: string;
  target: ModelAdapter["target"];
  provider: ModelAdapter["provider"];
  status: ModelAdapter["status"];
  conceptJson: string;
  recipeJson: string;
  localFileJson: string;
  evaluationJson: string;
  recommendedStrength: number;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
};

type ReviewRow = Omit<ModelAdapterReview, "actor"> & { actor: ModelAdapterReview["actor"] };

const JOB_COLUMNS = `id, project_id as projectId, dna_artifact_id as dnaArtifactId, adapter_id as adapterId,
  name, target, provider, concept_json as conceptJson, recipe_json as recipeJson, asset_ids_json as assetIdsJson,
  instrumental, dataset_json as datasetJson, status, stage, progress, runner_id as runnerId,
  runner_lease_until as runnerLeaseUntil, upstream_id as upstreamId, error, created_at as createdAt,
  updated_at as updatedAt, started_at as startedAt, completed_at as completedAt`;

const ADAPTER_COLUMNS = `id, project_id as projectId, dna_artifact_id as dnaArtifactId,
  training_job_id as trainingJobId, name, target, provider, status, concept_json as conceptJson,
  recipe_json as recipeJson, local_file_json as localFileJson, evaluation_json as evaluationJson,
  recommended_strength as recommendedStrength, created_at as createdAt, updated_at as updatedAt,
  activated_at as activatedAt`;

const REVIEW_COLUMNS = `id, project_id as projectId, training_job_id as trainingJobId,
  adapter_id as adapterId, decision, note, actor, created_at as createdAt`;

function parse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mapJob(row: JobRow): ModelTrainingJob {
  return {
    id: row.id,
    projectId: row.projectId,
    dnaArtifactId: row.dnaArtifactId,
    adapterId: row.adapterId,
    name: row.name,
    target: row.target,
    provider: row.provider,
    concept: parse(row.conceptJson, normalizeModelTrainingConcept({ target: "music-style", name: row.name, triggerToken: "missing_trigger", description: "Legacy ACE-Step training concept requires review before it can be used.", continuityRules: [] })),
    recipe: parse(row.recipeJson, modelTrainingRecipe("music-style", "proof")),
    assetIds: parse(row.assetIdsJson, [] as string[]),
    instrumental: Boolean(row.instrumental),
    dataset: parse<ModelTrainingDataset | null>(row.datasetJson, null),
    status: row.status,
    stage: row.stage,
    progress: Number(row.progress || 0),
    runnerId: row.runnerId,
    upstreamId: row.upstreamId,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function mapAdapter(row: AdapterRow): ModelAdapter {
  return {
    schemaVersion: MODEL_ADAPTER_SCHEMA_VERSION,
    id: row.id,
    projectId: row.projectId,
    dnaArtifactId: row.dnaArtifactId,
    trainingJobId: row.trainingJobId,
    name: row.name,
    target: row.target,
    provider: row.provider,
    status: row.status,
    concept: parse(row.conceptJson, null as never),
    recipe: parse(row.recipeJson, null as never),
    localFile: parse(row.localFileJson, null as never),
    evaluation: parse(row.evaluationJson, null as never),
    recommendedStrength: normalizeAdapterStrength(row.recommendedStrength),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    activatedAt: row.activatedAt,
  };
}

async function jobRow(env: Env, ownerId: string, jobId: string) {
  return env.DB.prepare(`select ${JOB_COLUMNS} from creative_model_training_jobs where id = ? and owner_id = ?`)
    .bind(jobId, ownerId).first<JobRow>();
}

async function adapterRow(env: Env, ownerId: string, adapterId: string) {
  return env.DB.prepare(`select ${ADAPTER_COLUMNS} from creative_model_adapters where id = ? and owner_id = ?`)
    .bind(adapterId, ownerId).first<AdapterRow>();
}

export async function listModelTrainingJobs(env: Env, ownerId: string) {
  const result = await env.DB.prepare(`select ${JOB_COLUMNS} from creative_model_training_jobs where owner_id = ? order by created_at desc limit 100`)
    .bind(ownerId).all<JobRow>();
  return (result.results ?? []).map(mapJob);
}

export async function listModelAdapters(env: Env, ownerId: string) {
  const result = await env.DB.prepare(`select ${ADAPTER_COLUMNS} from creative_model_adapters where owner_id = ? order by created_at desc limit 100`)
    .bind(ownerId).all<AdapterRow>();
  return (result.results ?? []).map(mapAdapter);
}

export async function listModelAdapterReviews(env: Env, ownerId: string) {
  const result = await env.DB.prepare(`select ${REVIEW_COLUMNS} from creative_model_adapter_reviews where owner_id = ? order by created_at desc limit 200`)
    .bind(ownerId).all<ReviewRow>();
  return (result.results ?? []) as ModelAdapterReview[];
}

export async function createModelTrainingJob(env: Env, ownerId: string, input: CreateModelTrainingJobRequest) {
  const project = await projectById(env, ownerId, boundedText(input.projectId, 100));
  if (!project) throw new Error("project_not_found");
  if (project.status === "archived") throw new Error("project_archived");
  const concept = normalizeModelTrainingConcept(input);
  const recipe = modelTrainingRecipe(concept.target, input.preset);
  const assetIds = [...new Set((input.assetIds ?? []).map((assetId) => boundedText(assetId, 100)).filter(Boolean))];
  if (assetIds.length < recipe.dataset.minimumItems) throw new Error(concept.target === "image-style" ? `image_training_requires_${recipe.dataset.minimumItems}_images` : `ace_step_requires_${recipe.dataset.minimumItems}_audio_files`);
  if (assetIds.length > 40) throw new Error("too_many_model_training_assets");
  const assets = (await listMediaAssets(env, ownerId)).filter((asset) => assetIds.includes(asset.id));
  if (assets.length !== assetIds.length) throw new Error("model_training_asset_not_found");
  if (assets.some((asset) => asset.projectId !== project.id || !recipe.dataset.acceptedKinds.includes(asset.kind) || !asset.trainingEligible)) {
    throw new Error("model_training_source_consent_required");
  }
  const dnaArtifactId = boundedText(input.dnaArtifactId, 100) || project.activeDnaArtifactId;
  if (dnaArtifactId) {
    const dna = (await listLocalDna(env, ownerId)).find((artifact) => artifact.artifactId === dnaArtifactId && artifact.projectId === project.id);
    if (!dna) throw new Error("creative_dna_not_found");
  }
  const idempotencyKey = boundedText(input.idempotencyKey, 140);
  if (!idempotencyKey) throw new Error("idempotency_key_required");
  const existing = await env.DB.prepare(`select ${JOB_COLUMNS} from creative_model_training_jobs where owner_id = ? and idempotency_key = ?`)
    .bind(ownerId, idempotencyKey).first<JobRow>();
  if (existing) return mapJob(existing);
  const jobId = id("modeltrain");
  const now = new Date().toISOString();
  await env.DB.prepare(`insert into creative_model_training_jobs (
    id, owner_id, project_id, dna_artifact_id, name, target, provider, concept_json, recipe_json,
    asset_ids_json, instrumental, status, stage, progress, idempotency_key, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting-for-runner', 'queued', 0, ?, ?, ?)`)
    .bind(jobId, ownerId, project.id, dnaArtifactId, concept.name, concept.target, recipe.provider,
      JSON.stringify(concept), JSON.stringify(recipe), JSON.stringify(assetIds), input.instrumental ? 1 : 0,
      idempotencyKey, now, now).run();
  return mapJob((await jobRow(env, ownerId, jobId))!);
}

function leaseUntil(now: Date) {
  return new Date(now.getTime() + 2 * 60_000).toISOString();
}

export async function claimModelTrainingJob(env: Env, runner: RunnerIdentity, providers: ModelTrainingProvider[]) {
  const supported = providers.filter((provider) => ["ace-step-1.5-lora", "comfy-sd15-lora"].includes(provider));
  if (!supported.length) return null;
  const now = new Date();
  const timestamp = now.toISOString();
  const candidate = await env.DB.prepare(`select id from creative_model_training_jobs
    where owner_id = ? and provider in (${supported.map(() => '?').join(',')}) and status in ('waiting-for-runner', 'running')
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)
    order by case when runner_id = ? then 0 else 1 end, created_at limit 1`)
    .bind(runner.ownerId, ...supported, timestamp, runner.id, runner.id).first<{ id: string }>();
  if (!candidate) return null;
  const changed = await env.DB.prepare(`update creative_model_training_jobs set status = 'running',
    stage = case when stage = 'queued' then 'captioning' else 'preflight' end,
    progress = max(progress, case when stage = 'queued' then 5 else 30 end), runner_id = ?, runner_lease_until = ?,
    started_at = coalesce(started_at, ?), updated_at = ?, error = null
    where id = ? and owner_id = ? and status in ('waiting-for-runner', 'running')
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)`)
    .bind(runner.id, leaseUntil(now), timestamp, timestamp, candidate.id, runner.ownerId, timestamp, runner.id).run();
  if (!changed.meta.changes) return null;
  await env.DB.prepare("update creative_runners set active_job_id = ?, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
    .bind(candidate.id, timestamp, runner.id, runner.ownerId).run();
  const job = mapJob((await jobRow(env, runner.ownerId, candidate.id))!);
  const assets = (await listMediaAssets(env, runner.ownerId)).filter((asset) => job.assetIds.includes(asset.id));
  const dna = job.dnaArtifactId ? (await listLocalDna(env, runner.ownerId)).find((artifact) => artifact.artifactId === job.dnaArtifactId) ?? null : null;
  return { modelTrainingJob: job, assets, dna };
}

const RUNNING_STAGES = new Set<ModelTrainingStage>(["captioning", "preflight", "preprocessing", "training", "retaining"]);

export async function heartbeatModelTrainingJob(env: Env, runner: RunnerIdentity, jobId: string, progressValue: unknown, stageValue: unknown, upstreamValue?: unknown) {
  const stage = stageValue as ModelTrainingStage;
  if (!RUNNING_STAGES.has(stage)) throw new Error("invalid_model_training_stage");
  const progress = Math.max(5, Math.min(94, Math.round(Number(progressValue) || 5)));
  const upstreamId = boundedText(upstreamValue, 160) || null;
  const now = new Date();
  const [changed] = await env.DB.batch([
    env.DB.prepare(`update creative_model_training_jobs set progress = max(progress, ?), stage = ?,
      upstream_id = coalesce(?, upstream_id), runner_lease_until = ?, updated_at = ?
      where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(progress, stage, upstreamId, leaseUntil(now), now.toISOString(), jobId, runner.ownerId, runner.id),
    env.DB.prepare("update creative_runners set active_job_id = ?, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
      .bind(jobId, now.toISOString(), runner.id, runner.ownerId),
  ]);
  const row = await jobRow(env, runner.ownerId, jobId);
  if (!row) throw new Error("model_training_job_not_found");
  return { continue: Boolean(changed.meta.changes), modelTrainingJob: mapJob(row) };
}

function cleanDatasetItem(value: ModelTrainingDatasetItem, assetIds: string[]): ModelTrainingDatasetItem {
  const assetId = boundedText(value.assetId, 100);
  if (!assetIds.includes(assetId)) throw new Error("invalid_model_training_dataset");
  const caption = boundedText(value.caption, 1_200);
  if (caption.length < 20) throw new Error("ace_step_caption_required");
  const isInstrumental = Boolean(value.isInstrumental);
  const lyrics = isInstrumental ? "[Instrumental]" : String(value.lyrics ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 12_000);
  if (!isInstrumental && lyrics.length < 4) throw new Error("ace_step_lyrics_required");
  const reportedDuration = Number(value.durationSeconds);
  const durationSeconds = Number.isFinite(reportedDuration)
    ? Math.max(1, Math.min(240, Math.round(reportedDuration * 100) / 100))
    : 1;
  return {
    assetId,
    fileName: boundedText(value.fileName, 180),
    caption,
    lyrics,
    isInstrumental,
    durationSeconds,
    bpm: Number.isFinite(value.bpm) ? Math.max(20, Math.min(300, Math.round(Number(value.bpm)))) : null,
    keyscale: boundedText(value.keyscale, 40) || null,
    captionSource: value.captionSource === "owner-edited" ? "owner-edited" : "gemma4-audio-description",
  };
}

export async function completeModelTrainingDataset(env: Env, runner: RunnerIdentity, jobId: string, input: CompleteModelTrainingDatasetRequest) {
  const row = await jobRow(env, runner.ownerId, jobId);
  if (!row || row.runnerId !== runner.id || row.status !== "running" || row.stage !== "captioning") throw new Error("model_training_job_not_claimed");
  if (input.runnerId !== runner.id || input.dataset.schemaVersion !== (row.target === "image-style" ? "creative-studio-image-dataset/1.0" : "creative-studio-ace-step-dataset/1.0")) throw new Error("invalid_model_training_dataset");
  const job = mapJob(row);
  const items = input.dataset.items.map((item) => cleanDatasetItem(item, job.assetIds));
  if (items.length !== job.assetIds.length || new Set(items.map((item) => item.assetId)).size !== job.assetIds.length) throw new Error("invalid_model_training_dataset");
  const dataset: ModelTrainingDataset = {
    schemaVersion: input.dataset.schemaVersion,
    items,
    preparedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewNote: null,
  };
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`update creative_model_training_jobs set dataset_json = ?, status = 'waiting-for-review',
      stage = 'dataset-review', progress = 25, runner_lease_until = null, updated_at = ?
      where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(JSON.stringify(dataset), now, jobId, runner.ownerId, runner.id),
    env.DB.prepare("update creative_runners set active_job_id = null, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
      .bind(now, runner.id, runner.ownerId),
  ]);
  return mapJob((await jobRow(env, runner.ownerId, jobId))!);
}

export async function reviewModelTrainingDataset(env: Env, ownerId: string, jobId: string, input: ReviewModelTrainingDatasetRequest) {
  const row = await jobRow(env, ownerId, jobId);
  if (!row) throw new Error("model_training_job_not_found");
  const job = mapJob(row);
  if (job.status !== "waiting-for-review" || job.stage !== "dataset-review" || !job.dataset) throw new Error("model_training_dataset_not_ready");
  const note = boundedText(input.note, 500);
  if (!note) throw new Error("model_training_dataset_review_note_required");
  const current = new Map(job.dataset.items.map((item) => [item.assetId, item]));
  const items = input.items.map((item) => {
    const prior = current.get(boundedText(item.assetId, 100));
    if (!prior) throw new Error("invalid_model_training_dataset");
    return cleanDatasetItem({ ...prior, ...item, captionSource: item.caption === prior.caption ? prior.captionSource : "owner-edited" }, job.assetIds);
  });
  if (items.length !== job.assetIds.length || new Set(items.map((item) => item.assetId)).size !== job.assetIds.length) throw new Error("invalid_model_training_dataset");
  const now = new Date().toISOString();
  const dataset: ModelTrainingDataset = { ...job.dataset, items, reviewedAt: now, reviewNote: note };
  await env.DB.prepare(`update creative_model_training_jobs set dataset_json = ?, status = 'waiting-for-runner',
    stage = 'preflight', progress = 28, runner_id = null, error = null, updated_at = ? where id = ? and owner_id = ?`)
    .bind(JSON.stringify(dataset), now, jobId, ownerId).run();
  return mapJob((await jobRow(env, ownerId, jobId))!);
}

function safeEvaluation(value: ModelAdapterEvaluation, datasetItems: number): ModelAdapterEvaluation {
  const notes = [...new Set((value.notes ?? []).map((note) => boundedText(note, 240)).filter(Boolean))].slice(0, 12);
  return {
    schemaVersion: "creative-studio-model-adapter-evaluation/1.0",
    datasetItems,
    captionedItems: Math.max(0, Math.min(datasetItems, Math.round(Number(value.captionedItems) || 0))),
    validationPromptCount: Math.max(0, Math.min(12, Math.round(Number(value.validationPromptCount) || 0))),
    notes,
  };
}

export async function completeModelTrainingJob(env: Env, runner: RunnerIdentity, jobId: string, input: CompleteModelTrainingJobRequest) {
  const row = await jobRow(env, runner.ownerId, jobId);
  if (!row || row.runnerId !== runner.id || row.status !== "running" || !row.datasetJson) throw new Error("model_training_job_not_claimed");
  if (input.runnerId !== runner.id) throw new Error("model_training_runner_mismatch");
  const job = mapJob(row);
  const relativePath = String(input.localFile.relativePath ?? "").replaceAll("\\", "/");
  if (!/^creative-studio\/[a-z0-9_/-]+\/adapter_model\.safetensors$/i.test(relativePath) || relativePath.includes("..")) throw new Error("invalid_model_adapter_path");
  if (input.localFile.runnerId !== runner.id || input.localFile.format !== "safetensors" || !/^[a-f0-9]{64}$/i.test(input.localFile.sha256)
    || !Number.isFinite(input.localFile.size) || input.localFile.size <= 0 || input.localFile.size > 2_000_000_000) throw new Error("invalid_model_adapter_file");
  const adapterId = id("adapter");
  const now = new Date().toISOString();
  const localFile = { ...input.localFile, relativePath, size: Math.round(input.localFile.size) };
  const evaluation = safeEvaluation(input.evaluation, job.dataset!.items.length);
  await env.DB.batch([
    env.DB.prepare(`insert into creative_model_adapters (
      id, owner_id, project_id, dna_artifact_id, training_job_id, name, target, provider, status,
      concept_json, recipe_json, local_file_json, evaluation_json, recommended_strength,
      created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, 'review-required', ?, ?, ?, ?, 0.8, ?, ?)`)
      .bind(adapterId, runner.ownerId, job.projectId, job.dnaArtifactId, job.id, job.name, job.target, job.provider,
        JSON.stringify(job.concept), JSON.stringify(job.recipe), JSON.stringify(localFile), JSON.stringify(evaluation), now, now),
    env.DB.prepare(`update creative_model_training_jobs set adapter_id = ?, status = 'completed', stage = 'adapter-review',
      progress = 100, upstream_id = ?, runner_lease_until = null, updated_at = ?, completed_at = ?
      where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(adapterId, boundedText(input.upstreamId, 160), now, now, job.id, runner.ownerId, runner.id),
    env.DB.prepare("update creative_runners set active_job_id = null, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
      .bind(now, runner.id, runner.ownerId),
  ]);
  return { modelTrainingJob: mapJob((await jobRow(env, runner.ownerId, job.id))!), adapter: mapAdapter((await adapterRow(env, runner.ownerId, adapterId))!) };
}

export async function failModelTrainingJob(env: Env, runner: RunnerIdentity, jobId: string, errorValue: unknown) {
  const error = boundedText(errorValue, 500) || "ace_step_training_failed";
  const now = new Date().toISOString();
  const [changed] = await env.DB.batch([
    env.DB.prepare(`update creative_model_training_jobs set status = 'failed', stage = 'failed', error = ?,
      runner_lease_until = null, updated_at = ?, completed_at = ?
      where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
      .bind(error, now, now, jobId, runner.ownerId, runner.id),
    env.DB.prepare("update creative_runners set active_job_id = null, last_error = ?, last_heartbeat_at = ? where id = ? and owner_id = ?")
      .bind(error, now, runner.id, runner.ownerId),
  ]);
  if (!changed.meta.changes) throw new Error("model_training_job_not_claimed");
  return mapJob((await jobRow(env, runner.ownerId, jobId))!);
}

export async function cancelModelTrainingJob(env: Env, ownerId: string, jobId: string) {
  const now = new Date().toISOString();
  const [changed] = await env.DB.batch([
    env.DB.prepare(`update creative_model_training_jobs set status = 'cancelled', stage = 'cancelled',
      error = 'cancelled_by_user', runner_lease_until = null, updated_at = ?, completed_at = ?
      where id = ? and owner_id = ? and status in ('waiting-for-runner', 'waiting-for-review', 'running')`)
      .bind(now, now, jobId, ownerId),
    env.DB.prepare("update creative_runners set active_job_id = null where owner_id = ? and active_job_id = ?")
      .bind(ownerId, jobId),
  ]);
  if (!changed.meta.changes) throw new Error("model_training_job_not_cancellable");
  return mapJob((await jobRow(env, ownerId, jobId))!);
}

export async function reviewModelAdapter(env: Env, ownerId: string, adapterId: string, decision: ModelAdapterReviewDecision, noteValue: unknown, actor: ModelAdapterReview["actor"]) {
  if (decision !== "approved" && decision !== "rejected") throw new Error("invalid_model_adapter_review");
  const note = boundedText(noteValue, 500);
  if (!note) throw new Error("model_adapter_review_note_required");
  const row = await adapterRow(env, ownerId, adapterId);
  if (!row) throw new Error("model_adapter_not_found");
  const adapter = mapAdapter(row);
  if (adapter.status !== "review-required") throw new Error("model_adapter_already_reviewed");
  const job = await jobRow(env, ownerId, adapter.trainingJobId);
  if (!job) throw new Error("model_training_job_not_found");
  const now = new Date().toISOString();
  const review: ModelAdapterReview = { id: id("adapterreview"), projectId: adapter.projectId, trainingJobId: adapter.trainingJobId, adapterId, decision, note, actor, createdAt: now };
  const statements = [];
  if (decision === "approved") {
    statements.push(env.DB.prepare(`update creative_model_adapters set status = 'inactive', updated_at = ?
      where owner_id = ? and project_id = ? and target = ? and status = 'active' and id != ?`)
      .bind(now, ownerId, adapter.projectId, adapter.target, adapterId));
  }
  statements.push(
    env.DB.prepare(`update creative_model_adapters set status = ?, dna_artifact_id = ?, activated_at = ?, updated_at = ? where id = ? and owner_id = ?`)
      .bind(decision === "approved" ? "active" : "rejected", decision === "approved" ? (await projectById(env, ownerId, adapter.projectId))?.activeDnaArtifactId ?? adapter.dnaArtifactId : adapter.dnaArtifactId,
        decision === "approved" ? now : null, now, adapterId, ownerId),
    env.DB.prepare(`update creative_model_training_jobs set stage = 'completed', updated_at = ? where id = ? and owner_id = ?`)
      .bind(now, adapter.trainingJobId, ownerId),
    env.DB.prepare(`insert into creative_model_adapter_reviews (id, owner_id, project_id, training_job_id, adapter_id, decision, note, actor, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(review.id, ownerId, review.projectId, review.trainingJobId, review.adapterId, review.decision, review.note, review.actor, review.createdAt),
  );
  await env.DB.batch(statements);
  return { modelTrainingJob: mapJob((await jobRow(env, ownerId, adapter.trainingJobId))!), adapter: mapAdapter((await adapterRow(env, ownerId, adapterId))!), review };
}

export async function activeMusicAdapterBindings(env: Env, ownerId: string, projectId: string): Promise<GenerationModelAdapterBinding[]> {
  const result = await env.DB.prepare(`select ${ADAPTER_COLUMNS} from creative_model_adapters
    where owner_id = ? and project_id = ? and target = 'music-style' and status = 'active' order by activated_at desc limit 1`)
    .bind(ownerId, projectId).all<AdapterRow>();
  return (result.results ?? []).map(mapAdapter).map((adapter) => ({
    schemaVersion: "creative-studio-generation-adapter/1.0",
    adapterId: adapter.id,
    name: adapter.name,
    target: adapter.target,
    provider: adapter.provider,
    baseModelId: adapter.recipe.baseModel.id,
    triggerToken: adapter.concept.triggerToken,
    relativePath: adapter.localFile.relativePath,
    runnerId: adapter.localFile.runnerId,
    strength: adapter.recommendedStrength,
  }));
}

export async function activeImageAdapterBindings(env: Env, ownerId: string, projectId: string): Promise<GenerationModelAdapterBinding[]> {
  const result = await env.DB.prepare(`select ${ADAPTER_COLUMNS} from creative_model_adapters
    where owner_id = ? and project_id = ? and target = 'image-style' and status = 'active' order by activated_at desc limit 1`)
    .bind(ownerId, projectId).all<AdapterRow>();
  return (result.results ?? []).map(mapAdapter).map((adapter) => ({
    schemaVersion: "creative-studio-generation-adapter/1.0",
    adapterId: adapter.id,
    name: adapter.name,
    target: adapter.target,
    provider: adapter.provider,
    baseModelId: adapter.recipe.baseModel.id,
    triggerToken: adapter.concept.triggerToken,
    relativePath: adapter.localFile.relativePath,
    runnerId: adapter.localFile.runnerId,
    strength: adapter.recommendedStrength,
  }));
}
