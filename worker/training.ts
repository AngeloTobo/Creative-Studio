import type {
  CompleteCreativeDnaTrainingJobRequest,
  CreateCreativeDnaTrainingJobRequest,
  CreativeDnaTrainingJob,
  FailCreativeDnaTrainingJobRequest,
} from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import {
  createLocalDna,
  listLocalDna,
  listMediaAssets,
  listTrainingExamples,
  projectById,
} from "./repository";
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
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

const TRAINING_COLUMNS = `id, project_id as projectId, base_dna_artifact_id as baseDnaArtifactId,
  result_dna_artifact_id as resultDnaArtifactId, name, target_modality as targetModality, status,
  progress, provider, asset_ids_json as assetIdsJson, training_example_ids_json as trainingExampleIdsJson,
  runner_id as runnerId, error, created_at as createdAt, updated_at as updatedAt,
  started_at as startedAt, completed_at as completedAt`;

function ids(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapTrainingJob(row: TrainingRow): CreativeDnaTrainingJob {
  return {
    ...row,
    progress: Number(row.progress || 0),
    assetIds: ids(row.assetIdsJson),
    trainingExampleIds: ids(row.trainingExampleIdsJson),
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
    runner_id, error, created_at, updated_at, started_at, completed_at
  ) values (?, ?, ?, ?, null, ?, ?, 'waiting-for-runner', 0, 'local-creative-dna-runner', ?, ?, ?, null, null, ?, ?, null, null)`)
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
    assets: trainingJob.assetIds.map((assetId) => allAssets.find((asset) => asset.id === assetId)).filter((asset) => Boolean(asset)),
    trainingExamples: trainingJob.trainingExampleIds.map((exampleId) => allExamples.find((example) => example.id === exampleId)).filter((example) => Boolean(example)),
  };
}

function runnerId(value: unknown) {
  const runner = boundedText(value, 120);
  if (!/^[a-z0-9_.-]{3,120}$/i.test(runner)) throw new Error("invalid_training_runner");
  return runner;
}

export async function claimCreativeDnaTrainingJob(env: Env, ownerId: string, jobId: string, requestedRunnerId: unknown) {
  const runner = runnerId(requestedRunnerId);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`update creative_dna_training_jobs set status = 'running', progress = 5,
    runner_id = ?, started_at = coalesce(started_at, ?), updated_at = ?, error = null
    where id = ? and owner_id = ? and status = 'waiting-for-runner'`)
    .bind(runner, now, now, jobId, ownerId).run();
  if (!result.meta.changes) {
    const current = await trainingRow(env, ownerId, jobId);
    if (!current) throw new Error("training_job_not_found");
    throw new Error("training_job_not_claimable");
  }
  return mapTrainingJob((await trainingRow(env, ownerId, jobId))!);
}

export async function cancelCreativeDnaTrainingJob(env: Env, ownerId: string, jobId: string) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`update creative_dna_training_jobs set status = 'cancelled', error = 'cancelled_by_user',
    updated_at = ?, completed_at = ? where id = ? and owner_id = ? and status in ('waiting-for-runner', 'running')`)
    .bind(now, now, jobId, ownerId).run();
  if (!result.meta.changes) {
    const current = await trainingRow(env, ownerId, jobId);
    if (!current) throw new Error("training_job_not_found");
    throw new Error("training_job_not_cancellable");
  }
  return mapTrainingJob((await trainingRow(env, ownerId, jobId))!);
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

  const artifact = await createLocalDna(env, ownerId, {
    ...input.dna,
    projectId: job.projectId,
    parentArtifactId: job.baseDnaArtifactId,
    name: boundedText(input.dna.name, 80) || job.name,
    targetModality: job.targetModality,
    sourceKind: "original",
    referenceLabel: undefined,
  });
  const trainedArtifact = {
    ...artifact,
    training: { jobId: job.id, runnerId: runner, assetIds: job.assetIds, trainingExampleIds: job.trainingExampleIds },
    evidence: [...artifact.evidence, { path: "training", class: "derived/translated" as const, confidence: 0.8, downstream: true }],
  };
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("update creative_dna_artifacts set dna_json = ? where id = ? and owner_id = ?")
      .bind(JSON.stringify(trainedArtifact), trainedArtifact.artifactId, ownerId),
    env.DB.prepare(`update creative_dna_training_jobs set status = 'completed', progress = 100,
      result_dna_artifact_id = ?, error = null, updated_at = ?, completed_at = ?
      where id = ? and owner_id = ? and status = 'running' and runner_id = ?`)
      .bind(trainedArtifact.artifactId, now, now, jobId, ownerId, runner),
  ]);
  return mapTrainingJob((await trainingRow(env, ownerId, jobId))!);
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
    updated_at = ?, completed_at = ? where id = ? and owner_id = ? and status = 'running' and runner_id = ?`)
    .bind(error, now, now, jobId, ownerId, runner).run();
  if (!result.meta.changes) throw new Error("training_job_not_completable");
  return mapTrainingJob((await trainingRow(env, ownerId, jobId))!);
}
