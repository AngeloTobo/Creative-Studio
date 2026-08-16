export type IsoDateString = string;

export type ProjectStatus = "active" | "paused" | "archived";

export type Project = {
  id: string;
  name: string;
  type: string;
  status: ProjectStatus;
  description: string;
  note: string;
  hue: string;
  initials: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
};

export const PROJECT_HUES = ["#d946ef", "#8b5cf6", "#22d3ee", "#14b8a6", "#f59e0b", "#fb7185"] as const;
export type ProjectHue = (typeof PROJECT_HUES)[number];

export type CreateProjectRequest = {
  name: string;
  type: string;
  description?: string;
  note?: string;
  hue?: ProjectHue;
};

export type UpdateProjectRequest = Partial<CreateProjectRequest> & {
  status?: Exclude<ProjectStatus, "archived">;
};

export type GenerationModality = "music" | "image";
export type GenerationCapability = "MUSIC_GENERATE" | "IMAGE_GENERATE";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type Job = {
  id: string;
  projectId: string;
  dnaArtifactId: string;
  capability: GenerationCapability;
  modality: GenerationModality;
  status: JobStatus;
  progress: number;
  prompt: string;
  provider: string;
  upstreamId: string | null;
  artifactId: string | null;
  retryOfJobId: string | null;
  error: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  completedAt: IsoDateString | null;
};

export type ArtifactStatus = "ready" | "accepted" | "rejected" | "archived";

export type Artifact = {
  id: string;
  projectId: string;
  jobId: string;
  dnaArtifactId: string;
  kind: GenerationModality;
  name: string;
  status: ArtifactStatus;
  provider: string;
  prompt: string;
  preview: {
    kind: "development-gradient" | "remote-media";
    url: string | null;
    colors: [string, string];
  };
  lineage: {
    sourceArtifactIds: string[];
    parentArtifactId: string | null;
  };
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
};

export type AcceptanceDecision = "accepted" | "rejected" | "archived";

export type Acceptance = {
  id: string;
  artifactId: string;
  decision: AcceptanceDecision;
  note: string;
  actor: "angelo" | "development-user";
  createdAt: IsoDateString;
};

export type CapabilityKey =
  | "creative-dna"
  | "music-generation"
  | "image-generation"
  | "artifact-review"
  | "artifact-retention"
  | "afdfw-session";

export type CapabilityState = "available" | "degraded" | "unavailable";

export type Capability = {
  key: CapabilityKey;
  label: string;
  state: CapabilityState;
  provider: string;
  detail: string;
  checkedAt: IsoDateString;
};

export type StudioSession = {
  status: "development" | "approved" | "logged_out" | "unavailable";
  userId: string | null;
  displayName: string;
};

export type AdapterDescriptor = {
  id: "development-local-storage" | "creative-studio-bff";
  label: string;
  development: boolean;
  durableScope: "browser" | "backend";
};
