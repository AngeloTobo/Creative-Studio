import {
  compileCreativeDna,
  type Acceptance,
  type AcceptanceDecision,
  type Artifact,
  type CreateCreativeDnaRequest,
  type CreativeDnaArtifact,
  type Job,
  type Project,
} from "../shared/contracts";
import type { AfdfwGeneration } from "./adapters/afdfw";
import { id } from "./lib/http";
import type { Env } from "./types";

type ProjectRow = Omit<Project, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

export async function ensureProjects(env: Env, ownerId: string) {
  const existing = await env.DB.prepare("select count(*) as count from creative_projects where owner_id = ?").bind(ownerId).first<{ count: number }>();
  if (Number(existing?.count || 0) > 0) return;
  const now = new Date().toISOString();
  const rows = [
    ["rebecca", "Rebecca", "Character System", "active", "Nonbinary alien character and identity system.", "Character Core groundwork in progress.", "var(--violet)", "RB"],
    ["internet-dreams", "Internet Dreams", "Music / Visual", "active", "Music, covers, films, and nostalgic digital worlds.", "Cross-media DNA ready to evolve.", "var(--pink)", "ID"],
    ["easynews", "EasyNews", "Broadcast System", "paused", "Scripts, segments, graphics, and broadcast packages.", "Paused after segment 07.", "var(--cyan)", "EN"],
  ];
  await env.DB.batch(rows.map((row) => env.DB.prepare(
    "insert into creative_projects (id, owner_id, name, type, status, description, note, hue, initials, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(row[0], ownerId, row[1], row[2], row[3], row[4], row[5], row[6], row[7], now, now)));
}

export async function listProjects(env: Env, ownerId: string): Promise<Project[]> {
  await ensureProjects(env, ownerId);
  const result = await env.DB.prepare(`select id, name, type, status, description, note, hue, initials, created_at as createdAt, updated_at as updatedAt from creative_projects where owner_id = ? order by created_at`).bind(ownerId).all<ProjectRow>();
  return (result.results ?? []) as Project[];
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
  const project = await env.DB.prepare("select id from creative_projects where id = ? and owner_id = ?").bind(input.projectId, ownerId).first<{ id: string }>();
  if (!project) throw new Error("project_not_found");
  let parent: DnaRow | null = null;
  if (input.parentArtifactId) {
    parent = await env.DB.prepare(`select id, root_artifact_id as rootArtifactId, parent_artifact_id as parentArtifactId, version, dna_json as dnaJson from creative_dna_artifacts where id = ? and owner_id = ?`).bind(input.parentArtifactId, ownerId).first<DnaRow>();
    if (!parent) throw new Error("parent_artifact_not_found");
  }
  const artifactId = id("dna");
  const createdAt = new Date().toISOString();
  const artifact = compileCreativeDna(input, {
    artifactId,
    version: parent ? parent.version + 1 : 1,
    rootArtifactId: parent?.rootArtifactId ?? artifactId,
    parentArtifactId: parent?.id ?? null,
    createdAt,
  });
  await env.DB.prepare(`insert into creative_dna_artifacts (id, owner_id, project_id, root_artifact_id, parent_artifact_id, version, dna_json, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(artifactId, ownerId, input.projectId, artifact.lineage.rootArtifactId, artifact.lineage.parentArtifactId, artifact.version, JSON.stringify(artifact), createdAt).run();
  return artifact;
}

type JobRow = {
  id: string; projectId: string; dnaArtifactId: string; capability: Job["capability"]; modality: Job["modality"];
  status: Job["status"]; progress: number; prompt: string; provider: string; upstreamId: string | null;
  artifactId: string | null; error: string | null; createdAt: string; updatedAt: string; completedAt: string | null;
};

function mapJob(row: JobRow): Job {
  return { ...row, progress: Number(row.progress || 0) };
}

export async function listJobs(env: Env, ownerId: string): Promise<Job[]> {
  const result = await env.DB.prepare(`select id, project_id as projectId, dna_artifact_id as dnaArtifactId, capability, modality, status, progress, prompt, provider, upstream_id as upstreamId, artifact_id as artifactId, error, created_at as createdAt, updated_at as updatedAt, completed_at as completedAt from creative_jobs where owner_id = ? order by created_at desc limit 100`).bind(ownerId).all<JobRow>();
  return (result.results ?? []).map(mapJob);
}

export async function createDevelopmentJob(env: Env, ownerId: string, projectId: string, dna: CreativeDnaArtifact, modality: Job["modality"]) {
  const jobId = id("job");
  const now = new Date().toISOString();
  const job: Job = {
    id: jobId,
    projectId,
    dnaArtifactId: dna.artifactId,
    capability: modality === "music" ? "MUSIC_GENERATE" : "IMAGE_GENERATE",
    modality,
    status: "queued",
    progress: 4,
    prompt: dna.generationPrompts[modality],
    provider: "development-worker",
    upstreamId: null,
    artifactId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  await env.DB.prepare(`insert into creative_jobs (id, owner_id, project_id, dna_artifact_id, capability, modality, status, progress, prompt, provider, upstream_id, artifact_id, error, created_at, updated_at, completed_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(job.id, ownerId, projectId, job.dnaArtifactId, job.capability, job.modality, job.status, job.progress, job.prompt, job.provider, null, null, null, now, now, null).run();
  return job;
}

export async function createAfdfwJob(env: Env, ownerId: string, projectId: string, dna: CreativeDnaArtifact, modality: Job["modality"], generation: AfdfwGeneration) {
  const jobId = id("job");
  const status = upstreamStatus(generation.status);
  const now = new Date().toISOString();
  const job: Job = {
    id: jobId,
    projectId,
    dnaArtifactId: dna.artifactId,
    capability: modality === "music" ? "MUSIC_GENERATE" : "IMAGE_GENERATE",
    modality,
    status,
    progress: status === "completed" ? 100 : Number(generation.progress || 4),
    prompt: dna.generationPrompts[modality],
    provider: modality === "music" ? "afdfw-stable-audio-3" : "afdfw-z-image",
    upstreamId: generation.id,
    artifactId: null,
    error: generation.error ?? null,
    createdAt: generation.createdAt || now,
    updatedAt: generation.updatedAt || now,
    completedAt: status === "completed" ? generation.updatedAt || now : null,
  };
  const mediaPath = generation.mediaUrl || (generation.previewMediaId ? `/api/profile-${modality === "music" ? "song" : "image"}/media/${generation.previewMediaId}` : null);
  await env.DB.prepare(`insert into creative_jobs (id, owner_id, project_id, dna_artifact_id, capability, modality, status, progress, prompt, provider, upstream_id, upstream_media_path, artifact_id, error, created_at, updated_at, completed_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(job.id, ownerId, projectId, job.dnaArtifactId, job.capability, job.modality, job.status, job.progress, job.prompt, job.provider, job.upstreamId, mediaPath, null, job.error, job.createdAt, job.updatedAt, job.completedAt).run();
  if (status === "completed") await ensureArtifactForJob(env, ownerId, job, dna.name, mediaPath);
  return job;
}

function upstreamStatus(status: string): Job["status"] {
  if (status === "completed" || status === "accepted") return "completed";
  if (status === "failed" || status === "expired") return "failed";
  if (status === "pending" || status === "queued") return "queued";
  return "running";
}

async function ensureArtifactForJob(env: Env, ownerId: string, job: Job, name: string, mediaPath: string | null) {
  if (job.artifactId) return job.artifactId;
  const artifactId = id("artifact");
  const now = new Date().toISOString();
  const colors = job.modality === "music" ? ["#9d174d", "#7c3aed"] : ["#0e7490", "#a21caf"];
  const previewUrl = mediaPath ? `/api/creative-studio/artifacts/${artifactId}/media` : null;
  await env.DB.batch([
    env.DB.prepare(`insert into creative_artifacts (id, owner_id, project_id, job_id, dna_artifact_id, kind, name, status, provider, prompt, preview_kind, preview_url, preview_from, preview_to, upstream_media_path, parent_artifact_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, null, ?, ?)`)
      .bind(artifactId, ownerId, job.projectId, job.id, job.dnaArtifactId, job.modality, name, job.provider, job.prompt, mediaPath ? "remote-media" : "development-gradient", previewUrl, colors[0], colors[1], mediaPath, now, now),
    env.DB.prepare("update creative_jobs set artifact_id = ?, status = 'completed', progress = 100, completed_at = coalesce(completed_at, ?), updated_at = ? where id = ? and owner_id = ?")
      .bind(artifactId, now, now, job.id, ownerId),
  ]);
  return artifactId;
}

export async function reconcileDevelopmentJobs(env: Env, ownerId: string) {
  const jobs = await listJobs(env, ownerId);
  const now = new Date();
  for (const job of jobs) {
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

export async function reconcileAfdfwGenerations(env: Env, ownerId: string, modality: Job["modality"], generations: AfdfwGeneration[]) {
  const jobs = (await listJobs(env, ownerId)).filter((job) => job.modality === modality && job.upstreamId);
  for (const job of jobs) {
    const generation = generations.find((item) => item.id === job.upstreamId);
    if (!generation) continue;
    const status = upstreamStatus(generation.status);
    const progress = status === "completed" ? 100 : Number(generation.progress ?? job.progress);
    const mediaPath = generation.mediaUrl || (generation.previewMediaId ? `/api/profile-${modality === "music" ? "song" : "image"}/media/${generation.previewMediaId}` : null);
    await env.DB.prepare("update creative_jobs set status = ?, progress = ?, upstream_media_path = coalesce(?, upstream_media_path), error = ?, updated_at = ?, completed_at = case when ? = 'completed' then ? else completed_at end where id = ? and owner_id = ?")
      .bind(status, progress, mediaPath, generation.error ?? null, generation.updatedAt, status, generation.updatedAt, job.id, ownerId).run();
    if (status === "completed" && !job.artifactId) {
      const dna = (await listLocalDna(env, ownerId)).find((item) => item.artifactId === job.dnaArtifactId);
      await ensureArtifactForJob(env, ownerId, { ...job, status, progress }, dna?.name ?? `${modality} artifact`, mediaPath);
    }
  }
}

type ArtifactRow = {
  id: string; projectId: string; jobId: string; dnaArtifactId: string; kind: Artifact["kind"]; name: string;
  status: Artifact["status"]; provider: string; prompt: string; previewKind: Artifact["preview"]["kind"];
  previewUrl: string | null; previewFrom: string; previewTo: string; parentArtifactId: string | null; createdAt: string; updatedAt: string;
};

export async function listArtifacts(env: Env, ownerId: string): Promise<Artifact[]> {
  const result = await env.DB.prepare(`select id, project_id as projectId, job_id as jobId, dna_artifact_id as dnaArtifactId, kind, name, status, provider, prompt, preview_kind as previewKind, preview_url as previewUrl, preview_from as previewFrom, preview_to as previewTo, parent_artifact_id as parentArtifactId, created_at as createdAt, updated_at as updatedAt from creative_artifacts where owner_id = ? order by created_at desc limit 100`).bind(ownerId).all<ArtifactRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id, projectId: row.projectId, jobId: row.jobId, dnaArtifactId: row.dnaArtifactId, kind: row.kind,
    name: row.name, status: row.status, provider: row.provider, prompt: row.prompt,
    preview: { kind: row.previewKind, url: row.previewUrl, colors: [row.previewFrom, row.previewTo] },
    lineage: { sourceArtifactIds: [row.dnaArtifactId], parentArtifactId: row.parentArtifactId },
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }));
}

export async function listAcceptances(env: Env, ownerId: string): Promise<Acceptance[]> {
  const result = await env.DB.prepare(`select id, artifact_id as artifactId, decision, note, actor, created_at as createdAt from creative_acceptances where owner_id = ? order by created_at desc limit 200`).bind(ownerId).all<Acceptance>();
  return (result.results ?? []) as Acceptance[];
}

export async function reviewArtifact(env: Env, ownerId: string, artifactId: string, decision: AcceptanceDecision, note: string) {
  const current = await env.DB.prepare("select id from creative_artifacts where id = ? and owner_id = ?").bind(artifactId, ownerId).first<{ id: string }>();
  if (!current) throw new Error("artifact_not_found");
  const now = new Date().toISOString();
  const acceptance: Acceptance = { id: id("acceptance"), artifactId, decision, note: note.slice(0, 500), actor: "angelo", createdAt: now };
  const status = decision === "accepted" ? "accepted" : decision === "rejected" ? "rejected" : "archived";
  await env.DB.batch([
    env.DB.prepare("update creative_artifacts set status = ?, updated_at = ? where id = ? and owner_id = ?").bind(status, now, artifactId, ownerId),
    env.DB.prepare("insert into creative_acceptances (id, owner_id, artifact_id, decision, note, actor, created_at) values (?, ?, ?, ?, ?, ?, ?)").bind(acceptance.id, ownerId, artifactId, decision, acceptance.note, acceptance.actor, now),
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
  media: { bytes: ArrayBuffer; contentType: string; extension: string },
) {
  if (!env.ARTIFACTS) throw new Error("artifact_retention_not_configured");
  const current = await artifactMediaPath(env, ownerId, artifactId);
  if (!current) throw new Error("artifact_not_found");
  if (current.retainedKey) return current.retainedKey;
  const safeOwner = ownerId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  const key = `owners/${safeOwner}/artifacts/${artifactId}/${crypto.randomUUID()}.${media.extension}`;
  await env.ARTIFACTS.put(key, media.bytes, {
    httpMetadata: { contentType: media.contentType },
    customMetadata: { ownerId, artifactId, retainedAt: new Date().toISOString() },
  });
  let updated: D1Result;
  try {
    updated = await env.DB.prepare(`update creative_artifacts set retained_key = ?, retained_content_type = ?, retained_size = ?, updated_at = ?
      where id = ? and owner_id = ? and retained_key is null`)
      .bind(key, media.contentType, media.bytes.byteLength, new Date().toISOString(), artifactId, ownerId).run();
  } catch (error) {
    await env.ARTIFACTS.delete(key);
    throw error;
  }
  if (!updated.meta.changes) {
    await env.ARTIFACTS.delete(key);
    const winner = await artifactMediaPath(env, ownerId, artifactId);
    if (winner?.retainedKey) return winner.retainedKey;
    throw new Error("artifact_not_found");
  }
  return key;
}
