import type {
  Acceptance,
  AcceptanceDecision,
  AdapterDescriptor,
  Artifact,
  Capability,
  GenerationModality,
  Job,
  Project,
  StudioSession,
} from "./domain";
import type { CreativeDnaArtifact, CreativeDnaInput } from "./creativeDna";

export const CREATIVE_STUDIO_API_PREFIX = "/api/creative-studio" as const;

export const CREATIVE_STUDIO_ROUTES = {
  session: `${CREATIVE_STUDIO_API_PREFIX}/session`,
  projects: `${CREATIVE_STUDIO_API_PREFIX}/projects`,
  dna: `${CREATIVE_STUDIO_API_PREFIX}/dna`,
  jobs: `${CREATIVE_STUDIO_API_PREFIX}/jobs`,
  artifacts: `${CREATIVE_STUDIO_API_PREFIX}/artifacts`,
  capabilities: `${CREATIVE_STUDIO_API_PREFIX}/capabilities`,
} as const;

export type CreativeStudioRoute =
  | "session" | "projects" | "project-create" | "project-update" | "project-archive"
  | "dna-list" | "dna-create" | "jobs-list" | "jobs-create" | "job-retry" | "job-cancel"
  | "artifacts-list" | "artifact-review" | "artifact-media" | "capabilities";

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
  if (method === "GET" && pathname === "/api/creative-studio/artifacts") return "artifacts-list";
  if (method === "GET" && /^\/api\/creative-studio\/artifacts\/[a-z0-9_]+\/media$/i.test(pathname)) return "artifact-media";
  if (method === "POST" && /^\/api\/creative-studio\/artifacts\/[a-z0-9_]+\/(accepted|rejected|archived)$/i.test(pathname)) return "artifact-review";
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
  note?: string;
};

export type ReviewArtifactResponse = {
  artifact: Artifact;
  acceptance: Acceptance;
};

export type ApiSuccess<T> = { ok: true } & T;
export type ApiFailure = { ok: false; error: string; message?: string };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
