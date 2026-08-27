import {
  CREATIVE_STUDIO_ROUTES,
  type AcceptanceDecision,
  type ApiResult,
  type CreateCreativeDnaRequest,
  type CreateCreativeDnaResponse,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type ReviewArtifactResponse,
  type RetryJobResponse,
  type StudioSnapshot,
  type SubmitJobRequest,
  type SubmitJobResponse,
  type UpdateProjectRequest,
  type UpdateProjectResponse,
  type UploadMediaResponse,
  type ImportWorkflowResponse,
  type SaveWorkflowRevisionRequest,
  type SaveWorkflowRevisionResponse,
  type CreateCreativeDnaTrainingJobRequest,
  type CreativeDnaTrainingJobResponse,
  type CreativeDnaTrainingReviewDecision,
  type ReviewCreativeDnaTrainingResponse,
  type EnrollLocalRunnerResponse,
  type RevokeLocalRunnerResponse,
  type CreateModelTrainingJobRequest,
  type ModelTrainingJobResponse,
  type ModelAdapterReviewDecision,
  type ReviewModelAdapterResponse,
  type ReviewModelTrainingDatasetRequest,
  type CreateGenerationRecipeRequest,
  type GenerationRecipeResponse,
  type GenerationRecipesResponse,
  type RecipeEvidenceResponse,
  type UpdateGenerationRecipeRequest,
} from "../../shared/contracts";
import type { StudioAdapter } from "./types";
import { resolveHttpPollInterval } from "../config/runtime";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (response.status === 429) throw new Error("cloudflare_free_tier_temporarily_limited");
  const payload = response.headers.get("content-type")?.includes("application/json")
    ? await response.json() as ApiResult<T>
    : null;
  if (!payload) throw new Error(`http_${response.status}`);
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
  const activePollIntervalMs = resolveHttpPollInterval(import.meta.env.VITE_CREATIVE_STUDIO_LOCAL, window.location.hostname);
  const load = async (): Promise<StudioSnapshot> => {
    const result = await request<{ snapshot: StudioSnapshot }>(CREATIVE_STUDIO_ROUTES.snapshot);
    return result.snapshot;
  };

  return {
    id: "creative-studio-bff",
    activePollIntervalMs,
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
    async listGenerationRecipes(includeArchived = false) {
      const query = includeArchived ? "?includeArchived=true" : "";
      const result = await request<GenerationRecipesResponse>(`${CREATIVE_STUDIO_ROUTES.recipes}${query}`);
      return result.recipes;
    },
    async getGenerationRecipe(recipeId: string) {
      const result = await request<GenerationRecipeResponse>(`${CREATIVE_STUDIO_ROUTES.recipes}/${encodeURIComponent(recipeId)}`);
      return result.recipe;
    },
    async createGenerationRecipe(input: CreateGenerationRecipeRequest) {
      const result = await request<GenerationRecipeResponse>(CREATIVE_STUDIO_ROUTES.recipes, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return result.recipe;
    },
    async updateGenerationRecipe(recipeId: string, input: UpdateGenerationRecipeRequest) {
      const result = await request<GenerationRecipeResponse>(`${CREATIVE_STUDIO_ROUTES.recipes}/${encodeURIComponent(recipeId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      return result.recipe;
    },
    async deleteGenerationRecipe(recipeId: string) {
      const result = await request<GenerationRecipeResponse>(`${CREATIVE_STUDIO_ROUTES.recipes}/${encodeURIComponent(recipeId)}`, {
        method: "DELETE",
      });
      return result.recipe;
    },
    async recordGenerationRecipeEvidence(recipeId: string, jobId: string) {
      return request<RecipeEvidenceResponse>(`${CREATIVE_STUDIO_ROUTES.recipes}/${encodeURIComponent(recipeId)}/evidence`, {
        method: "POST",
        body: JSON.stringify({ jobId }),
      });
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
    async reviewCreativeDnaTraining(jobId: string, decision: CreativeDnaTrainingReviewDecision, note: string) {
      if (!note.trim()) throw new Error("training_review_note_required");
      return request<ReviewCreativeDnaTrainingResponse>(`${CREATIVE_STUDIO_ROUTES.trainingJobs}/${encodeURIComponent(jobId)}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, note }),
      });
    },
    async startModelTraining(input: CreateModelTrainingJobRequest) {
      const result = await request<ModelTrainingJobResponse>(CREATIVE_STUDIO_ROUTES.modelTrainingJobs, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return result.modelTrainingJob;
    },
    async cancelModelTraining(jobId: string) {
      const result = await request<ModelTrainingJobResponse>(`${CREATIVE_STUDIO_ROUTES.modelTrainingJobs}/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return result.modelTrainingJob;
    },
    async reviewModelTrainingDataset(jobId: string, input: ReviewModelTrainingDatasetRequest) {
      const result = await request<ModelTrainingJobResponse>(`${CREATIVE_STUDIO_ROUTES.modelTrainingJobs}/${encodeURIComponent(jobId)}/dataset-review`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return result.modelTrainingJob;
    },
    async reviewModelAdapter(adapterId: string, decision: ModelAdapterReviewDecision, note: string) {
      if (!note.trim()) throw new Error("model_adapter_review_note_required");
      return request<ReviewModelAdapterResponse>(`${CREATIVE_STUDIO_ROUTES.modelAdapters}/${encodeURIComponent(adapterId)}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, note }),
      });
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
