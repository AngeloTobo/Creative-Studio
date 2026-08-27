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
import type {
  CompleteModelTrainingJobRequest,
  CreateModelTrainingJobRequest,
  ModelAdapter,
  ModelAdapterEvaluation,
  ModelAdapterReview,
  ModelAdapterReviewDecision,
  ModelTrainingJob,
  ModelTrainingProvider,
  ModelTrainingStage,
  ReviewModelTrainingDatasetRequest,
} from "./modelTraining";
import type { ProjectProductionLoop } from "./productionLoop";
import type { ProductionCockpit } from "./productionCockpit";
import type { VideoDurationSeconds } from "./videoDuration";
import type { SaveWorkflowRevisionRequest, WorkflowDefinition } from "./workflows";
import type {
  CreateGenerationRecipeRequest,
  GenerationRecipe,
  RecipeEvidence,
  RecordRecipeEvidenceRequest,
  UpdateGenerationRecipeRequest,
} from "./generationRecipes";
import type {
  CanonPromotion,
  CanonReference,
  CreateCanonReferenceRequest,
  CreateContinuityRuleRequest,
  CreateWorldEntityRequest,
  CreateWorldRequest,
  GenerationContinuitySelection,
  PromoteArtifactToCanonRequest,
  PromoteArtifactToCanonResult,
  PromoteToCanonRequest,
  PromoteToCanonResult,
  ContinuityRule,
  UpdateCanonReferenceRequest,
  UpdateContinuityRuleRequest,
  UpdateWorldEntityRequest,
  UpdateWorldRequest,
  World,
  WorldEntity,
} from "./worlds";

export const CREATIVE_STUDIO_API_PREFIX = "/api/creative-studio" as const;

export const CREATIVE_STUDIO_ROUTES = {
  snapshot: `${CREATIVE_STUDIO_API_PREFIX}/snapshot`,
  session: `${CREATIVE_STUDIO_API_PREFIX}/session`,
  projects: `${CREATIVE_STUDIO_API_PREFIX}/projects`,
  worlds: `${CREATIVE_STUDIO_API_PREFIX}/worlds`,
  dna: `${CREATIVE_STUDIO_API_PREFIX}/dna`,
  jobs: `${CREATIVE_STUDIO_API_PREFIX}/jobs`,
  artifacts: `${CREATIVE_STUDIO_API_PREFIX}/artifacts`,
  media: `${CREATIVE_STUDIO_API_PREFIX}/media`,
  workflows: `${CREATIVE_STUDIO_API_PREFIX}/workflows`,
  recipes: `${CREATIVE_STUDIO_API_PREFIX}/recipes`,
  trainingJobs: `${CREATIVE_STUDIO_API_PREFIX}/training-jobs`,
  modelTrainingJobs: `${CREATIVE_STUDIO_API_PREFIX}/model-training-jobs`,
  modelAdapters: `${CREATIVE_STUDIO_API_PREFIX}/model-adapters`,
  productionLoops: `${CREATIVE_STUDIO_API_PREFIX}/production-loops`,
  productionCockpit: `${CREATIVE_STUDIO_API_PREFIX}/production-cockpit`,
  runners: `${CREATIVE_STUDIO_API_PREFIX}/runners`,
  runner: `${CREATIVE_STUDIO_API_PREFIX}/runner`,
  capabilities: `${CREATIVE_STUDIO_API_PREFIX}/capabilities`,
} as const;

