import type {
  Acceptance,
  AcceptanceDecision,
  AdapterDescriptor,
  Artifact,
  Capability,
  GenerationModality,
  GenerationExecutionStage,
  ImagePerformanceMode,
  Job,
  MediaAsset,
  Project,
  StudioSession,
  CreativeTrainingExample,
  CreativeDnaTrainingJob,
  CreativeDnaTrainingReview,
  CreativeDnaTrainingReviewDecision,
  LocalRunner,
  VideoGenerationOperation,
  EvolutionJobContext,
  CreativeTasteMemory,
  EvolutionStudy,
  SongPromptEnhancementStamp,
} from "./domain";
import type { CreativeDnaArtifact, CreativeDnaInput, CreativeDnaTrainingAnalysis, VideoGenerationVariant } from "./creativeDna";
import type { ProjectProductionLoop } from "./productionLoop";
import type { ProductionCockpit } from "./productionCockpit";
import type { VideoDurationSeconds } from "./videoDuration";
import type { SaveWorkflowRevisionRequest, WorkflowDefinition } from "./workflows";

export const CREATIVE_STUDIO_API_PREFIX = "/api/creative-studio" as const;

export const CREATIVE_STUDIO_ROUTES = {
  snapshot: `${CREATIVE_STUDIO_API_PREFIX}/snapshot`,
  session: `${CREATIVE_STUDIO_API_PREFIX}/session`,
  projects: `${CREATIVE_STUDIO_API_PREFIX}/projects`,
  dna: `${CREATIVE_STUDIO_API_PREFIX}/dna`,
  jobs: `${CREATIVE_STUDIO_API_PREFIX}/jobs`,
  artifacts: `${CREATIVE_STUDIO_API_PREFIX}/artifacts`,
  media: `${CREATIVE_STUDIO_API_PREFIX}/media`,
  workflows: `${CREATIVE_STUDIO_API_PREFIX}/workflows`,
  trainingJobs: `${CREATIVE_STUDIO_API_PREFIX}/training-jobs`,
  productionLoops: `${CREATIVE_STUDIO_API_PREFIX}/production-loops`,
  productionCockpit: `${CREATIVE_STUDIO_API_PREFIX}/production-cockpit`,
  runners: `${CREATIVE_STUDIO_API_PREFIX}/runners`,
  runner: `${CREATIVE_STUDIO_API_PREFIX}/runner`,
  capabilities: `${CREATIVE_STUDIO_API_PREFIX}/capabilities`,
} as const;

export type CreativeStudioRoute =
  | "snapshot" | "session" | "projects" | "project-create" | "project-update" | "project-archive"
  | "dna-list" | "dna-create" | "jobs-list" | "jobs-create" | "job-retry" | "job-cancel"
  | "artifacts-list" | "artifact-review" | "artifact-media" | "artifact-thumbnail"
  | "media-list" | "media-upload" | "media-content" | "capabilities"
  | "workflows-list" | "workflow-import" | "workflow-revision-create" | "workflow-content" | "job-reuse"
  | "training-jobs-list" | "training-job-create" | "training-job-cancel" | "training-job-review" | "production-loops" | "production-cockpit"
  | "runners-list" | "runner-enroll" | "runner-revoke"
  | "runner-work-claim" | "runner-heartbeat" | "runner-job-claim" | "runner-job-heartbeat" | "runner-job-complete" | "runner-job-thumbnail" | "runner-job-fail" | "runner-media-content"
  | "runner-training-claim" | "runner-training-heartbeat" | "runner-training-complete" | "runner-training-fail";

