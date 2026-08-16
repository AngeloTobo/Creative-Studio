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
  type MediaAsset,
  type Project,
  type ReviewArtifactResponse,
  type RetryJobResponse,
  type StudioSession,
  type StudioSnapshot,
  type SubmitJobRequest,
  type SubmitJobResponse,
  type UpdateProjectRequest,
  type UpdateProjectResponse,
  type UploadMediaResponse,
  type CreativeTrainingExample,
  type ImportWorkflowResponse,
  type SaveWorkflowRevisionRequest,
  type SaveWorkflowRevisionResponse,
  type WorkflowDefinition,
  type CreativeDnaTrainingJob,
  type CreateCreativeDnaTrainingJobRequest,
  type CreativeDnaTrainingJobResponse,
  type LocalRunner,
  type EnrollLocalRunnerResponse,
  type RevokeLocalRunnerResponse,
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

async function uploadRequest(file: File, projectId: string, trainingEligible: boolean) {
  const response = await fetch(CREATIVE_STUDIO_ROUTES.media, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": file.type,
      "x-cs-project-id": projectId,
      "x-cs-file-name": encodeURIComponent(file.name),
      "x-cs-file-size": String(file.size),
      "x-cs-training-eligible": String(trainingEligible),
    },
    body: file,
  });
  const payload = await response.json() as ApiResult<UploadMediaResponse>;
  if (!response.ok || !payload.ok) throw new Error(payload.ok ? `http_${response.status}` : payload.error);
  return payload.asset;
}

async function uploadWorkflowRequest(file: File, projectId: string, name = "", description = "") {
  const response = await fetch(CREATIVE_STUDIO_ROUTES.workflows, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-cs-project-id": projectId,
      "x-cs-file-name": encodeURIComponent(file.name),
      "x-cs-file-size": String(file.size),
      "x-cs-workflow-name": encodeURIComponent(name),
      "x-cs-workflow-description": encodeURIComponent(description),
    },
    body: file,
  });
  const payload = await response.json() as ApiResult<ImportWorkflowResponse>;
  if (!response.ok || !payload.ok) throw new Error(payload.ok ? `http_${response.status}` : payload.error);
  return payload.workflow;
}

export function createHttpAdapter(): StudioAdapter {
  const load = async (): Promise<StudioSnapshot> => {
    const [session, projects, dna, jobs, artifacts, media, workflows, trainingJobs, runners, capabilities] = await Promise.all([
      request<{ session: StudioSession }>(CREATIVE_STUDIO_ROUTES.session),
      request<{ projects: Project[] }>(CREATIVE_STUDIO_ROUTES.projects),
      request<{ artifacts: CreativeDnaArtifact[] }>(CREATIVE_STUDIO_ROUTES.dna),
      request<{ jobs: Job[] }>(CREATIVE_STUDIO_ROUTES.jobs),
      request<{ artifacts: Artifact[]; acceptances: StudioSnapshot["acceptances"]; trainingExamples: CreativeTrainingExample[] }>(CREATIVE_STUDIO_ROUTES.artifacts),
      request<{ assets: MediaAsset[] }>(CREATIVE_STUDIO_ROUTES.media),
      request<{ workflows: WorkflowDefinition[] }>(CREATIVE_STUDIO_ROUTES.workflows),
      request<{ trainingJobs: CreativeDnaTrainingJob[] }>(CREATIVE_STUDIO_ROUTES.trainingJobs),
      request<{ runners: LocalRunner[] }>(CREATIVE_STUDIO_ROUTES.runners),
      request<{ capabilities: Capability[] }>(CREATIVE_STUDIO_ROUTES.capabilities),
    ]);
    return {
      adapter: { id: "creative-studio-bff", label: "Creative Studio Worker", development: false, durableScope: "backend" },
      session: session.session,
      projects: projects.projects,
      dnaArtifacts: dna.artifacts,
      jobs: jobs.jobs,
      artifacts: artifacts.artifacts,
      mediaAssets: media.assets,
      workflows: workflows.workflows,
      trainingExamples: artifacts.trainingExamples,
      trainingJobs: trainingJobs.trainingJobs,
      runners: runners.runners,
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
    async reuseJob(jobId: string, idempotencyKey: string) {
      const result = await request<RetryJobResponse>(`${CREATIVE_STUDIO_ROUTES.jobs}/${encodeURIComponent(jobId)}/reuse`, {
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
    async reviewArtifact(artifactId: string, decision: AcceptanceDecision, note: string) {
      if ((decision === "accepted" || decision === "rejected") && !note.trim()) throw new Error("review_note_required");
      return request<ReviewArtifactResponse>(`${CREATIVE_STUDIO_ROUTES.artifacts}/${encodeURIComponent(artifactId)}/${decision}`, {
        method: "POST",
        body: JSON.stringify({ decision, note }),
      });
    },
    async uploadMedia(projectId: string, file: File, trainingEligible: boolean) {
      return uploadRequest(file, projectId, trainingEligible);
    },
    async uploadWorkflow(projectId: string, file: File, name = "", description = "") {
      return uploadWorkflowRequest(file, projectId, name, description);
    },
    async saveWorkflowRevision(workflowId: string, input: SaveWorkflowRevisionRequest) {
      const result = await request<SaveWorkflowRevisionResponse>(`${CREATIVE_STUDIO_ROUTES.workflows}/${encodeURIComponent(workflowId)}/revisions`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return result.workflow;
    },
    async startCreativeDnaTraining(input: CreateCreativeDnaTrainingJobRequest) {
      const result = await request<CreativeDnaTrainingJobResponse>(CREATIVE_STUDIO_ROUTES.trainingJobs, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return result.trainingJob;
    },
    async cancelCreativeDnaTraining(jobId: string) {
      const result = await request<CreativeDnaTrainingJobResponse>(`${CREATIVE_STUDIO_ROUTES.trainingJobs}/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return result.trainingJob;
    },
    async enrollLocalRunner(name: string) {
      return request<EnrollLocalRunnerResponse>(`${CREATIVE_STUDIO_ROUTES.runners}/enroll`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    },
    async revokeLocalRunner(runnerId: string) {
      const result = await request<RevokeLocalRunnerResponse>(`${CREATIVE_STUDIO_ROUTES.runners}/${encodeURIComponent(runnerId)}/revoke`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return result.runner;
    },
  };
}
