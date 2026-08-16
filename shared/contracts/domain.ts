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

export type GenerationModality = "music" | "image" | "video";
export type GenerationCapability = "MUSIC_GENERATE" | "IMAGE_GENERATE" | "VIDEO_GENERATE";
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
  settingsStamp: GenerationSettingsStamp;
};

export type GenerationSettingsStamp = {
  schemaVersion: 1;
  source: "creative-dna" | "comfyui-workflow";
  createdAt: IsoDateString;
  reusedFromJobId: string | null;
  prompt: string;
  provider: string;
  modality: string;
  workflow: null | {
    workflowId: string;
    revisionId: string;
    version: number;
    name: string;
    format: "comfyui-api" | "comfyui-ui";
    contentHash: string;
  };
  parameters: Record<string, string | number | boolean>;
  models: string[];
  inputAssetIds: string[];
  inputArtifactIds?: string[];
  inputSources?: Array<{
    id: string;
    source: "upload" | "artifact";
    kind: MediaKind;
  }>;
  inputBindings?: Record<string, string>;
};

export type ArtifactStatus = "retaining" | "ready" | "accepted" | "rejected" | "archived";

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
  retention: {
    state: "development-only" | "pending" | "retained";
    size: number | null;
  };
  settingsStamp: GenerationSettingsStamp;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
};

export type CreativeTrainingExample = {
  id: string;
  projectId: string;
  dnaArtifactId: string;
  artifactId: string;
  kind: string;
  status: "candidate" | "training-ready" | "excluded";
  prompt: string;
  settingsStamp: GenerationSettingsStamp;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
};

export type CreativeDnaTrainingStatus = "waiting-for-runner" | "running" | "completed" | "failed" | "cancelled";

export type CreativeDnaTrainingJob = {
  id: string;
  projectId: string;
  baseDnaArtifactId: string | null;
  resultDnaArtifactId: string | null;
  name: string;
  targetModality: Exclude<GenerationModality, "video">;
  status: CreativeDnaTrainingStatus;
  progress: number;
  provider: "local-creative-dna-runner";
  assetIds: string[];
  trainingExampleIds: string[];
  runnerId: string | null;
  error: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  startedAt: IsoDateString | null;
  completedAt: IsoDateString | null;
};

export type MediaKind = "image" | "audio" | "video";

export type MediaAsset = {
  id: string;
  projectId: string;
  kind: MediaKind;
  name: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  source: "upload";
  status: "retained";
  contentUrl: string;
  trainingEligible: boolean;
  provenance: {
    uploadedByOwner: true;
    uploadedAt: IsoDateString;
    parentAssetIds: string[];
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
  | "media-library"
  | "music-generation"
  | "image-generation"
  | "video-generation"
  | "local-runner"
  | "artifact-review"
  | "artifact-retention"
  | "afdfw-session"
  | "workflow-library"
  | "creative-dna-training-data"
  | "creative-dna-training";

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

export type LocalRunnerState = "offline" | "online" | "busy" | "revoked";

export type LocalRunner = {
  id: string;
  name: string;
  state: LocalRunnerState;
  version: string | null;
  comfyUrl: string | null;
  comfyVersion: string | null;
  device: string | null;
  activeJobId: string | null;
  lastError: string | null;
  lastHeartbeatAt: IsoDateString | null;
  createdAt: IsoDateString;
  revokedAt: IsoDateString | null;
};
