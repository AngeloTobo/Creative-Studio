import {
  CREATIVE_STUDIO_ROUTES,
  type AcceptanceDecision,
  type ApiResult,
  type Artifact,
  type Capability,
  type CreateCreativeDnaRequest,
  type CreateCreativeDnaResponse,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type CreativeDnaArtifact,
  type Job,
  type Project,
  type ReviewArtifactResponse,
  type RetryJobResponse,
  type StudioSession,
  type StudioSnapshot,
  type SubmitJobRequest,
  type SubmitJobResponse,
  type UpdateProjectRequest,
  type UpdateProjectResponse,
} from "../../shared/contracts";
import type { StudioAdapter } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as ApiResult<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `http_${response.status}` : payload.error);
  }
  return payload;
}

export function createHttpAdapter(): StudioAdapter {
  const load = async (): Promise<StudioSnapshot> => {
    const [session, projects, dna, jobs, artifacts, capabilities] = await Promise.all([
      request<{ session: StudioSession }>(CREATIVE_STUDIO_ROUTES.session),
      request<{ projects: Project[] }>(CREATIVE_STUDIO_ROUTES.projects),
      request<{ artifacts: CreativeDnaArtifact[] }>(CREATIVE_STUDIO_ROUTES.dna),
      request<{ jobs: Job[] }>(CREATIVE_STUDIO_ROUTES.jobs),
      request<{ artifacts: Artifact[]; acceptances: StudioSnapshot["acceptances"] }>(CREATIVE_STUDIO_ROUTES.artifacts),
      request<{ capabilities: Capability[] }>(CREATIVE_STUDIO_ROUTES.capabilities),
    ]);
    return {
      adapter: { id: "creative-studio-bff", label: "Creative Studio Worker", development: false, durableScope: "backend" },
      session: session.session,
      projects: projects.projects,
      dnaArtifacts: dna.artifacts,
      jobs: jobs.jobs,
      artifacts: artifacts.artifacts,
      acceptances: artifacts.acceptances,
      capabilities: capabilities.capabilities,
      refreshedAt: new Date().toISOString(),
    };
  };

  return {
    id: "creative-studio-bff",
    load,
    refresh: load,
    async createProject(input: CreateProjectRequest) {
      const result = await request<CreateProjectResponse>(CREATIVE_STUDIO_ROUTES.projects, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return result.project;
    },
    async updateProject(projectId: string, input: UpdateProjectRequest) {
      const result = await request<UpdateProjectResponse>(`${CREATIVE_STUDIO_ROUTES.projects}/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      return result.project;
    },
    async archiveProject(projectId: string) {
      const result = await request<UpdateProjectResponse>(`${CREATIVE_STUDIO_ROUTES.projects}/${encodeURIComponent(projectId)}/archive`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return result.project;
    },
    async saveCreativeDna(input: CreateCreativeDnaRequest) {
      const result = await request<CreateCreativeDnaResponse>(CREATIVE_STUDIO_ROUTES.dna, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return result.artifact;
    },
    async submitJob(input: SubmitJobRequest) {
      const result = await request<SubmitJobResponse>(CREATIVE_STUDIO_ROUTES.jobs, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return result.job;
    },
    async retryJob(jobId: string, idempotencyKey: string) {
      const result = await request<RetryJobResponse>(`${CREATIVE_STUDIO_ROUTES.jobs}/${encodeURIComponent(jobId)}/retry`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey }),
      });
      return result.job;
    },
    async cancelJob(jobId: string) {
      const result = await request<SubmitJobResponse>(`${CREATIVE_STUDIO_ROUTES.jobs}/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return result.job;
    },
    async reviewArtifact(artifactId: string, decision: AcceptanceDecision, note = "") {
      return request<ReviewArtifactResponse>(`${CREATIVE_STUDIO_ROUTES.artifacts}/${encodeURIComponent(artifactId)}/${decision}`, {
        method: "POST",
        body: JSON.stringify({ decision, note }),
      });
    },
  };
}