export type CreativeStudioRoute =
  | "snapshot" | "session" | "projects" | "project-create" | "project-update" | "project-archive"
  | "worlds-list" | "world-create" | "world-get" | "world-update" | "world-archive"
  | "world-entity-create" | "world-entity-update" | "world-entity-retire"
  | "world-rule-create" | "world-rule-update" | "world-rule-retire"
  | "world-reference-create" | "world-reference-update" | "world-reference-retire" | "world-reference-promote" | "world-artifact-promote"
  | "dna-list" | "dna-create" | "jobs-list" | "jobs-create" | "job-retry" | "job-cancel"
  | "artifacts-list" | "artifact-review" | "artifact-media" | "artifact-thumbnail"
  | "media-list" | "media-upload" | "media-content" | "capabilities"
  | "workflows-list" | "workflow-import" | "workflow-revision-create" | "workflow-content" | "job-reuse"
  | "recipes-list" | "recipe-get" | "recipe-create" | "recipe-update" | "recipe-delete" | "recipe-evidence-create"
  | "training-jobs-list" | "training-job-create" | "training-job-cancel" | "training-job-review" | "production-loops" | "production-cockpit"
  | "model-training-jobs-list" | "model-training-job-create" | "model-training-job-cancel" | "model-training-dataset-review" | "model-adapter-review"
  | "runners-list" | "runner-enroll" | "runner-revoke"
  | "runner-work-claim" | "runner-heartbeat" | "runner-job-claim" | "runner-job-heartbeat" | "runner-job-complete" | "runner-job-thumbnail" | "runner-job-fail" | "runner-media-content"
  | "runner-training-claim" | "runner-training-heartbeat" | "runner-training-complete" | "runner-training-fail"
  | "runner-model-training-dataset" | "runner-model-training-heartbeat" | "runner-model-training-complete" | "runner-model-training-fail";

