import {
  compileCreativeDna,
  PROJECT_HUES,
  type Acceptance,
  type AcceptanceDecision,
  type Artifact,
  type CreateCreativeDnaRequest,
  type CreativeDnaArtifact,
  type CreativeTrainingExample,
  type CreateProjectRequest,
  type GenerationSettingsStamp,
  type Job,
  type MediaAsset,
  type MediaKind,
  type Project,
  type RunnerMediaInput,
  type UpdateProjectRequest,
} from "../shared/contracts";
import type { AfdfwGeneration } from "./adapters/afdfw";
import { boundedText, id } from "./lib/http";
import type { Env } from "./types";

type ProjectRow = Project;

const PROJECT_HUE_SET = new Set<string>(PROJECT_HUES);

function projectInitials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  const value = words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2);
  return (value || "CS").toUpperCase();
}

function projectInput(input: CreateProjectRequest) {
  const name = boundedText(input.name, 80);
  const type = boundedText(input.type, 80);
  if (!name) throw new Error("project_name_required");
  if (!type) throw new Error("project_type_required");
  const hue = input.hue ?? PROJECT_HUES[0];
  if (!PROJECT_HUE_SET.has(hue)) throw new Error("invalid_project_hue");
  return {
    name,
    type,
    description: boundedText(input.description, 500),
    note: boundedText(input.note, 250),
    hue,
    initials: projectInitials(name),
  };
}

export async function projectById(env: Env, ownerId: string, projectId: string) {
  return env.DB.prepare(`select id, active_dna_artifact_id as activeDnaArtifactId, name, type, status, description, note, hue, initials, created_at as createdAt, updated_at as updatedAt from creative_projects where id = ? and owner_id = ?`)
    .bind(projectId, ownerId).first<ProjectRow>();
}

export async function listProjects(env: Env, ownerId: string): Promise<Project[]> {
  const result = await env.DB.prepare(`select id, active_dna_artifact_id as activeDnaArtifactId, name, type, status, description, note, hue, initials, created_at as createdAt, updated_at as updatedAt from creative_projects where owner_id = ? order by case when status = 'archived' then 1 else 0 end, created_at`).bind(ownerId).all<ProjectRow>();
  return (result.results ?? []) as Project[];
}