export function matchCreativeStudioRoute(method: string, pathname: string): CreativeStudioRoute | null {
  if (method === "GET" && pathname === "/api/creative-studio/snapshot") return "snapshot";
  if (method === "GET" && pathname === "/api/creative-studio/session") return "session";
  if (method === "GET" && pathname === "/api/creative-studio/projects") return "projects";
  if (method === "POST" && pathname === "/api/creative-studio/projects") return "project-create";
  if (method === "PATCH" && /^\/api\/creative-studio\/projects\/[a-z0-9_]+$/i.test(pathname)) return "project-update";
  if (method === "POST" && /^\/api\/creative-studio\/projects\/[a-z0-9_]+\/archive$/i.test(pathname)) return "project-archive";
  if (method === "GET" && pathname === "/api/creative-studio/dna") return "dna-list";
  if (method === "POST" && pathname === "/api/creative-studio/dna") return "dna-create";
  if (method === "GET" && pathname === "/api/creative-studio/jobs") return "jobs-list";
  if (method === "POST" && pathname === "/api/creative-studio/jobs") return "jobs-create";
  if (method === "POST" && /^\/api\/creative-studio\/jobs\/[a-z0-9_]+\/retry$/i.test(pathname)) return "job-retry";
  if (method === "POST" && /^\/api\/creative-studio\/jobs\/[a-z0-9_]+\/cancel$/i.test(pathname)) return "job-cancel";
  if (method === "POST" && /^\/api\/creative-studio\/jobs\/[a-z0-9_]+\/reuse$/i.test(pathname)) return "job-reuse";
  if (method === "GET" && pathname === "/api/creative-studio/artifacts") return "artifacts-list";
  if (method === "GET" && /^\/api\/creative-studio\/artifacts\/[a-z0-9_]+\/media$/i.test(pathname)) return "artifact-media";
  if (method === "GET" && /^\/api\/creative-studio\/artifacts\/[a-z0-9_]+\/thumbnail$/i.test(pathname)) return "artifact-thumbnail";
  if (method === "POST" && /^\/api\/creative-studio\/artifacts\/[a-z0-9_]+\/(accepted|rejected|archived)$/i.test(pathname)) return "artifact-review";
  if (method === "GET" && pathname === "/api/creative-studio/media") return "media-list";
  if (method === "POST" && pathname === "/api/creative-studio/media") return "media-upload";
  if (method === "GET" && /^\/api\/creative-studio\/media\/[a-z0-9_]+\/content$/i.test(pathname)) return "media-content";
  if (method === "GET" && pathname === "/api/creative-studio/workflows") return "workflows-list";
  if (method === "POST" && pathname === "/api/creative-studio/workflows") return "workflow-import";
  if (method === "POST" && /^\/api\/creative-studio\/workflows\/[a-z0-9_]+\/revisions$/i.test(pathname)) return "workflow-revision-create";
  if (method === "GET" && /^\/api\/creative-studio\/workflows\/[a-z0-9_]+\/content$/i.test(pathname)) return "workflow-content";
  if (method === "GET" && pathname === "/api/creative-studio/training-jobs") return "training-jobs-list";
  if (method === "POST" && pathname === "/api/creative-studio/training-jobs") return "training-job-create";
  if (method === "POST" && /^\/api\/creative-studio\/training-jobs\/[a-z0-9_]+\/cancel$/i.test(pathname)) return "training-job-cancel";
  if (method === "POST" && /^\/api\/creative-studio\/training-jobs\/[a-z0-9_]+\/review$/i.test(pathname)) return "training-job-review";
  if (method === "GET" && pathname === "/api/creative-studio/production-loops") return "production-loops";
  if (method === "GET" && pathname === "/api/creative-studio/production-cockpit") return "production-cockpit";
  if (method === "GET" && pathname === "/api/creative-studio/runners") return "runners-list";
  if (method === "POST" && pathname === "/api/creative-studio/runners/enroll") return "runner-enroll";
  if (method === "POST" && /^\/api\/creative-studio\/runners\/[a-z0-9_]+\/revoke$/i.test(pathname)) return "runner-revoke";
  if (method === "POST" && pathname === "/api/creative-studio/runner/heartbeat") return "runner-heartbeat";
  if (method === "POST" && pathname === "/api/creative-studio/runner/work/claim") return "runner-work-claim";
  if (method === "POST" && pathname === "/api/creative-studio/runner/jobs/claim") return "runner-job-claim";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/jobs\/[a-z0-9_]+\/heartbeat$/i.test(pathname)) return "runner-job-heartbeat";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/jobs\/[a-z0-9_]+\/complete$/i.test(pathname)) return "runner-job-complete";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/jobs\/[a-z0-9_]+\/thumbnail$/i.test(pathname)) return "runner-job-thumbnail";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/jobs\/[a-z0-9_]+\/fail$/i.test(pathname)) return "runner-job-fail";
  if (method === "GET" && /^\/api\/creative-studio\/runner\/media\/[a-z0-9_]+$/i.test(pathname)) return "runner-media-content";
  if (method === "POST" && pathname === "/api/creative-studio/runner/training/claim") return "runner-training-claim";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/training\/[a-z0-9_]+\/heartbeat$/i.test(pathname)) return "runner-training-heartbeat";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/training\/[a-z0-9_]+\/complete$/i.test(pathname)) return "runner-training-complete";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/training\/[a-z0-9_]+\/fail$/i.test(pathname)) return "runner-training-fail";
  if (method === "GET" && pathname === "/api/creative-studio/capabilities") return "capabilities";
  return null;
}

export type StudioSnapshot = {
  adapter: AdapterDescriptor;
  session: StudioSession;
  projects: Project[];
  dnaArtifacts: CreativeDnaArtifact[];
  jobs: Job[];
  artifacts: Artifact[];
  mediaAssets: MediaAsset[];
  workflows: WorkflowDefinition[];
  trainingExamples: CreativeTrainingExample[];
  trainingJobs: CreativeDnaTrainingJob[];
  trainingReviews: CreativeDnaTrainingReview[];
  productionLoops: ProjectProductionLoop[];
  productionCockpit: ProductionCockpit;
  runners: LocalRunner[];
  capabilities: Capability[];
  acceptances: Acceptance[];
  tasteMemory?: CreativeTasteMemory;
  evolutionStudies?: EvolutionStudy[];
  refreshedAt: string;
};

