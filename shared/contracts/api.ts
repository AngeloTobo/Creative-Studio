import type {
  Acceptance,
  AcceptanceDecision,
  AdapterDescriptor,
  Artifact,
  Capability,
  GenerationModality,
  Job,
  MediaAsset,
  Project,
  StudioSession,
  CreativeTrainingExample,
  CreativeDnaTrainingJob,
} from "./domain";
import type { CreativeDnaArtifact, CreativeDnaInput } from "./creativeDna";
import type { SaveWorkflowRevisionRequest, WorkflowDefinition } from "./workflows";

export const CREATIVE_STUDIO_API_PREFIX = "/api/creative-studio" as const;

export const CREATIVE_STUDIO_ROUTES = {
  session: `${CREATIVE_STUDIO_API_PREFIX}/session`,
  projects: `${CREATIVE_STUDIO_API_PREFIX}/projects`,
  dna: `${CREATIVE_STUDIO_API_PREFIX}/dna`,
  jobs: `${CREATIVE_STUDIO_API_PREFIX}/jobs`,
  artifacts: `${CREATIVE_STUDIO_API_PREFIX}/artifacts`,
  media: `${CREATIVE_STUDIO_API_PREFIX}/media`,
  workflows: `${CREATIVE_STUDIO_API_PREFIX}/workflows`,
  trainingJobs: `${CREATIVE_STUDIO_API_PREFIX}/training-jobs`,
  capabilities: `${CREATIVE_STUDIO_API_PREFIX}/capabilities`,
} as const;

export type CreativeStudioRoute =
  | "session" | "projects" | "project-create" | "project-update" | "project-archive"
  | "dna-list" | "dna-create" | "jobs-list" | "jobs-create" | "job-retry" | "job-cancel"
  | "artifacts-list" | "artifact-review" | "artifact-media"
  | "media-list" | "media-upload" | "media-content" | "capabilities"
  | "workflows-list" | "workflow-import" | "workflow-revision-create" | "workflow-content" | "job-reuse"
  | "training-jobs-list" | "training-job-create" | "training-job-cancel" | "training-job-claim" | "training-job-bundle" | "training-job-complete" | "training-job-fail";

export function matchCreativeStudioRoute(method: string, pathname: string): CreativeStudioRoute | null {
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
  if (method === "POST" && /^\/api\/creative-studio\/training-jobs\/[a-z0-9_]+\/claim$/i.test(pathname)) return "training-job-claim";
  if (method === "GET" && /^\/api\/creative-studio\/training-jobs\/[a-z0-9_]+\/bundle$/i.test(pathname)) return "training-job-bundle";
  if (method === "POST" && /^\/api\/creative-studio\/training-jobs\/[a-z0-9_]+\/complete$/i.test(pathname)) return "training-job-complete";
  if (method === "POST" && /^\/api\/creative-studio\/training-jobs\/[a-z0-9_]+\/fail$/i.test(pathname)) return "training-job-fail";
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
  capabilities: Capability[];
  acceptances: Acceptance[];
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
  targetModality: GenerationModality;
  assetIds: string[];
  includeTrainingExamples: boolean;
  idempotencyKey: string;
};
export type ClaimCreativeDnaTrainingJobRequest = { runnerId: string };
export type CompleteCreativeDnaTrainingJobRequest = { runnerId: string; dna: CreativeDnaInput };
export type FailCreativeDnaTrainingJobRequest = { runnerId: string; error: string };
export type CreativeDnaTrainingJobResponse = { trainingJob: CreativeDnaTrainingJob };
export type CreativeDnaTrainingBundleResponse = {
  trainingJob: CreativeDnaTrainingJob;
  baseDna: CreativeDnaArtifact | null;
  assets: MediaAsset[];
  trainingExamples: CreativeTrainingExample[];
};
export type ImportWorkflowResponse = { workflow: WorkflowDefinition };
export type SaveWorkflowRevisionResponse = { workflow: WorkflowDefinition };
export type { SaveWorkflowRevisionRequest };

export type ApiSuccess<T> = { ok: true } & T;
export type ApiFailure = { ok: false; error: string; message?: string };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
