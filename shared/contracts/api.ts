import type {
  Acceptance,
  AcceptanceDecision,
  AdapterDescriptor,
  Artifact,
  Capability,
  GenerationModality,
  GenerationExecutionStage,
  ImagePerformanceMode,
  VideoPerformanceMode,
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
  GenerationOutputBatch,
  GenerationPromptReferenceSelection,
} from "./domain";
import type { CreativeDnaArtifact, CreativeDnaInput, CreativeDnaTrainingAnalysis, VideoGenerationVariant } from "./creativeDna";
import type {
  CreateVideoPromptEnhancementRequest,
  RunnerCompletePromptEnhancementRequest,
  RunnerFailPromptEnhancementRequest,
  RunnerPromptEnhancementBundle,
  RunnerPromptEnhancementHeartbeatRequest,
  VideoPromptEnhancement,
  VideoSpeechStamp,
} from "./promptEnhancements";
import type {
  CreateVideoScriptDraftRequest,
  RunnerCompleteVideoScriptDraftRequest,
  RunnerFailVideoScriptDraftRequest,
  RunnerVideoScriptDraftBundle,
  RunnerVideoScriptDraftHeartbeatRequest,
  UpdateVideoScriptDraftRequest,
  VideoScriptDraft,
  VideoScriptUse,
} from "./videoScripts";
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
import type {
  CompleteOvernightPlanRequest,
  CreateOvernightSessionRequest,
  FailOvernightPlanRequest,
  OvernightPlanHeartbeatRequest,
  OvernightPlannerBundle,
  OvernightSession,
} from "./overnight";
import type { ConfigureLoveLoopRequest, LoveLoop } from "./loveLoop";
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
  promptEnhancements: `${CREATIVE_STUDIO_API_PREFIX}/prompt-enhancements`,
  videoScripts: `${CREATIVE_STUDIO_API_PREFIX}/video-scripts`,
  artifacts: `${CREATIVE_STUDIO_API_PREFIX}/artifacts`,
  media: `${CREATIVE_STUDIO_API_PREFIX}/media`,
  workflows: `${CREATIVE_STUDIO_API_PREFIX}/workflows`,
  recipes: `${CREATIVE_STUDIO_API_PREFIX}/recipes`,
  trainingJobs: `${CREATIVE_STUDIO_API_PREFIX}/training-jobs`,
  modelTrainingJobs: `${CREATIVE_STUDIO_API_PREFIX}/model-training-jobs`,
  modelAdapters: `${CREATIVE_STUDIO_API_PREFIX}/model-adapters`,
  productionLoops: `${CREATIVE_STUDIO_API_PREFIX}/production-loops`,
  productionCockpit: `${CREATIVE_STUDIO_API_PREFIX}/production-cockpit`,
  overnight: `${CREATIVE_STUDIO_API_PREFIX}/overnight`,
  loveLoop: `${CREATIVE_STUDIO_API_PREFIX}/love-loop`,
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
  | "dna-list" | "dna-create" | "jobs-list" | "jobs-create" | "job-retry" | "job-cancel" | "prompt-enhancement-create" | "prompt-enhancement-get" | "video-script-create" | "video-script-get" | "video-script-update"
  | "artifacts-list" | "artifact-review" | "artifact-media" | "artifact-thumbnail"
  | "media-list" | "media-upload" | "media-content" | "capabilities"
  | "workflows-list" | "workflow-import" | "workflow-revision-create" | "workflow-content" | "job-reuse"
  | "recipes-list" | "recipe-get" | "recipe-create" | "recipe-update" | "recipe-delete" | "recipe-evidence-create"
  | "training-jobs-list" | "training-job-create" | "training-job-cancel" | "training-job-review" | "production-loops" | "production-cockpit"
  | "overnight-list" | "overnight-create" | "overnight-pause" | "overnight-resume" | "overnight-cancel"
  | "love-loop-get" | "love-loop-configure" | "love-loop-pause" | "love-loop-resume" | "love-loop-disable"
  | "model-training-jobs-list" | "model-training-job-create" | "model-training-job-cancel" | "model-training-dataset-review" | "model-adapter-review"
  | "runners-list" | "runner-enroll" | "runner-revoke"
  | "runner-work-claim" | "runner-heartbeat" | "runner-job-claim" | "runner-job-heartbeat" | "runner-job-complete" | "runner-job-thumbnail" | "runner-job-fail" | "runner-media-content"
  | "runner-prompt-enhancement-heartbeat" | "runner-prompt-enhancement-complete" | "runner-prompt-enhancement-fail"
  | "runner-video-script-heartbeat" | "runner-video-script-complete" | "runner-video-script-fail"
  | "runner-overnight-heartbeat" | "runner-overnight-complete" | "runner-overnight-fail"
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
  if (method === "POST" && pathname === "/api/creative-studio/prompt-enhancements") return "prompt-enhancement-create";
  if (method === "GET" && /^\/api\/creative-studio\/prompt-enhancements\/[a-z0-9_]+$/i.test(pathname)) return "prompt-enhancement-get";
  if (method === "POST" && pathname === "/api/creative-studio/video-scripts") return "video-script-create";
  if (method === "GET" && /^\/api\/creative-studio\/video-scripts\/[a-z0-9_]+$/i.test(pathname)) return "video-script-get";
  if (method === "PATCH" && /^\/api\/creative-studio\/video-scripts\/[a-z0-9_]+$/i.test(pathname)) return "video-script-update";
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
  if (method === "GET" && pathname === "/api/creative-studio/overnight") return "overnight-list";
  if (method === "POST" && pathname === "/api/creative-studio/overnight") return "overnight-create";
  if (method === "POST" && /^\/api\/creative-studio\/overnight\/[a-z0-9_]+\/pause$/i.test(pathname)) return "overnight-pause";
  if (method === "POST" && /^\/api\/creative-studio\/overnight\/[a-z0-9_]+\/resume$/i.test(pathname)) return "overnight-resume";
  if (method === "POST" && /^\/api\/creative-studio\/overnight\/[a-z0-9_]+\/cancel$/i.test(pathname)) return "overnight-cancel";
  if (method === "GET" && pathname === "/api/creative-studio/love-loop") return "love-loop-get";
  if (method === "PUT" && pathname === "/api/creative-studio/love-loop") return "love-loop-configure";
  if (method === "POST" && pathname === "/api/creative-studio/love-loop/pause") return "love-loop-pause";
  if (method === "POST" && pathname === "/api/creative-studio/love-loop/resume") return "love-loop-resume";
  if (method === "POST" && pathname === "/api/creative-studio/love-loop/disable") return "love-loop-disable";
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
  if (method === "POST" && /^\/api\/creative-studio\/runner\/prompt-enhancements\/[a-z0-9_]+\/heartbeat$/i.test(pathname)) return "runner-prompt-enhancement-heartbeat";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/prompt-enhancements\/[a-z0-9_]+\/complete$/i.test(pathname)) return "runner-prompt-enhancement-complete";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/prompt-enhancements\/[a-z0-9_]+\/fail$/i.test(pathname)) return "runner-prompt-enhancement-fail";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/video-scripts\/[a-z0-9_]+\/heartbeat$/i.test(pathname)) return "runner-video-script-heartbeat";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/video-scripts\/[a-z0-9_]+\/complete$/i.test(pathname)) return "runner-video-script-complete";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/video-scripts\/[a-z0-9_]+\/fail$/i.test(pathname)) return "runner-video-script-fail";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/overnight\/[a-z0-9_]+\/heartbeat$/i.test(pathname)) return "runner-overnight-heartbeat";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/overnight\/[a-z0-9_]+\/complete$/i.test(pathname)) return "runner-overnight-complete";
  if (method === "POST" && /^\/api\/creative-studio\/runner\/overnight\/[a-z0-9_]+\/fail$/i.test(pathname)) return "runner-overnight-fail";
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
  promptEnhancements: VideoPromptEnhancement[];
  videoScriptDrafts?: VideoScriptDraft[];
  artifacts: Artifact[];
  mediaAssets: MediaAsset[];
  workflows: WorkflowDefinition[];
  recipes: GenerationRecipe[];
  overnightSessions: OvernightSession[];
  loveLoop: LoveLoop | null;
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
  videoPerformanceMode?: VideoPerformanceMode;
  trustedVideoPresetId?: import("./trustedVideoPresets").TrustedVideoPresetId;
  videoDurationSeconds?: VideoDurationSeconds;
  videoVariant?: VideoGenerationVariant;
  videoSpeech?: VideoSpeechStamp;
  videoScript?: VideoScriptUse;
  videoOperation?: VideoGenerationOperation;
  evolution?: EvolutionJobContext;
  outputBatch?: GenerationOutputBatch;
  promptReference?: GenerationPromptReferenceSelection;
  continuity?: GenerationContinuitySelection;
  promptEnhancement?: { requestId: string; basePrompt: string; appliedPrompt: string };
};

