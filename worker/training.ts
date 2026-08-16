import type {
  CompleteCreativeDnaTrainingJobRequest,
  CreateCreativeDnaTrainingJobRequest,
  CreativeDnaTrainingAnalysis,
  CreativeDnaTrainingJob,
  CreativeDnaTrainingSourceAnalysis,
  CreativeTrainingExample,
  FailCreativeDnaTrainingJobRequest,
  MediaAsset,
} from "../shared/contracts";
import { CREATIVE_DNA_DIMENSION_KEYS } from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import {
  createLocalDna,
  listLocalDna,
  listMediaAssets,
  listTrainingExamples,
  projectById,
} from "./repository";
import type { RunnerIdentity } from "./runner";
import type { Env } from "./types";

type TrainingRow = {
  id: string;
  projectId: string;
  baseDnaArtifactId: string | null;
  resultDnaArtifactId: string | null;
  name: string;
  targetModality: CreativeDnaTrainingJob["targetModality"];
  status: CreativeDnaTrainingJob["status"];
  progress: number;
  provider: CreativeDnaTrainingJob["provider"];
  assetIdsJson: string;
  trainingExampleIdsJson: string;
  runnerId: string | null;
  runnerLeaseUntil: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

const TRAINING_COLUMNS = `id, project_id as projectId, base_dna_artifact_id as baseDnaArtifactId,
  result_dna_artifact_id as resultDnaArtifactId, name, target_modality as targetModality, status,
  progress, provider, asset_ids_json as assetIdsJson, training_example_ids_json as trainingExampleIdsJson,
  runner_id as runnerId, runner_lease_until as runnerLeaseUntil, error, created_at as createdAt,
  updated_at as updatedAt, started_at as startedAt, completed_at as completedAt`;

function ids(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapTrainingJob(row: TrainingRow): CreativeDnaTrainingJob {
  const { assetIdsJson, trainingExampleIdsJson, runnerLeaseUntil: _runnerLeaseUntil, ...job } = row;
  void _runnerLeaseUntil;
  return {
    ...job,
    progress: Number(row.progress || 0),
    assetIds: ids(assetIdsJson),
    trainingExampleIds: ids(trainingExampleIdsJson),
  };
}

async function trainingRow(env: Env, ownerId: string, jobId: string) {
  return env.DB.prepare(`select ${TRAINING_COLUMNS} from creative_dna_training_jobs where id = ? and owner_id = ?`)
    .bind(jobId, ownerId).first<TrainingRow>();
}

export async function listCreativeDnaTrainingJobs(env: Env, ownerId: string) {
  const result = await env.DB.prepare(`select ${TRAINING_COLUMNS} from creative_dna_training_jobs where owner_id = ? order by created_at desc limit 100`)
    .bind(ownerId).all<TrainingRow>();
  return (result.results ?? []).map(mapTrainingJob);
}

export async function createCreativeDnaTrainingJob(
  env: Env,
  ownerId: string,
  input: CreateCreativeDnaTrainingJobRequest,
) {
  const duplicate = await env.DB.prepare(`select ${TRAINING_COLUMNS} from creative_dna_training_jobs where owner_id = ? and idempotency_key = ?`)
    .bind(ownerId, input.idempotencyKey).first<TrainingRow>();
  if (duplicate) return mapTrainingJob(duplicate);

  const project = await projectById(env, ownerId, input.projectId);
  if (!project) throw new Error("project_not_found");
  if (project.status === "archived") throw new Error("project_archived");
  if (input.targetModality !== "image" && input.targetModality !== "music") throw new Error("invalid_target_modality");

  const requestedAssetIds = [...new Set(input.assetIds.map((value) => boundedText(value, 80)).filter(Boolean))];
  if (requestedAssetIds.length > 48) throw new Error("too_many_training_assets");
  const allAssets = await listMediaAssets(env, ownerId);
  const selectedAssets = requestedAssetIds.map((assetId) => allAssets.find((asset) => asset.id === assetId));
  if (selectedAssets.some((asset) => !asset)) throw new Error("training_asset_not_found");
  if (selectedAssets.some((asset) => asset?.projectId !== input.projectId)) throw new Error("training_asset_project_mismatch");
  if (selectedAssets.some((asset) => !asset?.trainingEligible)) throw new Error("training_consent_required");

  const dna = await listLocalDna(env, ownerId);
  const base = input.baseDnaArtifactId ? dna.find((artifact) => artifact.artifactId === input.baseDnaArtifactId) : null;
  if (input.baseDnaArtifactId && !base) throw new Error("creative_dna_not_found");
  if (base && base.projectId !== input.projectId) throw new Error("dna_project_mismatch");

  const trainingExamples = input.includeTrainingExamples
    ? (await listTrainingExamples(env, ownerId)).filter((example) => example.projectId === input.projectId && example.status === "training-ready")
    : [];
  if (!requestedAssetIds.length && !trainingExamples.length) throw new Error("training_inputs_required");

  const now = new Date().toISOString();
  const jobId = id("dnatraining");
  const name = boundedText(input.name, 80) || `${project.name} CreativeDNA`;
  await env.DB.prepare(`insert into creative_dna_training_jobs (
    id, owner_id, project_id, base_dna_artifact_id, result_dna_artifact_id, name, target_modality,
    status, progress, provider, asset_ids_json, training_example_ids_json, idempotency_key,
    runner_id, runner_lease_until, error, created_at, updated_at, started_at, completed_at
  ) values (?, ?, ?, ?, null, ?, ?, 'waiting-for-runner', 0, 'local-creative-dna-runner', ?, ?, ?, null, null, null, ?, ?, null, null)`)
    .bind(jobId, ownerId, input.projectId, base?.artifactId ?? null, name, input.targetModality,
      JSON.stringify(requestedAssetIds), JSON.stringify(trainingExamples.map((example) => example.id)), input.idempotencyKey, now, now).run();
  const created = await trainingRow(env, ownerId, jobId);
  if (!created) throw new Error("training_job_not_found");
  return mapTrainingJob(created);
}

export async function creativeDnaTrainingBundle(env: Env, ownerId: string, jobId: string) {
  const row = await trainingRow(env, ownerId, jobId);
  if (!row) throw new Error("training_job_not_found");
  const trainingJob = mapTrainingJob(row);
  const [allDna, allAssets, allExamples] = await Promise.all([
    listLocalDna(env, ownerId), listMediaAssets(env, ownerId), listTrainingExamples(env, ownerId),
  ]);
  return {
    trainingJob,
    baseDna: trainingJob.baseDnaArtifactId ? allDna.find((artifact) => artifact.artifactId === trainingJob.baseDnaArtifactId) ?? null : null,
    assets: trainingJob.assetIds.map((assetId) => allAssets.find((asset) => asset.id === assetId)).filter((asset): asset is MediaAsset => Boolean(asset)),
    trainingExamples: trainingJob.trainingExampleIds.map((exampleId) => allExamples.find((example) => example.id === exampleId)).filter((example): example is CreativeTrainingExample => Boolean(example)),
  };
}

function runnerId(value: unknown) {
  const runner = boundedText(value, 120);
  if (!/^[a-z0-9_.-]{3,120}$/i.test(runner)) throw new Error("invalid_training_runner");
  return runner;
}

function leaseUntil(now: Date) {
  return new Date(now.getTime() + 2 * 60_000).toISOString();
}

export async function claimLocalRunnerTrainingJob(env: Env, runner: RunnerIdentity) {
  const now = new Date();
  const nowValue = now.toISOString();
  const candidate = await env.DB.prepare(`select id from creative_dna_training_jobs
    where owner_id = ? and status in ('waiting-for-runner', 'running')
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)
    order by case when runner_id = ? then 0 else 1 end, created_at limit 1`)
    .bind(runner.ownerId, nowValue, runner.id, runner.id).first<{ id: string }>();
  if (!candidate) return null;
  const changed = await env.DB.prepare(`update creative_dna_training_jobs set status = 'running', progress = max(progress, 5),
    runner_id = ?, runner_lease_until = ?, started_at = coalesce(started_at, ?), updated_at = ?, error = null
    where id = ? and owner_id = ? and status in ('waiting-for-runner', 'running')
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)`)
    .bind(runner.id, leaseUntil(now), nowValue, nowValue, candidate.id, runner.ownerId, nowValue, runner.id).run();
  if (!changed.meta.changes) return null;
  await env.DB.prepare("update creative_runners set active_job_id = ?, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
    .bind(candidate.id, nowValue, runner.id, runner.ownerId).run();
  return creativeDnaTrainingBundle(env, runner.ownerId, candidate.id);
}

export async function heartbeatLocalRunnerTrainingJob(env: Env, runner: RunnerIdentity, jobId: string, progressValue: unknown) {
  const progress = Math.max(5, Math.min(94, Math.round(Number(progressValue) || 5)));
  const now = new Date();
  const changed = await env.DB.prepare(`update creative_dna_training_jobs set progress = max(progress, ?),
    runner_lease_until = ?, updated_at = ? where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
    .bind(progress, leaseUntil(now), now.toISOString(), jobId, runner.ownerId, runner.id).run();
  const row = await trainingRow(env, runner.ownerId, jobId);
  if (!row) throw new Error("training_job_not_found");
  return { continue: Boolean(changed.meta.changes), trainingJob: mapTrainingJob(row) };
}

export async function cancelCreativeDnaTrainingJob(env: Env, ownerId: string, jobId: string) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`update creative_dna_training_jobs set status = 'cancelled', error = 'cancelled_by_user',
    runner_lease_until = null, updated_at = ?, completed_at = ?
    where id = ? and owner_id = ? and status in ('waiting-for-runner', 'running')`)
    .bind(now, now, jobId, ownerId).run();
  if (!result.meta.changes) {
    const current = await trainingRow(env, ownerId, jobId);
    if (!current) throw new Error("training_job_not_found");
    throw new Error("training_job_not_cancellable");
  }
  await env.DB.prepare("update creative_runners set active_job_id = null where owner_id = ? and active_job_id = ?")
    .bind(ownerId, jobId).run();
  return mapTrainingJob((await trainingRow(env, ownerId, jobId))!);
}

function boundedConfidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error("invalid_training_analysis");
  return Math.max(0, Math.min(1, Math.round(numeric * 1000) / 1000));
}

function boundedDimension(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error("invalid_training_analysis");
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function safeMetrics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_training_analysis");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 40) throw new Error("invalid_training_analysis");
  return entries.reduce<Record<string, string | number | boolean>>((result, [rawKey, rawValue]) => {
    const key = boundedText(rawKey, 48);
    if (!/^[a-z][a-z0-9_.-]{0,47}$/i.test(key)) throw new Error("invalid_training_analysis");
    if (typeof rawValue === "boolean") result[key] = rawValue;
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) result[key] = Math.round(rawValue * 1000) / 1000;
    else if (typeof rawValue === "string") result[key] = boundedText(rawValue, 200);
    else throw new Error("invalid_training_analysis");
    return result;
  }, {});
}

function safeSourceDimensions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_training_analysis");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !CREATIVE_DNA_DIMENSION_KEYS.includes(key as typeof CREATIVE_DNA_DIMENSION_KEYS[number]))) {
    throw new Error("invalid_training_analysis");
  }
  return CREATIVE_DNA_DIMENSION_KEYS.reduce<CreativeDnaTrainingSourceAnalysis["dimensions"]>((result, key) => {
    if (record[key] !== undefined) result[key] = boundedDimension(record[key]);
    return result;
  }, {});
}

function canonicalSources(assets: MediaAsset[], examples: CreativeTrainingExample[]) {
  return new Map<string, Omit<CreativeDnaTrainingSourceAnalysis, "observations" | "metrics" | "dimensions" | "confidence">>([
    ...assets.map((asset) => [asset.id, {
      sourceId: asset.id,
      mediaId: asset.id,
      sourceType: "upload" as const,
      kind: asset.kind,
      label: asset.name,
    }] as const),
    ...examples.map((example) => [example.id, {
      sourceId: example.id,
      mediaId: example.artifactId,
      sourceType: "accepted-artifact" as const,
      kind: example.kind === "music" ? "audio" as const : example.kind === "video" ? "video" as const : "image" as const,
      label: `Accepted ${example.kind} result`,
    }] as const),
  ]);
}

function sanitizeTrainingAnalysis(
  value: CreativeDnaTrainingAnalysis,
  assets: MediaAsset[],
  examples: CreativeTrainingExample[],
): CreativeDnaTrainingAnalysis {
  if (!value || value.schemaVersion !== "creative-dna-training-analysis/1.0" || !Array.isArray(value.sources)) {
    throw new Error("invalid_training_analysis");
  }
  const expected = canonicalSources(assets, examples);
  if (value.sources.length !== expected.size || value.sources.length > 96) throw new Error("invalid_training_analysis");
  const seen = new Set<string>();
  const sources = value.sources.map((source) => {
    const sourceId = boundedText(source?.sourceId, 100);
    const canonical = expected.get(sourceId);
    if (!canonical || seen.has(sourceId)) throw new Error("invalid_training_analysis");
    seen.add(sourceId);
    if (!Array.isArray(source.observations) || source.observations.length > 16) throw new Error("invalid_training_analysis");
    return {
      ...canonical,
      observations: source.observations.map((observation) => boundedText(observation, 240)).filter(Boolean),
      metrics: safeMetrics(source.metrics),
      dimensions: safeSourceDimensions(source.dimensions),
      confidence: boundedConfidence(source.confidence),
    } satisfies CreativeDnaTrainingSourceAnalysis;
  });
  if (seen.size !== expected.size) throw new Error("invalid_training_analysis");

  if (!value.dimensions || typeof value.dimensions !== "object") throw new Error("invalid_training_analysis");
  const dimensions = CREATIVE_DNA_DIMENSION_KEYS.reduce<CreativeDnaTrainingAnalysis["dimensions"]>((result, key) => {
    const input = value.dimensions[key];
    if (!input || !Array.isArray(input.sourceIds)) throw new Error("invalid_training_analysis");
    const sourceIds = [...new Set(input.sourceIds.map((sourceId) => boundedText(sourceId, 100)))];
    if (!sourceIds.length || sourceIds.some((sourceId) => !expected.has(sourceId))) throw new Error("invalid_training_analysis");
    result[key] = { value: boundedDimension(input.value), confidence: boundedConfidence(input.confidence), sourceIds };
    return result;
  }, {} as CreativeDnaTrainingAnalysis["dimensions"]);

  const summary = boundedText(value.summary, 1200);
  if (summary.length < 20) throw new Error("invalid_training_analysis");
  return { schemaVersion: "creative-dna-training-analysis/1.0", createdAt: new Date().toISOString(), summary, sources, dimensions };
}

export async function completeCreativeDnaTrainingJob(
  env: Env,
  ownerId: string,
  jobId: string,
  input: CompleteCreativeDnaTrainingJobRequest,
) {
  const row = await trainingRow(env, ownerId, jobId);
  if (!row) throw new Error("training_job_not_found");
  const job = mapTrainingJob(row);
  const runner = runnerId(input.runnerId);
  if (job.status !== "running" || job.runnerId !== runner) throw new Error("training_job_not_completable");
  const bundle = await creativeDnaTrainingBundle(env, ownerId, jobId);
  const analysis = sanitizeTrainingAnalysis(input.analysis, bundle.assets, bundle.trainingExamples);
  const baseDna = bundle.baseDna;

  const artifact = await createLocalDna(env, ownerId, {
    ...input.dna,
    projectId: job.projectId,
    parentArtifactId: job.baseDnaArtifactId,
    name: boundedText(input.dna.name, 80) || job.name,
    targetModality: job.targetModality,
    sourceKind: baseDna?.source.kind ?? "original",
    referenceLabel: baseDna?.source.referenceLabel ?? undefined,
  });
  const overallConfidence = CREATIVE_DNA_DIMENSION_KEYS.reduce((total, key) => total + analysis.dimensions[key].confidence, 0)
    / CREATIVE_DNA_DIMENSION_KEYS.length;
  const trainedArtifact = {
    ...artifact,
    training: { jobId: job.id, runnerId: runner, assetIds: job.assetIds, trainingExampleIds: job.trainingExampleIds, analysis },
    evidence: [
      ...artifact.evidence.map((entry) => entry.path === "source.directive" || entry.path === "shared"
        ? { ...entry, class: "derived/translated" as const, confidence: Math.round(overallConfidence * 1000) / 1000 }
        : entry),
      ...CREATIVE_DNA_DIMENSION_KEYS.map((key) => ({
        path: `training.analysis.dimensions.${key}`,
        class: "derived/translated" as const,
        confidence: analysis.dimensions[key].confidence,
        downstream: true,
      })),
    ],
  };
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("update creative_dna_artifacts set dna_json = ? where id = ? and owner_id = ?")
      .bind(JSON.stringify(trainedArtifact), trainedArtifact.artifactId, ownerId),
    env.DB.prepare(`update creative_dna_training_jobs set status = 'completed', progress = 100,
      result_dna_artifact_id = ?, error = null, updated_at = ?, completed_at = ?, runner_lease_until = null
      where id = ? and owner_id = ? and status = 'running' and runner_id = ?`)
      .bind(trainedArtifact.artifactId, now, now, jobId, ownerId, runner),
    env.DB.prepare("update creative_runners set active_job_id = null, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
      .bind(now, runner, ownerId),
  ]);
  return mapTrainingJob((await trainingRow(env, ownerId, jobId))!);
}

export async function completeLocalRunnerTrainingJob(
  env: Env,
  runner: RunnerIdentity,
  jobId: string,
  input: Omit<CompleteCreativeDnaTrainingJobRequest, "runnerId">,
) {
  return completeCreativeDnaTrainingJob(env, runner.ownerId, jobId, { ...input, runnerId: runner.id });
}

export async function failCreativeDnaTrainingJob(
  env: Env,
  ownerId: string,
  jobId: string,
  input: FailCreativeDnaTrainingJobRequest,
) {
  const runner = runnerId(input.runnerId);
  const error = boundedText(input.error, 500) || "training_runner_failed";
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`update creative_dna_training_jobs set status = 'failed', error = ?,
    updated_at = ?, completed_at = ?, runner_lease_until = null
    where id = ? and owner_id = ? and status = 'running' and runner_id = ?`)
    .bind(error, now, now, jobId, ownerId, runner).run();
  if (!result.meta.changes) throw new Error("training_job_not_completable");
  await env.DB.prepare("update creative_runners set active_job_id = null, last_error = ?, last_heartbeat_at = ? where id = ? and owner_id = ?")
    .bind(error, now, runner, ownerId).run();
  return mapTrainingJob((await trainingRow(env, ownerId, jobId))!);
}

export async function failLocalRunnerTrainingJob(env: Env, runner: RunnerIdentity, jobId: string, error: unknown) {
  return failCreativeDnaTrainingJob(env, runner.ownerId, jobId, { runnerId: runner.id, error: boundedText(error, 500) });
}
