import { afdfwGeneration, afdfwSubmitGeneration } from "./adapters/afdfw";
import {
  attachAfdfwGeneration,
  backgroundJobById,
  claimBackgroundJob,
  dueBackgroundJobIds,
  failBackgroundJob,
  markBackgroundJobPending,
  releaseBackgroundJob,
} from "./repository";
import { retainCompletedArtifact } from "./retention";
import type { Env, JobMessage } from "./types";

const PERMANENT_ERRORS = new Set([
  "approved_login_required",
  "background_identity_required",
  "daily_generation_limit_reached",
  "daily_limit_reached",
  "feature_disabled",
  "generation_feature_disabled",
  "generation_prompt_required",
  "image_bridge_not_configured",
  "invalid_generation_id",
  "invalid_upstream_generation_id",
  "prompt_required",
  "song_bridge_not_configured",
]);

function backgroundRequest(email: string) {
  return new Request("https://creative-studio.internal/background-job", {
    headers: { "cf-access-authenticated-user-email": email },
  });
}

function retryDelay(attempt: number) {
  return Math.min(900, 60 * (2 ** Math.min(Math.max(attempt - 1, 0), 4)));
}

export async function enqueueJob(env: Env, jobId: string, delaySeconds = 0) {
  if (!env.JOB_QUEUE) return false;
  await env.JOB_QUEUE.send({ jobId }, delaySeconds > 0 ? { delaySeconds } : undefined);
  return true;
}

export async function processJobMessage(env: Env, message: JobMessage) {
  const job = await claimBackgroundJob(env, message.jobId);
  if (!job) return;

  try {
    if (!job.reconcileEmail) {
      await failBackgroundJob(env, job.id, "background_identity_required");
      return;
    }

    const request = backgroundRequest(job.reconcileEmail);
    if (job.artifactId && job.upstreamMediaPath) {
      await retainCompletedArtifact(env, request, job.ownerId, job.artifactId);
      return;
    }
    if (job.timeoutAt && job.timeoutAt <= new Date().toISOString()) {
      await failBackgroundJob(env, job.id, "generation_timed_out");
      return;
    }
    const generation = job.upstreamId
      ? await afdfwGeneration(env, request, job.modality, job.upstreamId)
      : (await afdfwSubmitGeneration(env, request, job.modality, job.prompt)).generation;
    const updated = await attachAfdfwGeneration(env, job.id, generation);
    if (generation.status === "completed" || generation.status === "accepted") {
      if (!updated.artifactId) throw new Error("artifact_not_found");
      await retainCompletedArtifact(env, request, job.ownerId, updated.artifactId);
      return;
    }
    if (updated.status === "queued" || updated.status === "running") {
      await enqueueJob(env, job.id, 60);
    }
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : "background_reconciliation_failed";
    const latest = await backgroundJobById(env, job.id);
    if (!latest || latest.status === "cancelled") return;
    const retentionPending = Boolean(latest.artifactId && latest.upstreamMediaPath);
    const timedOut = !retentionPending && Boolean(latest.timeoutAt && latest.timeoutAt <= new Date().toISOString());
    const orphaned = error === "generation_not_found" && latest.reconcileAttempts >= 4;
    if (timedOut || orphaned || (!retentionPending && PERMANENT_ERRORS.has(error))) {
      await failBackgroundJob(env, job.id, timedOut ? "generation_timed_out" : error);
      return;
    }
    const delay = retryDelay(latest.reconcileAttempts);
    await markBackgroundJobPending(env, job.id, error, delay);
    await enqueueJob(env, job.id, delay);
  } finally {
    await releaseBackgroundJob(env, job.id);
  }
}

export async function sweepBackgroundJobs(env: Env) {
  const jobIds = await dueBackgroundJobIds(env);
  if (env.JOB_QUEUE) {
    await Promise.all(jobIds.map((jobId) => enqueueJob(env, jobId)));
  } else {
    for (const jobId of jobIds) await processJobMessage(env, { jobId });
  }
  return jobIds.length;
}

export async function consumeJobQueue(batch: MessageBatch<JobMessage>, env: Env) {
  for (const message of batch.messages) {
    try {
      await processJobMessage(env, message.body);
      message.ack();
    } catch {
      message.retry({ delaySeconds: 60 });
    }
  }
}
