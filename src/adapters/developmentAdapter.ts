import {
  compileCreativeDna,
  type Acceptance,
  type AcceptanceDecision,
  type Artifact,
  type Capability,
  type CreateCreativeDnaRequest,
  type CreativeDnaArtifact,
  type Job,
  type Project,
  type ReviewArtifactResponse,
  type StudioSnapshot,
  type SubmitJobRequest,
} from "../../shared/contracts";
import type { StudioAdapter } from "./types";

const STORAGE_KEY = "creative-studio:development-adapter:v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

type DevelopmentState = {
  projects: Project[];
  dnaArtifacts: CreativeDnaArtifact[];
  jobs: Job[];
  artifacts: Artifact[];
  acceptances: Acceptance[];
};

type DevelopmentAdapterOptions = {
  storage?: StorageLike;
  now?: () => Date;
  id?: (prefix: string) => string;
};

function defaultId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function seedState(now: Date): DevelopmentState {
  const createdAt = now.toISOString();
  const projectBase = { createdAt, updatedAt: createdAt };
  const projects: Project[] = [
    {
      ...projectBase,
      id: "rebecca",
      name: "Rebecca",
      type: "Character System",
      status: "active",
      description: "Nonbinary alien character and identity system.",
      note: "Character Core groundwork in progress.",
      hue: "var(--violet)",
      initials: "RB",
    },
    {
      ...projectBase,
      id: "internet-dreams",
      name: "Internet Dreams",
      type: "Music / Visual",
      status: "active",
      description: "Music, covers, films, and nostalgic digital worlds.",
      note: "Cross-media DNA ready to evolve.",
      hue: "var(--pink)",
      initials: "ID",
    },
    {
      ...projectBase,
      id: "easynews",
      name: "EasyNews",
      type: "Broadcast System",
      status: "paused",
      description: "Scripts, segments, graphics, and broadcast packages.",
      note: "Paused after segment 07.",
      hue: "var(--cyan)",
      initials: "EN",
    },
  ];

  const dna = compileCreativeDna({
    name: "Internet Dreams — luminous memory",
    directive: "A nostalgic digital world that feels intimate, luminous, slightly degraded, and emotionally unresolved.",
    targetModality: "image",
    dimensions: { energy: 58, contrast: 72, warmth: 42, spaciousness: 76, polish: 64 },
  }, {
    artifactId: "dna_development_seed",
    version: 1,
    rootArtifactId: "dna_development_seed",
    parentArtifactId: null,
    createdAt,
  });

  const artifact: Artifact = {
    id: "artifact_development_seed",
    projectId: "internet-dreams",
    jobId: "job_development_seed",
    dnaArtifactId: dna.artifactId,
    kind: "image",
    name: "Luminous Memory Study",
    status: "accepted",
    provider: "development-renderer",
    prompt: dna.generationPrompts.image,
    preview: { kind: "development-gradient", url: null, colors: ["#6d28d9", "#db2777"] },
    lineage: { sourceArtifactIds: [dna.artifactId], parentArtifactId: null },
    createdAt,
    updatedAt: createdAt,
  };

  const job: Job = {
    id: "job_development_seed",
    projectId: "internet-dreams",
    dnaArtifactId: dna.artifactId,
    capability: "IMAGE_GENERATE",
    modality: "image",
    status: "completed",
    progress: 100,
    prompt: dna.generationPrompts.image,
    provider: "development-renderer",
    upstreamId: null,
    artifactId: artifact.id,
    error: null,
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
  };

  return {
    projects,
    dnaArtifacts: [dna],
    jobs: [job],
    artifacts: [artifact],
    acceptances: [{
      id: "acceptance_development_seed",
      artifactId: artifact.id,
      decision: "accepted",
      note: "Seeded visual-parity example in the development adapter.",
      actor: "development-user",
      createdAt,
    }],
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
        // A corrupt development snapshot is replaced with an explicit seed.
      }
    }
    const seeded = seedState(now());
    storage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
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
    async saveCreativeDna(input: CreateCreativeDnaRequest) {
      const state = read();
      const parent = input.parentArtifactId
        ? state.dnaArtifacts.find((item) => item.artifactId === input.parentArtifactId)
        : null;
      if (input.parentArtifactId && !parent) throw new Error("parent_artifact_not_found");
      if (!state.projects.some((project) => project.id === input.projectId)) throw new Error("project_not_found");
      const artifactId = makeId("dna");
      const artifact = compileCreativeDna(input, {
        artifactId,
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
      const dna = state.dnaArtifacts.find((item) => item.artifactId === input.dnaArtifactId);
      if (!dna) throw new Error("creative_dna_not_found");
      if (!state.projects.some((project) => project.id === input.projectId)) throw new Error("project_not_found");
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
        error: null,
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
      };
      state.jobs.unshift(job);
      write(state);
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