export type CreateCreativeDnaRequest = CreativeDnaInput & {
  projectId: string;
  parentArtifactId?: string | null;
};

export type CreateProjectResponse = { project: Project };
export type UpdateProjectResponse = { project: Project };

export type CreateCreativeDnaResponse = {
  artifact: CreativeDnaArtifact;
};

export type SubmitJobRequest = {
  projectId: string;
  dnaArtifactId: string;
  modality: GenerationModality;
  idempotencyKey: string;
  provider?: "afdfw" | "development-preview";
  workflow?: {
    workflowId: string;
    revisionId: string;
    inputBindings: Record<string, string>;
    expectedPrompt: string;
  };
  performanceMode?: ImagePerformanceMode;
  videoDurationSeconds?: VideoDurationSeconds;
  videoVariant?: VideoGenerationVariant;
  videoOperation?: VideoGenerationOperation;
  evolution?: EvolutionJobContext;
};

export type SubmitJobResponse = {
  job: Job;
};

export type RetryJobRequest = { idempotencyKey: string };
export type RetryJobResponse = { job: Job };
export type CancelJobResponse = { job: Job };

export type ReviewArtifactRequest = {
  decision: AcceptanceDecision;
  note: string;
};

export type ReviewArtifactResponse = {
  artifact: Artifact;
  acceptance: Acceptance;
};

export type UploadMediaResponse = { asset: MediaAsset };
export type CreateCreativeDnaTrainingJobRequest = {
  projectId: string;
  baseDnaArtifactId?: string | null;
  name: string;
  targetModality: Exclude<GenerationModality, "video">;
  assetIds: string[];
  includeTrainingExamples: boolean;
  idempotencyKey: string;
};
export type CompleteCreativeDnaTrainingJobRequest = { runnerId: string; dna: CreativeDnaInput; analysis: CreativeDnaTrainingAnalysis };
export type FailCreativeDnaTrainingJobRequest = { runnerId: string; error: string };
export type CreativeDnaTrainingJobResponse = { trainingJob: CreativeDnaTrainingJob };
export type ReviewCreativeDnaTrainingRequest = { decision: CreativeDnaTrainingReviewDecision; note: string };
export type ReviewCreativeDnaTrainingResponse = {
  trainingJob: CreativeDnaTrainingJob;
  review: CreativeDnaTrainingReview;
  project: Project;
  artifact: CreativeDnaArtifact;
};
export type CreativeDnaTrainingBundleResponse = {
  trainingJob: CreativeDnaTrainingJob;
  baseDna: CreativeDnaArtifact | null;
  assets: MediaAsset[];
  trainingExamples: CreativeTrainingExample[];
  tasteMemory?: CreativeTasteMemory;
};
export type ImportWorkflowResponse = { workflow: WorkflowDefinition };
export type SaveWorkflowRevisionResponse = { workflow: WorkflowDefinition };
export type EnrollLocalRunnerRequest = { name: string };
export type EnrollLocalRunnerResponse = { runner: LocalRunner; token: string; apiBase: string };
export type RevokeLocalRunnerResponse = { runner: LocalRunner };

export type RunnerHeartbeatRequest = {
  version: string;
  comfyUrl: string;
  comfyVersion?: string | null;
  device?: string | null;
  activeJobId?: string | null;
  error?: string | null;
};

export type RunnerMediaInput = {
  id: string;
  projectId: string;
  kind: "image" | "audio" | "video";
  name: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  source: "upload" | "artifact";
};

export type RunnerJobBundle = {
  job: Job;
  workflow: WorkflowDefinition;
  graph: unknown;
  inputs: RunnerMediaInput[];
};

export type RunnerClaimJobResponse = { bundle: RunnerJobBundle | null };
export type RunnerWorkClaimResponse =
  | { kind: "generation"; bundle: RunnerJobBundle }
  | { kind: "training"; bundle: CreativeDnaTrainingBundleResponse }
  | { kind: null; bundle: null };
export type RunnerJobHeartbeatRequest = {
  progress: number;
  upstreamId?: string | null;
  stage?: GenerationExecutionStage;
  promptEnhancement?: SongPromptEnhancementStamp & { parameterId: string };
};
export type RunnerJobHeartbeatResponse = { continue: boolean; job: Job };
export type RunnerFailJobRequest = { error: string };
export type RunnerTrainingClaimResponse = { bundle: CreativeDnaTrainingBundleResponse | null };
export type RunnerTrainingHeartbeatRequest = { progress: number };
export type RunnerTrainingHeartbeatResponse = { continue: boolean; trainingJob: CreativeDnaTrainingJob };
export type RunnerCompleteTrainingRequest = { dna: CreativeDnaInput; analysis: CreativeDnaTrainingAnalysis };
export type { SaveWorkflowRevisionRequest };

export type ApiSuccess<T> = { ok: true } & T;
export type ApiFailure = { ok: false; error: string; message?: string };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