export function matchCreativeStudioRoute(method: string, pathname: string): CreativeStudioRoute | null {
  if (method === "GET" && pathname === "/api/creative-studio/snapshot") return "snapshot";
  if (method === "GET" && pathname === "/api/creative-studio/session") return "session";
  if (method === "GET" && pathname === "/api/creative-studio/projects") return "projects";
  if (method === "POST" && pathname === "/api/creative-studio/projects") return "project-create";
  if (method === "PATCH" && /^\/api\/creative-studio\/projects\/[a-z0-9_]+$/i.test(pathname)) return "project-update";
  if (method === "POST" && /^\/api\/creative-studio\/projects\/[a-z0-9_]+\/archive$/i.test(pathname)) return "project-archive";
  if (method === "GET" && pathname === "/api/creative-studio/worlds") return "worlds-list";
  if (method === "POST" && pathname === "/api/creative-studio/worlds") return "world-create";
  if (method === "GET" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+$/i.test(pathname)) return "world-get";
  if (method === "PATCH" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+$/i.test(pathname)) return "world-update";
  if (method === "POST" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/archive$/i.test(pathname)) return "world-archive";
  if (method === "POST" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/entities$/i.test(pathname)) return "world-entity-create";
  if (method === "PATCH" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/entities\/[a-z0-9_]+$/i.test(pathname)) return "world-entity-update";
  if (method === "POST" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/entities\/[a-z0-9_]+\/retire$/i.test(pathname)) return "world-entity-retire";
  if (method === "POST" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/rules$/i.test(pathname)) return "world-rule-create";
  if (method === "PATCH" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/rules\/[a-z0-9_]+$/i.test(pathname)) return "world-rule-update";
  if (method === "POST" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/rules\/[a-z0-9_]+\/retire$/i.test(pathname)) return "world-rule-retire";
  if (method === "POST" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/references$/i.test(pathname)) return "world-reference-create";
  if (method === "PATCH" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/references\/[a-z0-9_]+$/i.test(pathname)) return "world-reference-update";
  if (method === "POST" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/references\/[a-z0-9_]+\/retire$/i.test(pathname)) return "world-reference-retire";
  if (method === "POST" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/references\/[a-z0-9_]+\/promote$/i.test(pathname)) return "world-reference-promote";
  if (method === "POST" && /^\/api\/creative-studio\/worlds\/[a-z0-9_]+\/promote-artifact$/i.test(pathname)) return "world-artifact-promote";
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
  if (method === "GET" && pathname === "/api/creative-studio/recipes") return "recipes-list";
  if (method === "POST" && pathname === "/api/creative-studio/recipes") return "recipe-create";
  if (method === "GET" && /^\/api\/creative-studio\/recipes\/[a-z0-9_]+$/i.test(pathname)) return "recipe-get";
  if (method === "PATCH" && /^\/api\/creative-studio\/recipes\/[a-z0-9_]+$/i.test(pathname)) return "recipe-update";
  if (method === "DELETE" && /^\/api\/creative-studio\/recipes\/[a-z0-9_]+$/i.test(pathname)) return "recipe-delete";
  if (method === "POST" && /^\/api\/creative-studio\/recipes\/[a-z0-9_]+\/evidence$/i.test(pathname)) return "recipe-evidence-create";
  if (method === "GET" && pathname === "/api/creative-studio/training-jobs") return "training-jobs-list";
  if (method === "POST" && pathname === "/api/creative-studio/training-jobs") return "training-job-create";
  if (method === "POST" && /^\/api\/creative-studio\/training-jobs\/[a-z0-9_]+\/cancel$/i.test(pathname)) return "training-job-cancel";
  if (method === "POST" && /^\/api\/creative-studio\/training-jobs\/[a-z0-9_]+\/review$/i.test(pathname)) return "training-job-review";
  if (method === "GET" && pathname === "/api/creative-studio/model-training-jobs") return "model-training-jobs-list";
  if (method === "POST" && pathname === "/api/creative-studio/model-training-jobs") return "model-training-job-create";
  if (method === "POST" && /^\/api\/creative-studio\/model-training-jobs\/[a-z0-9_]+\/cancel$/i.test(pathname)) return "model-training-job-cancel";
  if (method === "POST" && /^\/api\/creative-studio\/model-training-jobs\/[a-z0-9_]+\/dataset-review$/i.test(pathname)) return "model-training-dataset-review";
  if (method === "POST" && /^\/api\/creative-studio\/model-adapters\/[a-z0-9_]+\/review$/i.test(pathname)) return "model-adapter-review";
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
  if (method === "POST" && /^\/api\/creative-studio\/runner\/model-training\/[a-z0-9_]+\/dataset$/i.test(pathname)) return "runner-model-training-dataset";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/model-training\/[a-z0-9_]+\/heartbeat$/i.test(pathname)) return "runner-model-training-heartbeat";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/model-training\/[a-z0-9_]+\/complete$/i.test(pathname)) return "runner-model-training-complete";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/model-training\/[a-z0-9_]+\/fail$/i.test(pathname)) return "runner-model-training-fail";
  if (method === "GET" && pathname === "/api/creative-studio/capabilities") return "capabilities";
  return null;
}

