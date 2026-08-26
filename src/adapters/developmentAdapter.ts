import {
  compileCreativeDna,
  compileCreativeTasteMemory,
  creativeDnaGenerationPrompt,
  creativeDnaReferenceAssetIds,
  deriveProductionCockpit,
  deriveEvolutionStudies,
  deriveProjectProductionLoop,
  PROJECT_HUES,
  resolveCreativeDnaGenerationArtifact,
  type Acceptance,
  type AcceptanceDecision,
  type Artifact,
  type Capability,
  type CreateCreativeDnaRequest,
  type CreateProjectRequest,
  type CreativeDnaArtifact,
  type CreativeTrainingExample,
  type CreativeDnaTrainingJob,
  type CreativeDnaTrainingReview,
  type GenerationSettingsStamp,
  type Job,
  type MediaAsset,
  type Project,
  type ReviewArtifactResponse,
  type StudioSnapshot,
  type SubmitJobRequest,
  type UpdateProjectRequest,
  type WorkflowDefinition,
} from "../../shared/contracts";
import type { StudioAdapter } from "./types";

const STORAGE_KEY = "creative-studio:development-adapter:v3";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

type DevelopmentState = {
  projects: Project[];
  dnaArtifacts: CreativeDnaArtifact[];
  jobs: Job[];
  artifacts: Artifact[];
  mediaAssets: MediaAsset[];
  acceptances: Acceptance[];
  workflows: WorkflowDefinition[];
  trainingExamples: CreativeTrainingExample[];
  trainingJobs: CreativeDnaTrainingJob[];
  trainingReviews: CreativeDnaTrainingReview[];
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
  return { projects: [], dnaArtifacts: [], jobs: [], artifacts: [], mediaAssets: [], workflows: [], trainingExamples: [], trainingJobs: [], trainingReviews: [], acceptances: [], idempotencyKeys: {} };
}

function normalizeJobTiming(job: Job): Job {
  const terminal = job.status === "completed" || job.status === "failed" || job.status === "cancelled";
  const stage = job.executionStage ?? (job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : job.status === "cancelled" ? "cancelled" : job.status === "running" ? "rendering" : "queued");
  return {
    ...job,
    startedAt: job.startedAt ?? (job.status === "running" || terminal ? job.createdAt : null),
    executionStage: stage,
    stageUpdatedAt: job.stageUpdatedAt ?? job.updatedAt,
  };
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
    { key: "media-library", label: "Media library", state: "unavailable", provider: "not connected", detail: "Real uploads require the Creative Studio Worker and R2; this adapter never simulates retained media.", checkedAt: now },
    { key: "workflow-library", label: "ComfyUI workflows", state: "unavailable", provider: "not connected", detail: "Workflow upload and immutable server revisions require the Creative Studio Worker.", checkedAt: now },
    { key: "creative-dna-training-data", label: "CreativeDNA training data", state: "degraded", provider: "development adapter", detail: "Candidate metadata is browser-only; no real media is presented as training-ready output.", checkedAt: now },
    { key: "creative-dna-training", label: "CreativeDNA training", state: "unavailable", provider: "not connected", detail: "Upload-based training requires the Creative Studio Worker and an authenticated local runner.", checkedAt: now },
    { key: "model-adapter-training", label: "ACE-Step music LoRA", state: "unavailable", provider: "not connected", detail: "Real LoRA training requires the Creative Studio Worker and a configured local ACE-Step 1.5 runtime. This development adapter never simulates a checkpoint.", checkedAt: now },
    { key: "music-generation", label: "Music generation", state: "degraded", provider: "development renderer", detail: "Durable job and artifact metadata; no real audio is rendered in this mode.", checkedAt: now },
    { key: "image-generation", label: "Image generation", state: "degraded", provider: "development renderer", detail: "Durable job and artifact metadata; gradients stand in for generated media.", checkedAt: now },
    { key: "afdfw-music-generation", label: "AFDFW music generation", state: "unavailable", provider: "not connected", detail: "Optional AFDFW remote generation is not available in the development adapter.", checkedAt: now },
    { key: "afdfw-image-generation", label: "AFDFW image generation", state: "unavailable", provider: "not connected", detail: "Optional AFDFW remote generation is not available in the development adapter.", checkedAt: now },
    { key: "artifact-review", label: "Artifact review", state: "available", provider: "development adapter", detail: "Accept, reject, and archive decisions persist in this browser.", checkedAt: now },
    { key: "artifact-retention", label: "Artifact retention", state: "degraded", provider: "browser storage", detail: "Metadata survives reloads in this browser; production retention belongs in the BFF.", checkedAt: now },
    { key: "afdfw-session", label: "AFDFW backend", state: "unavailable", provider: "not connected", detail: "Use the HTTP adapter and configure the Worker to connect the allowlisted backend.", checkedAt: now },
  ];
}

