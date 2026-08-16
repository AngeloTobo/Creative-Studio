import {
  compileCreativeDna,
  PROJECT_HUES,
  type Acceptance,
  type AcceptanceDecision,
  type Artifact,
  type Capability,
  type CreateCreativeDnaRequest,
  type CreateProjectRequest,
  type CreativeDnaArtifact,
  type Job,
  type Project,
  type ReviewArtifactResponse,
  type StudioSnapshot,
  type SubmitJobRequest,
  type UpdateProjectRequest,
} from "../../shared/contracts";
import type { StudioAdapter } from "./types";

const STORAGE_KEY = "creative-studio:development-adapter:v3";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

type DevelopmentState = {
  projects: Project[];
  dnaArtifacts: CreativeDnaArtifact[];
  jobs: Job[];
  artifacts: Artifact[];
  acceptances: Acceptance[];
  idempotencyKeys: Record<string, string>;
};

type DevelopmentAdapterOptions = {
  storage?: StorageLike;
  now?: () => Date;
  id?: (prefix: string) => string;
};

function defaultId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function emptyState(): DevelopmentState {
  return { projects: [], dnaArtifacts: [], jobs: [], artifacts: [], acceptances: [], idempotencyKeys: {} };
}

function cleanText(value: unknown, limit: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function projectInitials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  const value = words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2);
  return (value || "CS").toUpperCase();
}

function projectValues(input: CreateProjectRequest) {
  const name = cleanText(input.name, 80);
  const type = cleanText(input.type, 80);
  if (!name) throw new Error("project_name_required");
  if (!type) throw new Error("project_type_required");
  const hue = input.hue ?? PROJECT_HUES[0];
  if (!(PROJECT_HUES as readonly string[]).includes(hue)) throw new Error("invalid_project_hue");
  return {
    name,
    type,
    description: cleanText(input.description, 500),
    note: cleanText(input.note, 250),
    hue,
    initials: projectInitials(name),
  };
}

function capabilitySnapshot(now: string): Capability[] {
  return [
    { key: "creative-dna", label: "CreativeDNA v1", state: "available", provider: "deterministic compiler", detail: "Versioned locally in the development adapter.", checkedAt: now },
    { key: "music-generation", label: "Music generation", state: "degraded", provider: "development renderer", detail: "Durable job and artifact metadata; no real audio is rendered in this mode.", checkedAt: now },
    { key: "image-generation", label: "Image generation", state: "degraded", provider: "development renderer", detail: "Durable job and artifact metadata; gradients stand in for generated media.", checkedAt: now },
    { key: "artifact-review", label: "Artifact review", state: "available", provider: "development adapter", detail: "Accept, reject, and archive decisions persist in this browser.", checkedAt: now },
    { key: "artifact-retention", label: "Artifact retention", state: "degraded", provider: "browser storage", detail: "Metadata survives reloads in this browser; production retention belongs in the BFF.", checkedAt: now },
    { key: "afdfw-session", label: "AFDFW backend", state: "unavailable", provider: "not connected", detail: "Use the HTTP adapter and configure the Worker to connect the allowlisted backend.", checkedAt: now },
  ];
}

