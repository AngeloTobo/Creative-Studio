import type { GenerationSubmissionBatch, Job, SubmitJobBatchRequest } from "../shared/contracts";
import { boundedText } from "./lib/http";
import { jobById, jobByIdempotencyKey } from "./repository";
import type { Env } from "./types";

const BATCH_SCHEMA_VERSION = "creative-studio-job-batch/1.0" as const;
const MAX_BATCH_BYTES = 100_000;
const MAX_RECONCILE_ATTEMPTS = 8;

type GenerationBatchRow = {
  id: string;
  ownerId: string;
  projectId: string;
  status: "waiting" | "running" | "completed" | "failed" | "cancelled";
  laneCount: number;
  nextLane: number;
  requestJson: string;
  reconcileEmail: string | null;
  reconcileAttempts: number;
  lastError: string | null;
  failedLane: number | null;
  terminalReason: "permanent" | "retry-exhausted" | null;
  nextAttemptAt: string | null;
  reconcileLeaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type GenerationBatchRecord = Omit<GenerationBatchRow, "requestJson"> & {
  request: SubmitJobBatchRequest;
};

const BATCH_COLUMNS = `id, owner_id as ownerId, project_id as projectId, status,
  lane_count as laneCount, next_lane as nextLane, request_json as requestJson,
  reconcile_email as reconcileEmail, reconcile_attempts as reconcileAttempts,
  last_error as lastError, failed_lane as failedLane, terminal_reason as terminalReason,
  next_attempt_at as nextAttemptAt,
  reconcile_lease_until as reconcileLeaseUntil, created_at as createdAt,
  updated_at as updatedAt, completed_at as completedAt`;

function parseBatch(row: GenerationBatchRow): GenerationBatchRecord {
  return {
    ...row,
    laneCount: Number(row.laneCount),
    nextLane: Number(row.nextLane),
    reconcileAttempts: Number(row.reconcileAttempts),
    failedLane: row.failedLane === null ? null : Number(row.failedLane),
    request: JSON.parse(row.requestJson) as SubmitJobBatchRequest,
  };
}

function normalizedBatchRequest(value: SubmitJobBatchRequest) {
  if (!value || value.schemaVersion !== BATCH_SCHEMA_VERSION || !Array.isArray(value.jobs)) {
    throw new Error("invalid_generation_batch");
  }
  const batchId = boundedText(value.batchId, 120);
  if (!/^[a-z0-9_-]{8,120}$/i.test(batchId) || ![1, 2, 4].includes(value.jobs.length)) {
    throw new Error("invalid_generation_batch");
  }
  const projectId = boundedText(value.jobs[0]?.projectId, 100);
  if (!projectId) throw new Error("invalid_generation_batch");
  const idempotencyKeys = new Set<string>();
  value.jobs.forEach((job, index) => {
    const requestKey = boundedText(job?.idempotencyKey, 100);
    const outputBatch = job?.outputBatch;
    if (!job?.workflow
      || job.projectId !== projectId
      || job.modality === "music"
      || !/^[a-z0-9_-]{16,100}$/i.test(requestKey)
      || idempotencyKeys.has(requestKey)
      || outputBatch?.schemaVersion !== "creative-studio-output-batch/1.0"
      || outputBatch.batchId !== batchId
      || outputBatch.count !== value.jobs.length
      || outputBatch.index !== index + 1) {
      throw new Error("invalid_generation_batch");
    }
    idempotencyKeys.add(requestKey);
  });
  const request: SubmitJobBatchRequest = {
    schemaVersion: BATCH_SCHEMA_VERSION,
    batchId,
    jobs: value.jobs,
  };
  const requestJson = JSON.stringify(request);
  if (new TextEncoder().encode(requestJson).byteLength > MAX_BATCH_BYTES) throw new Error("generation_batch_too_large");
  return { request, requestJson, projectId };
}

export async function generationBatchById(env: Env, ownerId: string, batchId: string) {
  const row = await env.DB.prepare(`select ${BATCH_COLUMNS} from creative_generation_batches where id = ? and owner_id = ?`)
    .bind(batchId, ownerId).first<GenerationBatchRow>();
  return row ? parseBatch(row) : null;
}

export async function registerGenerationBatch(
  env: Env,
  ownerId: string,
  input: SubmitJobBatchRequest,
  reconcileEmail: string | null,
) {
  const normalized = normalizedBatchRequest(input);
  const existing = await generationBatchById(env, ownerId, normalized.request.batchId);
  if (existing) {
    if (JSON.stringify(existing.request) !== normalized.requestJson || existing.projectId !== normalized.projectId) {
      throw new Error("generation_batch_conflict");
    }
    return existing;
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`insert into creative_generation_batches (
    id, owner_id, project_id, status, lane_count, next_lane, request_json,
    reconcile_email, reconcile_attempts, created_at, updated_at
  ) values (?, ?, ?, 'waiting', ?, 1, ?, ?, 0, ?, ?)`)
    .bind(normalized.request.batchId, ownerId, normalized.projectId, normalized.request.jobs.length,
      normalized.requestJson, reconcileEmail, now, now).run();
  return (await generationBatchById(env, ownerId, normalized.request.batchId))!;
}

export async function claimGenerationBatch(env: Env, ownerId: string, batchId?: string) {
  const now = new Date().toISOString();
  let resolved: GenerationBatchRecord | null;
  if (batchId) {
    resolved = await generationBatchById(env, ownerId, boundedText(batchId, 120));
  } else {
    const row = await env.DB.prepare(`select ${BATCH_COLUMNS} from creative_generation_batches b
      where b.owner_id = ? and (
        b.status in ('waiting', 'running')
        or (b.status = 'completed' and exists (
          select 1 from creative_jobs j
          where j.owner_id = b.owner_id
            and json_extract(j.settings_stamp_json, '$.outputBatch.batchId') = b.id
            and (j.status = 'cancelled' or (j.status = 'failed' and not exists (
              select 1 from creative_jobs successor
              where successor.owner_id = j.owner_id and successor.retry_of_job_id = j.id
            )))
        ))
      )
        and (next_attempt_at is null or next_attempt_at <= ?)
        and (reconcile_lease_until is null or reconcile_lease_until <= ?)
      order by case when b.status = 'completed' then 0 else 1 end, b.created_at asc limit 1`)
      .bind(ownerId, now, now).first<GenerationBatchRow>();
    resolved = row ? parseBatch(row) : null;
  }
  if (!resolved || !["waiting", "running", "completed"].includes(resolved.status)
    || (resolved.nextAttemptAt && resolved.nextAttemptAt > now)
    || (resolved.reconcileLeaseUntil && resolved.reconcileLeaseUntil > now)) return null;
  const leaseUntil = new Date(Date.now() + 2 * 60_000).toISOString();
  const changed = await env.DB.prepare(`update creative_generation_batches set status = 'running',
    reconcile_lease_until = ?, updated_at = ? where id = ? and owner_id = ?
    and status in ('waiting', 'running', 'completed') and (next_attempt_at is null or next_attempt_at <= ?)
    and (reconcile_lease_until is null or reconcile_lease_until <= ?)`)
    .bind(leaseUntil, now, resolved.id, ownerId, now, now).run();
  if (!changed.meta.changes) return null;
  return generationBatchById(env, ownerId, resolved.id);
}

export async function advanceGenerationBatch(env: Env, ownerId: string, batchId: string, completedLane: number) {
  const batch = await generationBatchById(env, ownerId, batchId);
  if (!batch || batch.status === "failed" || batch.status === "cancelled") return batch;
  const nextLane = Math.max(batch.nextLane, completedLane + 1);
  const completed = nextLane > batch.laneCount;
  const now = new Date().toISOString();
  await env.DB.prepare(`update creative_generation_batches set next_lane = ?, status = ?,
    reconcile_attempts = 0, last_error = null, failed_lane = null, terminal_reason = null, next_attempt_at = null,
    reconcile_lease_until = ?, updated_at = ?, completed_at = ?
    where id = ? and owner_id = ?`)
    .bind(nextLane, completed ? "completed" : "running", completed ? null : batch.reconcileLeaseUntil,
      now, completed ? now : null, batchId, ownerId).run();
  return generationBatchById(env, ownerId, batchId);
}

export async function deferGenerationBatch(
  env: Env,
  ownerId: string,
  batchId: string,
  failedLane: number,
  error: string,
  permanent = false,
) {
  const batch = await generationBatchById(env, ownerId, batchId);
  if (!batch || batch.status === "completed" || batch.status === "cancelled") return batch;
  const attempts = batch.reconcileAttempts + 1;
  const terminal = permanent || attempts >= MAX_RECONCILE_ATTEMPTS;
  const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
  const now = new Date().toISOString();
  const nextAttemptAt = terminal ? null : new Date(Date.now() + delaySeconds * 1_000).toISOString();
  await env.DB.prepare(`update creative_generation_batches set status = ?, reconcile_attempts = ?,
    last_error = ?, failed_lane = ?, terminal_reason = ?, next_attempt_at = ?,
    reconcile_lease_until = null, updated_at = ?, completed_at = ?
    where id = ? and owner_id = ?`)
    .bind(terminal ? "failed" : "waiting", attempts, boundedText(error, 500), failedLane,
      terminal ? (permanent ? "permanent" : "retry-exhausted") : null, nextAttemptAt, now,
      terminal ? now : null, batchId, ownerId).run();
  return generationBatchById(env, ownerId, batchId);
}

export async function releaseGenerationBatch(env: Env, ownerId: string, batchId: string) {
  await env.DB.prepare(`update creative_generation_batches set reconcile_lease_until = null,
    status = case when status = 'running' then 'waiting' else status end, updated_at = ?
    where id = ? and owner_id = ?`).bind(new Date().toISOString(), batchId, ownerId).run();
}

export async function settleGenerationBatch(env: Env, ownerId: string, batchId: string) {
  const now = new Date().toISOString();
  await env.DB.prepare(`update creative_generation_batches set status = 'completed',
    last_error = null, failed_lane = null, terminal_reason = null, next_attempt_at = null,
    reconcile_lease_until = null, updated_at = ?, completed_at = coalesce(completed_at, ?)
    where id = ? and owner_id = ? and status in ('waiting', 'running', 'completed')`)
    .bind(now, now, batchId, ownerId).run();
  return generationBatchById(env, ownerId, batchId);
}

export async function cancelGenerationBatch(env: Env, ownerId: string, batchId: string, lane: number) {
  const now = new Date().toISOString();
  await env.DB.prepare(`update creative_generation_batches set status = 'cancelled', failed_lane = ?,
    last_error = 'A materialized lane was cancelled, so missing versions were not submitted.',
    terminal_reason = null, next_attempt_at = null, reconcile_lease_until = null,
    updated_at = ?, completed_at = ? where id = ? and owner_id = ? and status in ('waiting', 'running', 'completed')`)
    .bind(lane, now, now, batchId, ownerId).run();
  return generationBatchById(env, ownerId, batchId);
}

export async function generationBatchJobs(env: Env, ownerId: string, batch: GenerationBatchRecord): Promise<Job[]> {
  const jobs = await Promise.all(batch.request.jobs.map((job) => jobByIdempotencyKey(env, ownerId, job.idempotencyKey)));
  return jobs.filter((job): job is Job => Boolean(job));
}

export async function generationBatchLaneJobs(env: Env, ownerId: string, batchId: string): Promise<Job[]> {
  const rows = await env.DB.prepare(`select id from creative_jobs
    where owner_id = ? and json_extract(settings_stamp_json, '$.outputBatch.batchId') = ?
    order by created_at asc, id asc`).bind(ownerId, batchId).all<{ id: string }>();
  const jobs = await Promise.all((rows.results ?? []).map((row) => jobById(env, ownerId, row.id)));
  return jobs.filter((job): job is Job => Boolean(job));
}

export async function prioritizeGenerationBatchJobs(env: Env, ownerId: string, batchId: string) {
  await env.DB.prepare(`update creative_jobs set priority = max(priority, 900)
    where owner_id = ? and status = 'queued'
      and json_extract(settings_stamp_json, '$.outputBatch.batchId') = ?`)
    .bind(ownerId, batchId).run();
}

export async function listGenerationBatches(env: Env, ownerId: string): Promise<GenerationSubmissionBatch[]> {
  const rows = await env.DB.prepare(`select ${BATCH_COLUMNS} from creative_generation_batches
    where owner_id = ? order by created_at desc limit 100`).bind(ownerId).all<GenerationBatchRow>();
  return (rows.results ?? []).map(parseBatch).map((batch) => ({
    schemaVersion: "creative-studio-job-batch-state/1.0",
    batchId: batch.id,
    projectId: batch.projectId,
    status: batch.status,
    completedLanes: Math.min(batch.laneCount, Math.max(0, batch.nextLane - 1)),
    laneCount: batch.laneCount,
    failedLane: batch.failedLane,
    failureKind: batch.terminalReason,
    error: batch.lastError,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    completedAt: batch.completedAt,
  }));
}