function snapshot(state: DevelopmentState, now: string): StudioSnapshot {
  const projects = state.projects.map((project) => ({ ...project, activeDnaArtifactId: project.activeDnaArtifactId ?? null }));
  const artifacts = [...state.artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const acceptances = [...state.acceptances].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const trainingReviews = [...(state.trainingReviews ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    adapter: {
      id: "development-local-storage",
      label: "Development adapter · browser-persistent",
      development: true,
      durableScope: "browser",
    },
    session: { status: "development", userId: "development-angelo", displayName: "Angelo" },
    projects,
    dnaArtifacts: [...state.dnaArtifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    jobs: [...state.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    artifacts,
    mediaAssets: [...(state.mediaAssets ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    workflows: [...(state.workflows ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    trainingExamples: [...(state.trainingExamples ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    trainingJobs: [...(state.trainingJobs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    trainingReviews,
    modelTrainingJobs: [],
    modelAdapters: [],
    modelAdapterReviews: [],
    productionLoops: projects.map((project) => deriveProjectProductionLoop({
      project,
      dnaArtifacts: state.dnaArtifacts,
      jobs: state.jobs,
      artifacts: state.artifacts,
      trainingExamples: state.trainingExamples ?? [],
      trainingJobs: state.trainingJobs ?? [],
      trainingReviews: state.trainingReviews ?? [],
      computedAt: now,
    })),
    productionCockpit: deriveProductionCockpit({
      projects,
      dnaArtifacts: state.dnaArtifacts,
      jobs: state.jobs,
      artifacts: state.artifacts,
      mediaAssets: state.mediaAssets ?? [],
      acceptances: state.acceptances,
      trainingJobs: state.trainingJobs ?? [],
      trainingReviews: state.trainingReviews ?? [],
      runners: [],
      computedAt: now,
    }),
    runners: [],
    capabilities: capabilitySnapshot(now),
    acceptances,
    tasteMemory: compileCreativeTasteMemory({ projects, artifacts, acceptances, trainingReviews, dnaArtifacts: state.dnaArtifacts }),
    evolutionStudies: deriveEvolutionStudies(state.jobs, artifacts),
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
        const state = { ...emptyState(), ...(JSON.parse(raw) as Partial<DevelopmentState>) };
        state.dnaArtifacts = state.dnaArtifacts.map(resolveCreativeDnaGenerationArtifact);
        state.jobs = state.jobs.map(normalizeJobTiming);
        return state;
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
        job.startedAt = current.toISOString();
        job.executionStage = "rendering";
        job.stageUpdatedAt = current.toISOString();
        job.updatedAt = current.toISOString();
        changed = true;
      }
      if (age >= 3_200) {
        job.status = "completed";
        job.progress = 100;
        job.executionStage = "completed";
        job.stageUpdatedAt = current.toISOString();
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
            retention: { state: "development-only", size: null },
            settingsStamp: job.settingsStamp,
            createdAt: current.toISOString(),
            updatedAt: current.toISOString(),
          };
          job.artifactId = artifactId;
          state.artifacts.unshift(artifact);
          state.trainingExamples.unshift({
            id: makeId("trainingexample"), projectId: job.projectId, dnaArtifactId: job.dnaArtifactId,
            artifactId, kind: job.modality, status: "candidate", prompt: job.prompt,
            settingsStamp: job.settingsStamp, createdAt: current.toISOString(), updatedAt: current.toISOString(),
          });
        }
        changed = true;
      }
    }
    if (changed) write(state);
    return state;
  };

  const addJob = (state: DevelopmentState, input: SubmitJobRequest, retryOfJobId: string | null) => {
    if (input.modality === "video") throw new Error("video_workflow_requires_creative_studio_worker");
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
    const prompt = creativeDnaGenerationPrompt(dna, input.modality);
    const settingsStamp: GenerationSettingsStamp = {
      schemaVersion: 1, source: "creative-dna", createdAt, reusedFromJobId: retryOfJobId,
      prompt, provider: "development-renderer", modality: input.modality, workflow: null,
      parameters: { prompt }, models: [], inputAssetIds: [],
    };
    const job: Job = {
      id: makeId("job"),
      projectId: input.projectId,
      dnaArtifactId: dna.artifactId,
      capability: input.modality === "music" ? "MUSIC_GENERATE" : "IMAGE_GENERATE",
      modality: input.modality,
      status: "queued",
      progress: 4,
      prompt,
      provider: "development-renderer",
      upstreamId: null,
      artifactId: null,
      retryOfJobId,
      error: null,
      createdAt,
      updatedAt: createdAt,
      startedAt: null,
      executionStage: "queued",
      stageUpdatedAt: createdAt,
      completedAt: null,
      settingsStamp,
    };
    state.jobs.unshift(job);
    state.idempotencyKeys[input.idempotencyKey] = job.id;
    write(state);
    return job;
  };

  return {
    id: "development-local-storage",
    activePollIntervalMs: 1_000,
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
        activeDnaArtifactId: null,
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
      if (input.sourceKind === "owner_uploads") {
        const referenceAssetIds = creativeDnaReferenceAssetIds(input.referenceAssetIds);
        if (!referenceAssetIds.length) throw new Error("reference_assets_required");
        const assets = referenceAssetIds.map((assetId) => state.mediaAssets.find((asset) => asset.id === assetId));
        if (assets.some((asset) => !asset || asset.status !== "retained")) throw new Error("reference_asset_not_found");
        if (assets.some((asset) => asset?.projectId !== input.projectId)) throw new Error("reference_asset_project_mismatch");
      }
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
      project.activeDnaArtifactId = artifact.artifactId;
      project.updatedAt = artifact.createdAt;
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
    async reuseJob(jobId: string, idempotencyKey: string) {
      const state = read();
      const original = state.jobs.find((item) => item.id === jobId);
      if (!original) throw new Error("job_not_found");
      const reused = addJob(state, {
        projectId: original.projectId,
        dnaArtifactId: original.dnaArtifactId,
        modality: original.modality,
        idempotencyKey,
      }, null);
      reused.prompt = original.settingsStamp.prompt;
      reused.settingsStamp = { ...original.settingsStamp, createdAt: now().toISOString(), reusedFromJobId: original.id, provider: reused.provider, evolution: undefined };
      write(state);
      return reused;
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
        job.executionStage = "cancelled";
        job.stageUpdatedAt = cancelledAt;
        job.updatedAt = cancelledAt;
        job.completedAt = cancelledAt;
        write(state);
      }
      return job;
    },
    async reviewArtifact(artifactId: string, decision: AcceptanceDecision, note: string): Promise<ReviewArtifactResponse> {
      const state = reconcile(read());
      const artifact = state.artifacts.find((item) => item.id === artifactId);
      if (!artifact) throw new Error("artifact_not_found");
      const reviewNote = note.trim().slice(0, 500);
      if ((decision === "accepted" || decision === "rejected") && !reviewNote) throw new Error("review_note_required");
      const createdAt = now().toISOString();
      artifact.status = decision === "accepted" ? "accepted" : decision === "rejected" ? "rejected" : "archived";
      artifact.updatedAt = createdAt;
      const acceptance: Acceptance = {
        id: makeId("acceptance"),
        artifactId,
        decision,
        note: reviewNote,
        actor: "development-user",
        createdAt,
      };
      state.acceptances.unshift(acceptance);
      const example = state.trainingExamples.find((item) => item.artifactId === artifactId);
      if (example && decision !== "archived") {
        example.status = decision === "accepted" ? "training-ready" : "excluded";
        example.updatedAt = createdAt;
      }
      write(state);
      return { artifact, acceptance };
    },
    async uploadMedia() {
      throw new Error("media_upload_requires_creative_studio_worker");
    },
    async uploadWorkflow() {
      throw new Error("workflow_upload_requires_creative_studio_worker");
    },
    async saveWorkflowRevision() {
      throw new Error("workflow_revision_requires_creative_studio_worker");
    },
    async startCreativeDnaTraining() {
      throw new Error("creative_dna_training_requires_creative_studio_worker");
    },
    async cancelCreativeDnaTraining() {
      throw new Error("creative_dna_training_requires_creative_studio_worker");
    },
    async reviewCreativeDnaTraining() {
      throw new Error("creative_dna_training_requires_creative_studio_worker");
    },
    async startModelTraining() {
      throw new Error("real_model_training_requires_creative_studio_worker");
    },
    async cancelModelTraining() {
      throw new Error("real_model_training_requires_creative_studio_worker");
    },
    async reviewModelTrainingDataset() {
      throw new Error("real_model_training_requires_creative_studio_worker");
    },
    async reviewModelAdapter() {
      throw new Error("real_model_training_requires_creative_studio_worker");
    },
    async enrollLocalRunner() {
      throw new Error("runner_enrollment_requires_creative_studio_worker");
    },
    async revokeLocalRunner() {
      throw new Error("runner_enrollment_requires_creative_studio_worker");
    },
  };
}
