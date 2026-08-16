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
  | "session" | "projects" | "dna-list" | "dna-create" | "jobs-list" | "jobs-create"
  | "artifacts-list" | "artifact-review" | "artifact-media" | "capabilities";

export function matchCreativeStudioRoute(method: string, pathname: string): CreativeStudioRoute | null {
  if (method === "GET" && pathname === "/api/creative-studio/session") return "session";
  if (method === "GET" && pathname === "/api/creative-studio/projects") return "projects";
  if (method === "GET" && pathname === "/api/creative-studio/dna") return "dna-list";
  if (method === "POST" && pathname === "/api/creative-studio/dna") return "dna-create";
  if (method === "GET" && pathname === "/api/creative-studio/jobs") return "jobs-list";
  if (method === "POST" && pathname === "/api/creative-studio/jobs") return "jobs-create";
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

export type CreateCreativeDnaResponse = {
  artifact: CreativeDnaArtifact;
};

export type SubmitJobRequest = {
  projectId: string;
  dnaArtifactId: string;
  modality: GenerationModality;
};

export type SubmitJobResponse = {
  job: Job;
};

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