export async function createProject(env: Env, ownerId: string, input: CreateProjectRequest) {
  const values = projectInput(input);
  const now = new Date().toISOString();
  const project: Project = { id: id("project"), activeDnaArtifactId: null, status: "active", ...values, createdAt: now, updatedAt: now };
  await env.DB.prepare(`insert into creative_projects (id, owner_id, name, type, status, description, note, hue, initials, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(project.id, ownerId, project.name, project.type, project.status, project.description, project.note, project.hue, project.initials, now, now).run();
  return project;
}

type MediaRow = {
  id: string;
  projectId: string;
  kind: MediaKind;
  name: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  source: "upload";
  status: "retained";
  trainingEligible: number;
  createdAt: string;
  updatedAt: string;
};

const MEDIA_COLUMNS = `id, project_id as projectId, kind, name, original_file_name as originalFileName,
  mime_type as mimeType, size, source, status, training_eligible as trainingEligible,
  created_at as createdAt, updated_at as updatedAt`;

function mapMedia(row: MediaRow): MediaAsset {
  return {
    ...row,
    size: Number(row.size),
    trainingEligible: Boolean(row.trainingEligible),
    contentUrl: `/api/creative-studio/media/${row.id}/content`,
    provenance: { uploadedByOwner: true, uploadedAt: row.createdAt, parentAssetIds: [] },
  };
}

export async function listMediaAssets(env: Env, ownerId: string): Promise<MediaAsset[]> {
  const result = await env.DB.prepare(`select ${MEDIA_COLUMNS} from creative_media_assets where owner_id = ? order by created_at desc limit 250`)
    .bind(ownerId).all<MediaRow>();
  return (result.results ?? []).map(mapMedia);
}

export async function createMediaAsset(
  env: Env,
  ownerId: string,
  input: {
    id: string;
    projectId: string;
    kind: MediaKind;
    name: string;
    originalFileName: string;
    mimeType: string;
    size: number;
    r2Key: string;
    trainingEligible: boolean;
  },
) {
  const now = new Date().toISOString();
  await env.DB.prepare(`insert into creative_media_assets (
    id, owner_id, project_id, kind, name, original_file_name, mime_type, size, r2_key,
    source, status, training_eligible, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', 'retained', ?, ?, ?)`)
    .bind(input.id, ownerId, input.projectId, input.kind, input.name, input.originalFileName,
      input.mimeType, input.size, input.r2Key, input.trainingEligible ? 1 : 0, now, now).run();
  return mapMedia({
    id: input.id,
    projectId: input.projectId,
    kind: input.kind,
    name: input.name,
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    size: input.size,
    source: "upload",
    status: "retained",
    trainingEligible: input.trainingEligible ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });
}

export async function mediaObjectById(env: Env, ownerId: string, mediaId: string) {
  return env.DB.prepare(`select r2_key as r2Key, mime_type as mimeType, size, original_file_name as originalFileName
    from creative_media_assets where id = ? and owner_id = ?`)
    .bind(mediaId, ownerId).first<{ r2Key: string; mimeType: string; size: number; originalFileName: string }>();
}

export type RunnerInputObject = RunnerMediaInput & { r2Key: string };

function retainedFileName(idValue: string, mimeType: string) {
  const extension = ({
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "audio/wav": "wav", "audio/mpeg": "mp3", "audio/flac": "flac", "audio/ogg": "ogg",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  } as Record<string, string>)[mimeType] ?? "bin";
  return `creative-studio-${idValue}.${extension}`;
}

export async function runnerInputById(env: Env, ownerId: string, inputId: string): Promise<RunnerInputObject | null> {
  const upload = await env.DB.prepare(`select id, project_id as projectId, kind, name,
    original_file_name as originalFileName, mime_type as mimeType, size, r2_key as r2Key
    from creative_media_assets where id = ? and owner_id = ? and status = 'retained'`)
    .bind(inputId, ownerId).first<Omit<RunnerInputObject, "source">>();
  if (upload) return { ...upload, size: Number(upload.size), source: "upload" };

  const artifact = await env.DB.prepare(`select id, project_id as projectId, kind, name,
    retained_content_type as mimeType, retained_size as size, retained_key as r2Key
    from creative_artifacts where id = ? and owner_id = ? and retained_key is not null and retained_size > 0`)
    .bind(inputId, ownerId).first<{
      id: string; projectId: string; kind: Artifact["kind"]; name: string;
      mimeType: string; size: number; r2Key: string;
    }>();
  if (!artifact) return null;
  const kind: RunnerMediaInput["kind"] = artifact.kind === "music" ? "audio" : artifact.kind;
  return {
    ...artifact,
    kind,
    size: Number(artifact.size),
    originalFileName: retainedFileName(artifact.id, artifact.mimeType),
    source: "artifact",
  };
}

export async function updateProject(env: Env, ownerId: string, projectId: string, input: UpdateProjectRequest) {
  const current = await projectById(env, ownerId, projectId);
  if (!current) throw new Error("project_not_found");
  if (current.status === "archived") throw new Error("project_archived");
  const merged = projectInput({
    name: input.name ?? current.name,
    type: input.type ?? current.type,
    description: input.description ?? current.description,
    note: input.note ?? current.note,
    hue: input.hue ?? (current.hue as CreateProjectRequest["hue"]),
  });
  const status = input.status ?? current.status;
  if (status !== "active" && status !== "paused") throw new Error("invalid_project_status");
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(`update creative_projects set name = ?, type = ?, status = ?, description = ?, note = ?, hue = ?, initials = ?, updated_at = ? where id = ? and owner_id = ?`)
    .bind(merged.name, merged.type, status, merged.description, merged.note, merged.hue, merged.initials, updatedAt, projectId, ownerId).run();
  return { ...current, ...merged, status, updatedAt } satisfies Project;
}

export async function archiveProject(env: Env, ownerId: string, projectId: string) {
  const current = await projectById(env, ownerId, projectId);
  if (!current) throw new Error("project_not_found");
  if (current.status === "archived") return current;
  const updatedAt = new Date().toISOString();
  await env.DB.prepare("update creative_projects set status = 'archived', updated_at = ? where id = ? and owner_id = ?")
    .bind(updatedAt, projectId, ownerId).run();
  return { ...current, status: "archived", updatedAt } satisfies Project;
}

type DnaRow = { id: string; rootArtifactId: string; parentArtifactId: string | null; version: number; dnaJson: string };

function parseDna(row: DnaRow) {
  try { return JSON.parse(row.dnaJson) as CreativeDnaArtifact; } catch { return null; }
}

export async function listLocalDna(env: Env, ownerId: string): Promise<CreativeDnaArtifact[]> {
  const result = await env.DB.prepare(`select id, root_artifact_id as rootArtifactId, parent_artifact_id as parentArtifactId, version, dna_json as dnaJson from creative_dna_artifacts where owner_id = ? order by created_at desc limit 100`).bind(ownerId).all<DnaRow>();
  return (result.results ?? []).map(parseDna).filter((item): item is CreativeDnaArtifact => Boolean(item));
}

export async function createLocalDna(env: Env, ownerId: string, input: CreateCreativeDnaRequest) {
  const project = await env.DB.prepare("select id, status from creative_projects where id = ? and owner_id = ?").bind(input.projectId, ownerId).first<{ id: string; status: Project["status"] }>();
  if (!project) throw new Error("project_not_found");
  if (project.status === "archived") throw new Error("project_archived");
  let parent: DnaRow | null = null;
  if (input.parentArtifactId) {
    parent = await env.DB.prepare(`select id, root_artifact_id as rootArtifactId, parent_artifact_id as parentArtifactId, version, dna_json as dnaJson from creative_dna_artifacts where id = ? and owner_id = ?`).bind(input.parentArtifactId, ownerId).first<DnaRow>();
    if (!parent) throw new Error("parent_artifact_not_found");
    const parentArtifact = parseDna(parent);
    if (!parentArtifact || parentArtifact.projectId !== input.projectId) throw new Error("parent_project_mismatch");
  }
  const artifactId = id("dna");
  const createdAt = new Date().toISOString();
  const artifact = compileCreativeDna(input, {
    artifactId,
    projectId: input.projectId,
    version: parent ? parent.version + 1 : 1,
    rootArtifactId: parent?.rootArtifactId ?? artifactId,
    parentArtifactId: parent?.id ?? null,
    createdAt,
  });
  await env.DB.batch([
    env.DB.prepare(`insert into creative_dna_artifacts (id, owner_id, project_id, root_artifact_id, parent_artifact_id, version, dna_json, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(artifactId, ownerId, input.projectId, artifact.lineage.rootArtifactId, artifact.lineage.parentArtifactId, artifact.version, JSON.stringify(artifact), createdAt),
    env.DB.prepare("update creative_projects set active_dna_artifact_id = ?, updated_at = ? where id = ? and owner_id = ?")
      .bind(artifactId, createdAt, input.projectId, ownerId),
  ]);
  return artifact;
}

type JobRow = {
  id: string; projectId: string; dnaArtifactId: string; capability: Job["capability"]; modality: Job["modality"];
  status: Job["status"]; progress: number; prompt: string; provider: string; upstreamId: string | null;
  artifactId: string | null; retryOfJobId: string | null; error: string | null; createdAt: string; updatedAt: string; completedAt: string | null;
  settingsStampJson: string;
};

export type BackgroundJob = JobRow & {
  ownerId: string;
  upstreamMediaPath: string | null;
  reconcileEmail: string | null;
  idempotencyKey: string | null;
  reconcileAttempts: number;
  nextReconcileAt: string | null;
  timeoutAt: string | null;
  reconcileLeaseUntil: string | null;
  lastReconcileError: string | null;
  cancelledAt: string | null;
  executionTarget: "afdfw" | "local-comfyui";
  workflowId: string | null;
  workflowRevisionId: string | null;
  runnerId: string | null;
  runnerLeaseUntil: string | null;
};

const PUBLIC_JOB_COLUMNS = `id, project_id as projectId, dna_artifact_id as dnaArtifactId, capability, modality,
  status, progress, prompt, provider, upstream_id as upstreamId, artifact_id as artifactId,
  retry_of_job_id as retryOfJobId, error, created_at as createdAt, updated_at as updatedAt, completed_at as completedAt,
  settings_stamp_json as settingsStampJson`;

const BACKGROUND_JOB_COLUMNS = `${PUBLIC_JOB_COLUMNS}, owner_id as ownerId, upstream_media_path as upstreamMediaPath,
  reconcile_email as reconcileEmail, idempotency_key as idempotencyKey, reconcile_attempts as reconcileAttempts,
  next_reconcile_at as nextReconcileAt, timeout_at as timeoutAt, reconcile_lease_until as reconcileLeaseUntil,
  last_reconcile_error as lastReconcileError, cancelled_at as cancelledAt, execution_target as executionTarget,
  workflow_id as workflowId, workflow_revision_id as workflowRevisionId, runner_id as runnerId,
  runner_lease_until as runnerLeaseUntil`;

function parseSettingsStamp(value: string, fallback: Omit<GenerationSettingsStamp, "schemaVersion">): GenerationSettingsStamp {
  try {
    const parsed = JSON.parse(value) as GenerationSettingsStamp;
    if (parsed?.schemaVersion === 1) return parsed;
  } catch {
    // Older rows are represented by a truthful, minimal fallback.
  }
  return { schemaVersion: 1, ...fallback };
}

function mapJob(row: JobRow): Job {
  const settingsStamp = parseSettingsStamp(row.settingsStampJson, {
    source: "creative-dna", createdAt: row.createdAt, reusedFromJobId: null, prompt: row.prompt,
    provider: row.provider, modality: row.modality, workflow: null, parameters: { prompt: row.prompt },
    models: [], inputAssetIds: [],
  });
  const { settingsStampJson: _settingsStampJson, ...job } = row;
  void _settingsStampJson;
  return { ...job, progress: Number(row.progress || 0), settingsStamp };
}

export async function listJobs(env: Env, ownerId: string): Promise<Job[]> {
  const result = await env.DB.prepare(`select ${PUBLIC_JOB_COLUMNS} from creative_jobs where owner_id = ? order by created_at desc limit 100`).bind(ownerId).all<JobRow>();
  return (result.results ?? []).map(mapJob);
}

export async function listJobRuntime(env: Env, ownerId: string) {
  const result = await env.DB.prepare(`select id, runner_id as runnerId from creative_jobs where owner_id = ? order by created_at desc limit 100`)
    .bind(ownerId).all<{ id: string; runnerId: string | null }>();
  return Object.fromEntries((result.results ?? []).map((row) => [row.id, { runnerId: row.runnerId }]));
}

export async function jobById(env: Env, ownerId: string, jobId: string) {
  const row = await env.DB.prepare(`select ${PUBLIC_JOB_COLUMNS} from creative_jobs where id = ? and owner_id = ?`)
    .bind(jobId, ownerId).first<JobRow>();
  return row ? mapJob(row) : null;
}

export async function backgroundJobById(env: Env, jobId: string) {
  const row = await env.DB.prepare(`select ${BACKGROUND_JOB_COLUMNS} from creative_jobs where id = ?`)
    .bind(jobId).first<BackgroundJob>();
  return row ? { ...row, progress: Number(row.progress || 0), reconcileAttempts: Number(row.reconcileAttempts || 0) } : null;
}

export async function createQueuedJob(
  env: Env,
  ownerId: string,
  input: {
    projectId: string;
    dna: CreativeDnaArtifact;
    modality: Job["modality"];
    idempotencyKey: string;
    provider: string;
    reconcileEmail: string | null;
    retryOfJobId?: string | null;
    promptOverride?: string;
    settingsStampOverride?: GenerationSettingsStamp;
    executionTarget?: "afdfw" | "local-comfyui";
    workflowId?: string | null;
    workflowRevisionId?: string | null;
    upstreamId?: string | null;
  },
) {
  const existing = await env.DB.prepare(`select ${PUBLIC_JOB_COLUMNS} from creative_jobs where owner_id = ? and idempotency_key = ?`)
    .bind(ownerId, input.idempotencyKey).first<JobRow>();
  if (existing) return { job: mapJob(existing), created: false };

  const jobId = id("job");
  const now = new Date().toISOString();
  const timeoutAt = input.executionTarget === "local-comfyui" ? null : new Date(Date.now() + 30 * 60_000).toISOString();
  const prompt = input.promptOverride ?? input.dna.generationPrompts[input.modality === "video" ? "image" : input.modality];
  const settingsStamp: GenerationSettingsStamp = input.settingsStampOverride ?? {
    schemaVersion: 1,
    source: "creative-dna",
    createdAt: now,
    reusedFromJobId: input.retryOfJobId ?? null,
    prompt,
    provider: input.provider,
    modality: input.modality,
    workflow: null,
    parameters: { prompt },
    models: [],
    inputAssetIds: [],
  };
  const job: Job = {
    id: jobId,
    projectId: input.projectId,
    dnaArtifactId: input.dna.artifactId,
    capability: input.modality === "music" ? "MUSIC_GENERATE" : input.modality === "video" ? "VIDEO_GENERATE" : "IMAGE_GENERATE",
    modality: input.modality,
    status: "queued",
    progress: 1,
    prompt,
    provider: input.provider,
    upstreamId: input.upstreamId ?? null,
    artifactId: null,
    retryOfJobId: input.retryOfJobId ?? null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    settingsStamp,
  };
  try {
    await env.DB.prepare(`insert into creative_jobs (
      id, owner_id, project_id, dna_artifact_id, capability, modality, status, progress, prompt, provider,
      upstream_id, artifact_id, retry_of_job_id, error, created_at, updated_at, completed_at,
      reconcile_email, idempotency_key, reconcile_attempts, next_reconcile_at, timeout_at, settings_stamp_json,
      execution_target, workflow_id, workflow_revision_id
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, null, ?, ?, null, ?, ?, 0, ?, ?, ?, ?, ?, ?)`)
      .bind(job.id, ownerId, input.projectId, job.dnaArtifactId, job.capability, job.modality, job.status, job.progress,
        job.prompt, job.provider, job.upstreamId, job.retryOfJobId, now, now, input.reconcileEmail, input.idempotencyKey, now, timeoutAt,
        JSON.stringify(job.settingsStamp), input.executionTarget ?? "afdfw", input.workflowId ?? null, input.workflowRevisionId ?? null).run();
    return { job, created: true };
  } catch (error) {
    const winner = await env.DB.prepare(`select ${PUBLIC_JOB_COLUMNS} from creative_jobs where owner_id = ? and idempotency_key = ?`)
      .bind(ownerId, input.idempotencyKey).first<JobRow>();
    if (winner) return { job: mapJob(winner), created: false };
    throw error;
  }
}

export async function createDevelopmentJob(env: Env, ownerId: string, projectId: string, dna: CreativeDnaArtifact, modality: Job["modality"], idempotencyKey = id("idem")) {
  return (await createQueuedJob(env, ownerId, {
    projectId, dna, modality, idempotencyKey, reconcileEmail: null, provider: "development-worker",
  })).job;
}

export async function createAfdfwJob(env: Env, ownerId: string, projectId: string, dna: CreativeDnaArtifact, modality: Job["modality"], generation: AfdfwGeneration) {
  const created = await createQueuedJob(env, ownerId, {
    projectId,
    dna,
    modality,
    idempotencyKey: id("idem"),
    reconcileEmail: null,
    provider: modality === "music" ? "afdfw-stable-audio-3" : "afdfw-z-image",
  });
  return attachAfdfwGeneration(env, created.job.id, generation);
}

function upstreamStatus(status: string): Job["status"] {
  if (status === "completed" || status === "accepted") return "completed";
  if (status === "failed" || status === "expired") return "failed";
  if (status === "pending" || status === "queued") return "queued";
  return "running";
}

async function ensureArtifactForJob(env: Env, ownerId: string, job: Job, name: string, mediaPath: string | null) {
  const existing = await env.DB.prepare("select id, retained_key as retainedKey from creative_artifacts where job_id = ? and owner_id = ?")
    .bind(job.id, ownerId).first<{ id: string; retainedKey: string | null }>();
  if (existing) {
    await ensureTrainingExample(env, ownerId, job, existing.id);
    if (mediaPath && !existing.retainedKey) {
      await env.DB.prepare("update creative_jobs set artifact_id = ?, status = 'running', progress = 95 where id = ? and owner_id = ? and status in ('queued', 'running')")
        .bind(existing.id, job.id, ownerId).run();
    } else {
      const now = new Date().toISOString();
      await env.DB.prepare("update creative_jobs set artifact_id = ?, status = 'completed', progress = 100, completed_at = coalesce(completed_at, ?), next_reconcile_at = null where id = ? and owner_id = ?")
        .bind(existing.id, now, job.id, ownerId).run();
    }
    return existing.id;
  }
  const artifactId = id("artifact");
  const now = new Date().toISOString();
  const colors = job.modality === "music" ? ["#9d174d", "#7c3aed"] : ["#0e7490", "#a21caf"];
  const previewUrl = mediaPath ? `/api/creative-studio/artifacts/${artifactId}/media` : null;
  const artifactStatus: Artifact["status"] = mediaPath ? "retaining" : "ready";
  await env.DB.prepare(`insert or ignore into creative_artifacts (id, owner_id, project_id, job_id, dna_artifact_id, kind, name, status, provider, prompt, preview_kind, preview_url, preview_from, preview_to, upstream_media_path, parent_artifact_id, created_at, updated_at, settings_stamp_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?)`)
    .bind(artifactId, ownerId, job.projectId, job.id, job.dnaArtifactId, job.modality, name, artifactStatus, job.provider, job.prompt, mediaPath ? "remote-media" : "development-gradient", previewUrl, colors[0], colors[1], mediaPath, now, now, JSON.stringify(job.settingsStamp)).run();
  const winner = await env.DB.prepare("select id from creative_artifacts where job_id = ? and owner_id = ?")
    .bind(job.id, ownerId).first<{ id: string }>();
  if (!winner) throw new Error("artifact_create_failed");
  await ensureTrainingExample(env, ownerId, job, winner.id);
  if (mediaPath) {
    await env.DB.prepare("update creative_jobs set artifact_id = ?, status = 'running', progress = 95, updated_at = ?, next_reconcile_at = null where id = ? and owner_id = ? and status in ('queued', 'running')")
      .bind(winner.id, now, job.id, ownerId).run();
  } else {
    await env.DB.prepare("update creative_jobs set artifact_id = ?, status = 'completed', progress = 100, completed_at = coalesce(completed_at, ?), updated_at = ?, next_reconcile_at = null where id = ? and owner_id = ?")
      .bind(winner.id, now, now, job.id, ownerId).run();
  }
  return winner.id;
}

async function ensureTrainingExample(env: Env, ownerId: string, job: Job, artifactId: string) {
  const now = new Date().toISOString();
  await env.DB.prepare(`insert or ignore into creative_training_examples (
    id, owner_id, project_id, dna_artifact_id, artifact_id, kind, status, prompt, settings_stamp_json, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?)`)
    .bind(id("trainingexample"), ownerId, job.projectId, job.dnaArtifactId, artifactId, job.modality,
      job.prompt, JSON.stringify(job.settingsStamp), now, now).run();
}

export async function attachAfdfwGeneration(env: Env, jobId: string, generation: AfdfwGeneration) {
  const current = await backgroundJobById(env, jobId);
  if (!current) throw new Error("job_not_found");
  if (["completed", "failed", "cancelled"].includes(current.status)) return mapJob(current);
  const upstream = upstreamStatus(generation.status);
  const status: Job["status"] = upstream === "completed" ? "running" : upstream;
  const now = generation.updatedAt || new Date().toISOString();
  const progress = upstream === "completed" ? 95 : Math.max(current.progress, Number(generation.progress || (status === "running" ? 10 : 2)));
  const mediaPath = generation.mediaUrl || (generation.previewMediaId ? `/api/profile-${current.modality === "music" ? "song" : "image"}/media/${generation.previewMediaId}` : null);
  const nextAt = upstream === "completed" ? null : status === "queued" || status === "running" ? new Date(Date.now() + 60_000).toISOString() : null;
  const retentionTimeout = upstream === "completed" ? new Date(Date.now() + 24 * 60 * 60_000).toISOString() : current.timeoutAt;
  const changed = await env.DB.prepare(`update creative_jobs set upstream_id = ?, upstream_media_path = coalesce(?, upstream_media_path), status = ?, progress = ?,
      error = ?, last_reconcile_error = null, updated_at = ?, completed_at = case when ? = 'failed' then ? else completed_at end,
      next_reconcile_at = ?, timeout_at = ? where id = ? and status in ('queued', 'running')`)
    .bind(generation.id, mediaPath, status, progress, generation.error ?? null, now, upstream, now, nextAt, retentionTimeout, jobId).run();
  if (!changed.meta.changes) {
    const unchanged = await jobById(env, current.ownerId, jobId);
    if (!unchanged) throw new Error("job_not_found");
    return unchanged;
  }
  if (upstream === "completed") {
    if (!mediaPath) throw new Error("generation_media_missing");
    const dna = (await listLocalDna(env, current.ownerId)).find((item) => item.artifactId === current.dnaArtifactId);
    await ensureArtifactForJob(env, current.ownerId, mapJob({ ...current, upstreamId: generation.id, status, progress, updatedAt: now, completedAt: null }), dna?.name ?? `${current.modality} artifact`, mediaPath);
  }
  const updated = await jobById(env, current.ownerId, jobId);
  if (!updated) throw new Error("job_not_found");
  return updated;
}

export async function claimBackgroundJob(env: Env, jobId: string, leaseMs = 12 * 60_000) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
  const claimed = await env.DB.prepare(`update creative_jobs set reconcile_lease_until = ?, reconcile_attempts = reconcile_attempts + 1, updated_at = ?
    where id = ? and execution_target = 'afdfw' and status in ('queued', 'running')
      and (next_reconcile_at is null or next_reconcile_at <= ?)
      and (reconcile_lease_until is null or reconcile_lease_until <= ?)`)
    .bind(leaseUntil, now.toISOString(), jobId, now.toISOString(), now.toISOString()).run();
  return claimed.meta.changes ? backgroundJobById(env, jobId) : null;
}

export async function markBackgroundJobPending(env: Env, jobId: string, error: string, delaySeconds: number) {
  const now = new Date();
  await env.DB.prepare(`update creative_jobs set status = case when upstream_id is null then 'queued' else 'running' end,
    last_reconcile_error = ?, error = null, next_reconcile_at = ?, reconcile_lease_until = null, updated_at = ?
    where id = ? and status in ('queued', 'running')`)
    .bind(error.slice(0, 500), new Date(now.getTime() + delaySeconds * 1000).toISOString(), now.toISOString(), jobId).run();
}

export async function failBackgroundJob(env: Env, jobId: string, error: string) {
  const now = new Date().toISOString();
  await env.DB.prepare(`update creative_jobs set status = 'failed', error = ?, last_reconcile_error = ?, completed_at = ?,
    next_reconcile_at = null, reconcile_lease_until = null, updated_at = ? where id = ? and status in ('queued', 'running')`)
    .bind(error.slice(0, 500), error.slice(0, 500), now, now, jobId).run();
}

export async function releaseBackgroundJob(env: Env, jobId: string) {
  await env.DB.prepare("update creative_jobs set reconcile_lease_until = null where id = ?").bind(jobId).run();
}

export async function dueBackgroundJobIds(env: Env, limit = 50) {
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(`select id from creative_jobs where execution_target = 'afdfw' and status in ('queued', 'running')
    and (next_reconcile_at is null or next_reconcile_at <= ?)
    and (reconcile_lease_until is null or reconcile_lease_until <= ?)
    order by coalesce(next_reconcile_at, created_at) limit ?`).bind(now, now, limit).all<{ id: string }>();
  return (rows.results ?? []).map((row) => row.id);
}

const RUNNER_OUTPUT_TYPES: Record<string, { kind: Job["modality"]; extension: string }> = {
  "image/png": { kind: "image", extension: "png" },
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/webp": { kind: "image", extension: "webp" },
  "audio/wav": { kind: "music", extension: "wav" },
  "audio/mpeg": { kind: "music", extension: "mp3" },
  "audio/flac": { kind: "music", extension: "flac" },
  "audio/ogg": { kind: "music", extension: "ogg" },
  "video/mp4": { kind: "video", extension: "mp4" },
  "video/webm": { kind: "video", extension: "webm" },
  "video/quicktime": { kind: "video", extension: "mov" },
};

export const MAX_RUNNER_OUTPUT_BYTES = 100 * 1024 * 1024;

export async function completeLocalRunnerJob(
  env: Env,
  ownerId: string,
  runnerId: string,
  jobId: string,
  body: ReadableStream,
  contentTypeValue: string,
  declaredSize: number,
) {
  if (!env.ARTIFACTS) throw new Error("artifact_storage_not_configured");
  const contentType = contentTypeValue.toLowerCase().split(";", 1)[0].trim();
  const output = RUNNER_OUTPUT_TYPES[contentType];
  if (!output) throw new Error("unsupported_runner_output_type");
  if (!Number.isInteger(declaredSize) || declaredSize <= 0) throw new Error("empty_runner_output");
  if (declaredSize > MAX_RUNNER_OUTPUT_BYTES) throw new Error("runner_output_too_large");
  const background = await backgroundJobById(env, jobId);
  if (!background || background.ownerId !== ownerId) throw new Error("job_not_found");
  if (background.executionTarget !== "local-comfyui" || background.runnerId !== runnerId) throw new Error("runner_job_not_completable");
  if (background.modality !== output.kind) throw new Error("runner_output_modality_mismatch");
  if (background.status === "completed") {
    const completed = await jobById(env, ownerId, jobId);
    if (!completed) throw new Error("job_not_found");
    return completed;
  }
  if (background.status !== "running") throw new Error("runner_job_not_completable");

  const artifactId = `artifact_${jobId}`;
  const safeOwner = ownerId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  const key = `owners/${safeOwner}/artifacts/${artifactId}/result.${output.extension}`;
  const created = await env.ARTIFACTS.put(key, body, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType },
    customMetadata: { ownerId, artifactId, jobId, runnerId, retainedAt: new Date().toISOString() },
  });
  const retained = await env.ARTIFACTS.head(key);
  if (!retained || retained.size !== declaredSize) {
    if (created) await env.ARTIFACTS.delete(key);
    throw new Error("artifact_retention_verification_failed");
  }

  const dna = (await listLocalDna(env, ownerId)).find((item) => item.artifactId === background.dnaArtifactId);
  const now = new Date().toISOString();
  const colors = background.modality === "music" ? ["#9d174d", "#7c3aed"] : background.modality === "video" ? ["#312e81", "#db2777"] : ["#0e7490", "#a21caf"];
  await env.DB.batch([
    env.DB.prepare(`insert or ignore into creative_artifacts (
      id, owner_id, project_id, job_id, dna_artifact_id, kind, name, status, provider, prompt,
      preview_kind, preview_url, preview_from, preview_to, upstream_media_path, parent_artifact_id,
      created_at, updated_at, retained_key, retained_content_type, retained_size, settings_stamp_json
    ) values (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, 'remote-media', ?, ?, ?, null, null, ?, ?, ?, ?, ?, ?)`)
      .bind(artifactId, ownerId, background.projectId, jobId, background.dnaArtifactId, background.modality,
        dna?.name ?? `${background.modality} artifact`, background.provider, background.prompt,
        `/api/creative-studio/artifacts/${artifactId}/media`, colors[0], colors[1], now, now, key, contentType,
        retained.size, background.settingsStampJson),
    env.DB.prepare(`update creative_jobs set status = 'completed', progress = 100, artifact_id = ?, error = null,
      completed_at = coalesce(completed_at, ?), updated_at = ?, runner_lease_until = null, next_reconcile_at = null
      where id = ? and owner_id = ? and execution_target = 'local-comfyui' and runner_id = ? and status = 'running'`)
      .bind(artifactId, now, now, jobId, ownerId, runnerId),
    env.DB.prepare("update creative_runners set active_job_id = null, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
      .bind(now, runnerId, ownerId),
  ]);
  const completed = await jobById(env, ownerId, jobId);
  if (!completed || completed.status !== "completed") throw new Error("runner_job_not_completable");
  await ensureTrainingExample(env, ownerId, completed, artifactId);
  return completed;
}

export async function cancelOwnedJob(env: Env, ownerId: string, jobId: string) {
  const current = await jobById(env, ownerId, jobId);
  if (!current) throw new Error("job_not_found");
  if (current.status === "completed" || current.status === "failed") throw new Error("job_not_cancellable");
  if (current.artifactId) throw new Error("job_not_cancellable");
  if (current.status === "cancelled") return current;
  const now = new Date().toISOString();
  await env.DB.prepare(`update creative_jobs set status = 'cancelled', error = 'cancelled_by_user', cancelled_at = ?, completed_at = ?,
    next_reconcile_at = null, reconcile_lease_until = null, updated_at = ? where id = ? and owner_id = ? and status in ('queued', 'running')`)
    .bind(now, now, now, jobId, ownerId).run();
  const updated = await jobById(env, ownerId, jobId);
  if (!updated) throw new Error("job_not_found");
  return updated;
}

export async function reconcileDevelopmentJobs(env: Env, ownerId: string) {
  const jobs = await listJobs(env, ownerId);
  const now = new Date();
  for (const job of jobs) {
    if (job.provider !== "development-worker" || job.settingsStamp.source !== "creative-dna") continue;
    if (job.status !== "queued" && job.status !== "running") continue;
    const age = now.getTime() - new Date(job.createdAt).getTime();
    if (age >= 3_200) {
      const dna = (await listLocalDna(env, ownerId)).find((item) => item.artifactId === job.dnaArtifactId);
      await ensureArtifactForJob(env, ownerId, job, dna?.name ?? `${job.modality} artifact`, null);
    } else if (age >= 1_000 && job.status === "queued") {
      await env.DB.prepare("update creative_jobs set status = 'running', progress = 42, updated_at = ? where id = ? and owner_id = ?").bind(now.toISOString(), job.id, ownerId).run();
    }
  }
}

type ArtifactRow = {
  id: string; projectId: string; jobId: string; dnaArtifactId: string; kind: Artifact["kind"]; name: string;
  status: Artifact["status"]; provider: string; prompt: string; previewKind: Artifact["preview"]["kind"];
  previewUrl: string | null; previewFrom: string; previewTo: string; parentArtifactId: string | null;
  retainedKey: string | null; retainedSize: number | null; createdAt: string; updatedAt: string; settingsStampJson: string;
};

export async function listArtifacts(env: Env, ownerId: string): Promise<Artifact[]> {
  const result = await env.DB.prepare(`select id, project_id as projectId, job_id as jobId, dna_artifact_id as dnaArtifactId, kind, name, status, provider, prompt, preview_kind as previewKind, preview_url as previewUrl, preview_from as previewFrom, preview_to as previewTo, parent_artifact_id as parentArtifactId, retained_key as retainedKey, retained_size as retainedSize, created_at as createdAt, updated_at as updatedAt, settings_stamp_json as settingsStampJson from creative_artifacts where owner_id = ? order by created_at desc limit 100`).bind(ownerId).all<ArtifactRow>();
  return (result.results ?? []).map((row) => {
    const settingsStamp = parseSettingsStamp(row.settingsStampJson, {
      source: "creative-dna", createdAt: row.createdAt, reusedFromJobId: null, prompt: row.prompt,
      provider: row.provider, modality: row.kind, workflow: null, parameters: { prompt: row.prompt }, models: [], inputAssetIds: [],
    });
    return {
      id: row.id, projectId: row.projectId, jobId: row.jobId, dnaArtifactId: row.dnaArtifactId, kind: row.kind,
      name: row.name, status: row.status, provider: row.provider, prompt: row.prompt,
      preview: { kind: row.previewKind, url: row.previewUrl, colors: [row.previewFrom, row.previewTo] },
      lineage: { sourceArtifactIds: settingsStamp.inputArtifactIds ?? [], parentArtifactId: row.parentArtifactId },
      retention: { state: row.previewKind === "development-gradient" ? "development-only" : row.retainedKey ? "retained" : "pending", size: row.retainedSize === null ? null : Number(row.retainedSize) },
      settingsStamp,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  });
}

export async function listAcceptances(env: Env, ownerId: string): Promise<Acceptance[]> {
  const result = await env.DB.prepare(`select id, artifact_id as artifactId, decision, note, actor, created_at as createdAt from creative_acceptances where owner_id = ? order by created_at desc limit 200`).bind(ownerId).all<Acceptance>();
  return (result.results ?? []) as Acceptance[];
}

type TrainingExampleRow = Omit<CreativeTrainingExample, "settingsStamp"> & { settingsStampJson: string };

export async function listTrainingExamples(env: Env, ownerId: string): Promise<CreativeTrainingExample[]> {
  const result = await env.DB.prepare(`select id, project_id as projectId, dna_artifact_id as dnaArtifactId,
    artifact_id as artifactId, kind, status, prompt, settings_stamp_json as settingsStampJson,
    created_at as createdAt, updated_at as updatedAt
    from creative_training_examples where owner_id = ? order by created_at desc limit 500`)
    .bind(ownerId).all<TrainingExampleRow>();
  return (result.results ?? []).map((row) => {
    const { settingsStampJson, ...example } = row;
    return {
      ...example,
      settingsStamp: parseSettingsStamp(settingsStampJson, {
        source: "creative-dna", createdAt: row.createdAt, reusedFromJobId: null, prompt: row.prompt,
        provider: "unknown", modality: row.kind, workflow: null, parameters: { prompt: row.prompt }, models: [], inputAssetIds: [],
      }),
    };
  });
}

export async function reviewArtifact(env: Env, ownerId: string, artifactId: string, decision: AcceptanceDecision, note: string) {
  const current = await env.DB.prepare("select id, status, preview_kind as previewKind, retained_key as retainedKey from creative_artifacts where id = ? and owner_id = ?").bind(artifactId, ownerId).first<{ id: string; status: Artifact["status"]; previewKind: Artifact["preview"]["kind"]; retainedKey: string | null }>();
  if (!current) throw new Error("artifact_not_found");
  if (current.status === "retaining") throw new Error("artifact_not_ready");
  if (current.previewKind === "remote-media" && !current.retainedKey) throw new Error("artifact_not_retained");
  const reviewNote = note.trim().slice(0, 500);
  if ((decision === "accepted" || decision === "rejected") && !reviewNote) throw new Error("review_note_required");
  const now = new Date().toISOString();
  const acceptance: Acceptance = { id: id("acceptance"), artifactId, decision, note: reviewNote, actor: "angelo", createdAt: now };
  const status = decision === "accepted" ? "accepted" : decision === "rejected" ? "rejected" : "archived";
  await env.DB.batch([
    env.DB.prepare("update creative_artifacts set status = ?, updated_at = ? where id = ? and owner_id = ?").bind(status, now, artifactId, ownerId),
    env.DB.prepare("insert into creative_acceptances (id, owner_id, artifact_id, decision, note, actor, created_at) values (?, ?, ?, ?, ?, ?, ?)").bind(acceptance.id, ownerId, artifactId, decision, acceptance.note, acceptance.actor, now),
    env.DB.prepare(`update creative_training_examples set status = case
      when ? = 'accepted' then 'training-ready'
      when ? = 'rejected' then 'excluded'
      else status end, updated_at = ? where artifact_id = ? and owner_id = ?`)
      .bind(decision, decision, now, artifactId, ownerId),
  ]);
  const artifact = (await listArtifacts(env, ownerId)).find((item) => item.id === artifactId);
  if (!artifact) throw new Error("artifact_not_found");
  return { artifact, acceptance };
}

export async function artifactMediaPath(env: Env, ownerId: string, artifactId: string) {
  return env.DB.prepare(`select upstream_media_path as mediaPath, retained_key as retainedKey,
    retained_content_type as retainedContentType, retained_size as retainedSize
    from creative_artifacts where id = ? and owner_id = ?`)
    .bind(artifactId, ownerId)
    .first<{ mediaPath: string | null; retainedKey: string | null; retainedContentType: string | null; retainedSize: number | null }>();
}

export async function retainArtifactMedia(
  env: Env,
  ownerId: string,
  artifactId: string,
  media: { body: ArrayBuffer | ReadableStream; contentType: string; extension: string; declaredSize?: number | null } | null,
) {
  if (!env.ARTIFACTS) throw new Error("artifact_retention_not_configured");
  const current = await artifactMediaPath(env, ownerId, artifactId);
  if (!current) throw new Error("artifact_not_found");
  if (current.retainedKey) {
    const retained = await env.ARTIFACTS.head(current.retainedKey);
    if (!retained || (current.retainedSize !== null && retained.size !== Number(current.retainedSize))) {
      throw new Error("artifact_retention_verification_failed");
    }
    return current.retainedKey;
  }
  if (!media) throw new Error("artifact_media_not_found");
  const safeOwner = ownerId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  const key = `owners/${safeOwner}/artifacts/${artifactId}/result`;
  const created = await env.ARTIFACTS.put(key, media.body, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: media.contentType },
    customMetadata: { ownerId, artifactId, extension: media.extension, retainedAt: new Date().toISOString() },
  });
  const retained = await env.ARTIFACTS.head(key);
  const declaredSize = Number(media.declaredSize || 0);
  if (!retained || retained.size <= 0 || (declaredSize > 0 && retained.size !== declaredSize)) {
    if (created) await env.ARTIFACTS.delete(key);
    throw new Error("artifact_retention_verification_failed");
  }
  let updated: D1Result;
  try {
    updated = await env.DB.prepare(`update creative_artifacts set retained_key = ?, retained_content_type = ?, retained_size = ?, updated_at = ?
      where id = ? and owner_id = ? and retained_key is null`)
      .bind(key, media.contentType, retained.size, new Date().toISOString(), artifactId, ownerId).run();
  } catch (error) {
    if (created) await env.ARTIFACTS.delete(key);
    throw error;
  }
  if (!updated.meta.changes) {
    const winner = await artifactMediaPath(env, ownerId, artifactId);
    if (winner?.retainedKey === key) return key;
    if (created) await env.ARTIFACTS.delete(key);
    if (winner?.retainedKey) return winner.retainedKey;
    throw new Error("artifact_not_found");
  }
  return key;
}

export async function finalizeRetainedArtifact(env: Env, ownerId: string, artifactId: string) {
  const artifact = await env.DB.prepare(`select job_id as jobId, retained_key as retainedKey, retained_size as retainedSize
    from creative_artifacts where id = ? and owner_id = ?`)
    .bind(artifactId, ownerId).first<{ jobId: string; retainedKey: string | null; retainedSize: number | null }>();
  if (!artifact) throw new Error("artifact_not_found");
  if (!artifact.retainedKey || !Number(artifact.retainedSize || 0)) throw new Error("artifact_not_retained");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("update creative_artifacts set status = case when status = 'retaining' then 'ready' else status end, updated_at = ? where id = ? and owner_id = ?")
      .bind(now, artifactId, ownerId),
    env.DB.prepare("update creative_jobs set status = 'completed', progress = 100, artifact_id = ?, error = null, last_reconcile_error = null, completed_at = coalesce(completed_at, ?), updated_at = ?, next_reconcile_at = null where id = ? and owner_id = ? and status != 'cancelled'")
      .bind(artifactId, now, now, artifact.jobId, ownerId),
  ]);
  const job = await jobById(env, ownerId, artifact.jobId);
  if (!job) throw new Error("job_not_found");
  return job;
}