export type StudioSnapshot = {
  adapter: AdapterDescriptor;
  session: StudioSession;
  projects: Project[];
  worlds?: World[];
  worldEntities?: WorldEntity[];
  continuityRules?: ContinuityRule[];
  canonReferences?: CanonReference[];
  canonPromotions?: CanonPromotion[];
  dnaArtifacts: CreativeDnaArtifact[];
  jobs: Job[];
  artifacts: Artifact[];
  mediaAssets: MediaAsset[];
  workflows: WorkflowDefinition[];
  recipes: GenerationRecipe[];
  trainingExamples: CreativeTrainingExample[];
  trainingJobs: CreativeDnaTrainingJob[];
  trainingReviews: CreativeDnaTrainingReview[];
  modelTrainingJobs: ModelTrainingJob[];
  modelAdapters: ModelAdapter[];
  modelAdapterReviews: ModelAdapterReview[];
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
export type WorldCollectionsResponse = {
  worlds: World[];
  worldEntities: WorldEntity[];
  continuityRules: ContinuityRule[];
  canonReferences: CanonReference[];
  canonPromotions: CanonPromotion[];
};
export type WorldResponse = { world: World };
export type WorldEntityResponse = { entity: WorldEntity };
export type ContinuityRuleResponse = { rule: ContinuityRule };
export type CanonReferenceResponse = { reference: CanonReference };
export type PromoteCanonReferenceResponse = { promotion: PromoteToCanonResult };
export type PromoteArtifactCanonResponse = { promotion: PromoteArtifactToCanonResult };

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
  continuity?: GenerationContinuitySelection;
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

export type ArtifactHistoryCursor = {
  createdAt: string;
  artifactId: string;
};

/** Newest owner-wide artifacts included in the operational snapshot. */
export const ARTIFACT_SNAPSHOT_LIMIT = 100;

export type ArtifactHistoryQuery = {
  projectId?: string | null;
  cursor?: ArtifactHistoryCursor | null;
  limit?: number;
  kinds?: GenerationModality[];
  statuses?: Artifact["status"][];
  includeArchived?: boolean;
  search?: string;
};

export type ArtifactHistoryPage = {
  artifacts: Artifact[];
  jobs: Job[];
  acceptances: Acceptance[];
  trainingExamples: CreativeTrainingExample[];
  nextCursor: ArtifactHistoryCursor | null;
  hasMore: boolean;
  total: number;
};

export type ArtifactHistoryPageResponse = { page: ArtifactHistoryPage };

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
export type ModelTrainingJobResponse = { modelTrainingJob: ModelTrainingJob };
export type ModelTrainingSnapshotResponse = { modelTrainingJobs: ModelTrainingJob[]; modelAdapters: ModelAdapter[]; modelAdapterReviews: ModelAdapterReview[] };
export type ReviewModelAdapterRequest = { decision: ModelAdapterReviewDecision; note: string };
export type ReviewModelAdapterResponse = { modelTrainingJob: ModelTrainingJob; adapter: ModelAdapter; review: ModelAdapterReview };
export type ModelTrainingBundleResponse = {
  modelTrainingJob: ModelTrainingJob;
  dna: CreativeDnaArtifact | null;
  assets: MediaAsset[];
};
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
export type GenerationRecipesResponse = { recipes: GenerationRecipe[] };
export type GenerationRecipeResponse = { recipe: GenerationRecipe };
export type RecipeEvidenceResponse = { recipe: GenerationRecipe; evidence: RecipeEvidence };
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
  modelTrainingProviders?: ModelTrainingProvider[];
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
  | { kind: "model-training"; bundle: ModelTrainingBundleResponse }
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
export type RunnerModelTrainingHeartbeatRequest = { progress: number; stage: ModelTrainingStage; upstreamId?: string | null };
export type RunnerModelTrainingHeartbeatResponse = { continue: boolean; modelTrainingJob: ModelTrainingJob };
export type RunnerCompleteModelTrainingRequest = Omit<CompleteModelTrainingJobRequest, "runnerId">;
export type RunnerCompleteModelTrainingDatasetRequest = { dataset: import("./modelTraining").ModelTrainingDataset };
export type RunnerFailModelTrainingRequest = { error: string };
export type RunnerModelAdapterEvaluation = ModelAdapterEvaluation;
export type { CreateModelTrainingJobRequest, ModelAdapterReviewDecision, ReviewModelTrainingDatasetRequest };
export type { SaveWorkflowRevisionRequest };
export type { CreateGenerationRecipeRequest, RecordRecipeEvidenceRequest, UpdateGenerationRecipeRequest };
export type {
  CreateCanonReferenceRequest,
  CreateContinuityRuleRequest,
  CreateWorldEntityRequest,
  CreateWorldRequest,
  PromoteArtifactToCanonRequest,
  PromoteToCanonRequest,
  UpdateCanonReferenceRequest,
  UpdateContinuityRuleRequest,
  UpdateWorldEntityRequest,
  UpdateWorldRequest,
};

export type ApiSuccess<T> = { ok: true } & T;
export type ApiFailure = { ok: false; error: string; message?: string };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