function snapshot(state: DevelopmentState, now: string): StudioSnapshot {
  return {
    adapter: {
      id: "development-local-storage",
      label: "Development adapter · browser-persistent",
      development: true,
      durableScope: "browser",
    },
    session: { status: "development", userId: "development-angelo", displayName: "Angelo" },
    projects: state.projects,
    dnaArtifacts: [...state.dnaArtifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    jobs: [...state.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    artifacts: [...state.artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    capabilities: capabilitySnapshot(now),
    acceptances: [...state.acceptances].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    refreshedAt: now,
  };
}

export function createDevelopmentAdapter(options: DevelopmentAdapterOptions = {}): StudioAdapter {
  const storage = options.storage ?? window.localStorage;
  const now = options.now ?? (() => new Date());
  const makeId = options.id ?? defaultId;

  const read = (): DevelopmentState => {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as DevelopmentState;
      } catch {
        // A corrupt development snapshot is replaced with an empty state.
      }
    }
    const empty = emptyState();
    storage.setItem(STORAGE_KEY, JSON.stringify(empty));
    return empty;
  };

  const write = (state: DevelopmentState) => {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  };

  const reconcile = (state: DevelopmentState) => {
    const current = now();
    let changed = false;
    for (const job of state.jobs) {
      if (job.status !== "queued" && job.status !== "running") continue;
      const age = current.getTime() - new Date(job.createdAt).getTime();
      if (age >= 1_000 && job.status === "queued") {
        job.status = "running";
        job.progress = Math.max(job.progress, 42);
        job.updatedAt = current.toISOString();
        changed = true;
      }
      if (age >= 3_200) {
        job.status = "completed";
        job.progress = 100;
        job.completedAt = current.toISOString();
        job.updatedAt = current.toISOString();
        if (!job.artifactId) {
          const artifactId = makeId("artifact");
          const dna = state.dnaArtifacts.find((item) => item.artifactId === job.dnaArtifactId);
          const colors: [string, string] = job.modality === "music"
            ? ["#9d174d", "#7c3aed"]
            : ["#0e7490", "#a21caf"];
          const artifact: Artifact = {
            id: artifactId,
            projectId: job.projectId,
            jobId: job.id,
            dnaArtifactId: job.dnaArtifactId,
            kind: job.modality,
            name: dna?.name ?? `${job.modality} artifact`,
            status: "ready",
            provider: job.provider,
            prompt: job.prompt,
            preview: { kind: "development-gradient", url: null, colors },
            lineage: { sourceArtifactIds: [job.dnaArtifactId], parentArtifactId: null },
            createdAt: current.toISOString(),
            updatedAt: current.toISOString(),
          };
          job.artifactId = artifactId;
          state.artifacts.unshift(artifact);
        }
        changed = true;
      }
    }
    if (changed) write(state);
    return state;
  };

  const addJob = (state: DevelopmentState, input: SubmitJobRequest, retryOfJobId: string | null) => {
    const duplicateId = state.idempotencyKeys[input.idempotencyKey];
    const duplicate = duplicateId ? state.jobs.find((item) => item.id === duplicateId) : null;
    if (duplicate) return duplicate;
    const dna = state.dnaArtifacts.find((item) => item.artifactId === input.dnaArtifactId);
    if (!dna) throw new Error("creative_dna_not_found");
    if (dna.projectId !== input.projectId) throw new Error("dna_project_mismatch");
    const project = state.projects.find((item) => item.id === input.projectId);
    if (!project) throw new Error("project_not_found");
    if (project.status === "archived") throw new Error("project_archived");
    const createdAt = now().toISOString();
    const job: Job = {
      id: makeId("job"),
      projectId: input.projectId,
      dnaArtifactId: dna.artifactId,
      capability: input.modality === "music" ? "MUSIC_GENERATE" : "IMAGE_GENERATE",
      modality: input.modality,
      status: "queued",
      progress: 4,
      prompt: dna.generationPrompts[input.modality],
      provider: "development-renderer",
      upstreamId: null,
      artifactId: null,
      retryOfJobId,
      error: null,
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
    };
    state.jobs.unshift(job);
    state.idempotencyKeys[input.idempotencyKey] = job.id;
    write(state);
    return job;
  };

  return {
    id: "development-local-storage",
    async load() {
      const current = now().toISOString();
      return snapshot(reconcile(read()), current);
    },
    async refresh() {
      const current = now().toISOString();
      return snapshot(reconcile(read()), current);
    },
    async createProject(input: CreateProjectRequest) {
      const state = read();
      const createdAt = now().toISOString();
      const project: Project = {
        id: makeId("project"),
        status: "active",
        ...projectValues(input),
        createdAt,
        updatedAt: createdAt,
      };
      state.projects.push(project);
      write(state);
      return project;
    },
    async updateProject(projectId: string, input: UpdateProjectRequest) {
      const state = read();
      const index = state.projects.findIndex((project) => project.id === projectId);
      if (index < 0) throw new Error("project_not_found");
      const current = state.projects[index];
      if (current.status === "archived") throw new Error("project_archived");
      const status = input.status ?? current.status;
      if (status !== "active" && status !== "paused") throw new Error("invalid_project_status");
      const project: Project = {
        ...current,
        ...projectValues({
          name: input.name ?? current.name,
          type: input.type ?? current.type,
          description: input.description ?? current.description,
          note: input.note ?? current.note,
          hue: input.hue ?? (current.hue as CreateProjectRequest["hue"]),
        }),
        status,
        updatedAt: now().toISOString(),
      };
      state.projects[index] = project;
      write(state);
      return project;
    },
    async archiveProject(projectId: string) {
      const state = read();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) throw new Error("project_not_found");
      project.status = "archived";
      project.updatedAt = now().toISOString();
      write(state);
      return project;
    },
    async saveCreativeDna(input: CreateCreativeDnaRequest) {
      const state = read();
      const parent = input.parentArtifactId
        ? state.dnaArtifacts.find((item) => item.artifactId === input.parentArtifactId)
        : null;
      if (input.parentArtifactId && !parent) throw new Error("parent_artifact_not_found");
      if (parent && parent.projectId !== input.projectId) throw new Error("parent_project_mismatch");
      const project = state.projects.find((item) => item.id === input.projectId);
      if (!project) throw new Error("project_not_found");
      if (project.status === "archived") throw new Error("project_archived");
      const artifactId = makeId("dna");
      const artifact = compileCreativeDna(input, {
        artifactId,
        projectId: input.projectId,
        version: parent ? parent.version + 1 : 1,
        rootArtifactId: parent?.lineage.rootArtifactId ?? artifactId,
        parentArtifactId: parent?.artifactId ?? null,
        createdAt: now().toISOString(),
      });
      state.dnaArtifacts.unshift(artifact);
      write(state);
      return artifact;
    },
    async submitJob(input: SubmitJobRequest) {
      const state = read();
      return addJob(state, input, null);
    },
    async retryJob(jobId: string, idempotencyKey: string) {
      const state = read();
      const original = state.jobs.find((item) => item.id === jobId);
      if (!original) throw new Error("job_not_found");
      if (original.status !== "failed" && original.status !== "cancelled") throw new Error("job_not_retryable");
      return addJob(state, {
        projectId: original.projectId,
        dnaArtifactId: original.dnaArtifactId,
        modality: original.modality,
        idempotencyKey,
      }, original.id);
    },
    async cancelJob(jobId: string) {
      const state = read();
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job) throw new Error("job_not_found");
      if (job.status === "completed" || job.status === "failed") throw new Error("job_not_cancellable");
      if (job.status !== "cancelled") {
        const cancelledAt = now().toISOString();
        job.status = "cancelled";
        job.error = "cancelled_by_user";
        job.updatedAt = cancelledAt;
        job.completedAt = cancelledAt;
        write(state);
      }
      return job;
    },
    async reviewArtifact(artifactId: string, decision: AcceptanceDecision, note = ""): Promise<ReviewArtifactResponse> {
      const state = reconcile(read());
      const artifact = state.artifacts.find((item) => item.id === artifactId);
      if (!artifact) throw new Error("artifact_not_found");
      const createdAt = now().toISOString();
      artifact.status = decision === "accepted" ? "accepted" : decision === "rejected" ? "rejected" : "archived";
      artifact.updatedAt = createdAt;
      const acceptance: Acceptance = {
        id: makeId("acceptance"),
        artifactId,
        decision,
        note: note.trim().slice(0, 500),
        actor: "development-user",
        createdAt,
      };
      state.acceptances.unshift(acceptance);
      write(state);
      return { artifact, acceptance };
    },
  };
}