export type SubmitJobResponse = {
  job: Job;
};

export type CreatePromptEnhancementRequest = CreateVideoPromptEnhancementRequest;
export type CreatePromptEnhancementResponse = { promptEnhancement: VideoPromptEnhancement };
export type CreateVideoScriptDraftResponse = { videoScriptDraft: VideoScriptDraft };
export type UpdateVideoScriptDraftResponse = { videoScriptDraft: VideoScriptDraft };

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
export type OvernightSessionsResponse = { overnightSessions: OvernightSession[] };
export type OvernightSessionResponse = { overnightSession: OvernightSession };
export type LoveLoopResponse = { loveLoop: LoveLoop | null };
export type EnrollLocalRunnerRequest = { name: string };
export type EnrollLocalRunnerResponse = { runner: LocalRunner; token: string; apiBase: string };
export type RevokeLocalRunnerResponse = { runner: LocalRunner };

export type RunnerHeartbeatRequest = {
  version: string;
  comfyUrl: string;
  comfyReady?: boolean;
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
  | { kind: "overnight-plan"; bundle: OvernightPlannerBundle }
  | { kind: "prompt-enhancement"; bundle: RunnerPromptEnhancementBundle }
  | { kind: "video-script"; bundle: RunnerVideoScriptDraftBundle }
  | { kind: "generation"; bundle: RunnerJobBundle }
  | { kind: "training"; bundle: CreativeDnaTrainingBundleResponse }
  | { kind: "model-training"; bundle: ModelTrainingBundleResponse }
  | { kind: null; bundle: null };
export type RunnerJobHeartbeatRequest = {
  progress: number;
  upstreamId?: string | null;
  stage?: GenerationExecutionStage;
  /** Last time queue or history returned this exact Comfy prompt. Omitted while Comfy's API is unreachable. */
  comfyObservationAt?: string | null;
  promptEnhancement?: SongPromptEnhancementStamp & { parameterId: string };
};
export type RunnerJobHeartbeatResponse = { continue: boolean; job: Job };
export type { RunnerPromptEnhancementHeartbeatRequest, RunnerCompletePromptEnhancementRequest, RunnerFailPromptEnhancementRequest };
export type { RunnerVideoScriptDraftHeartbeatRequest, RunnerCompleteVideoScriptDraftRequest, RunnerFailVideoScriptDraftRequest };
export type { CreateVideoScriptDraftRequest, UpdateVideoScriptDraftRequest };
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
export type { CreateOvernightSessionRequest, CompleteOvernightPlanRequest, FailOvernightPlanRequest, OvernightPlanHeartbeatRequest };
export type { ConfigureLoveLoopRequest };
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
