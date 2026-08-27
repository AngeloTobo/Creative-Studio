import type {
  AcceptanceDecision,
  CreateCreativeDnaRequest,
  CreativeDnaArtifact,
  ReviewArtifactResponse,
  StudioSnapshot,
  SubmitJobRequest,
  Job,
  MediaAsset,
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  SaveWorkflowRevisionRequest,
  WorkflowDefinition,
  CreateCreativeDnaTrainingJobRequest,
  CreativeDnaTrainingJob,
  CreativeDnaTrainingReviewDecision,
  ReviewCreativeDnaTrainingResponse,
  EnrollLocalRunnerResponse,
  LocalRunner,
  CreateModelTrainingJobRequest,
  ModelTrainingJob,
  ModelAdapterReviewDecision,
  ReviewModelTrainingDatasetRequest,
  ReviewModelAdapterResponse,
  CreateGenerationRecipeRequest,
  GenerationRecipe,
  RecipeEvidenceResponse,
  UpdateGenerationRecipeRequest,
  ArtifactHistoryPage,
  ArtifactHistoryQuery,
  CanonReference,
  ContinuityRule,
  CreateCanonReferenceRequest,
  CreateContinuityRuleRequest,
  CreateWorldEntityRequest,
  CreateWorldRequest,
  PromoteArtifactToCanonRequest,
  PromoteArtifactToCanonResult,
  PromoteToCanonRequest,
  PromoteToCanonResult,
  UpdateCanonReferenceRequest,
  UpdateContinuityRuleRequest,
  UpdateWorldEntityRequest,
  UpdateWorldRequest,
  World,
  WorldEntity,
} from "../../shared/contracts";

export interface StudioAdapter {
  readonly id: StudioSnapshot["adapter"]["id"];
  readonly activePollIntervalMs: number;
  load(): Promise<StudioSnapshot>;
  refresh(): Promise<StudioSnapshot>;
  createProject(input: CreateProjectRequest): Promise<Project>;
  updateProject(projectId: string, input: UpdateProjectRequest): Promise<Project>;
  archiveProject(projectId: string): Promise<Project>;
  saveCreativeDna(input: CreateCreativeDnaRequest): Promise<CreativeDnaArtifact>;
  submitJob(input: SubmitJobRequest): Promise<Job>;
  retryJob(jobId: string, idempotencyKey: string): Promise<Job>;
  reuseJob(jobId: string, idempotencyKey: string): Promise<Job>;
  cancelJob(jobId: string): Promise<Job>;
  reviewArtifact(artifactId: string, decision: AcceptanceDecision, note: string): Promise<ReviewArtifactResponse>;
  listArtifactHistory(query: ArtifactHistoryQuery): Promise<ArtifactHistoryPage>;
  createWorld(input: CreateWorldRequest): Promise<World>;
  updateWorld(worldId: string, input: UpdateWorldRequest): Promise<World>;
  archiveWorld(worldId: string, expectedVersion: number): Promise<World>;
  createWorldEntity(worldId: string, input: CreateWorldEntityRequest): Promise<WorldEntity>;
  updateWorldEntity(worldId: string, entityId: string, input: UpdateWorldEntityRequest): Promise<WorldEntity>;
  createContinuityRule(worldId: string, input: CreateContinuityRuleRequest): Promise<ContinuityRule>;
  updateContinuityRule(worldId: string, ruleId: string, input: UpdateContinuityRuleRequest): Promise<ContinuityRule>;
  createCanonReference(worldId: string, input: CreateCanonReferenceRequest): Promise<CanonReference>;
  updateCanonReference(worldId: string, referenceId: string, input: UpdateCanonReferenceRequest): Promise<CanonReference>;
  promoteCanonReference(worldId: string, referenceId: string, input: PromoteToCanonRequest): Promise<PromoteToCanonResult>;
  promoteArtifactToCanon(worldId: string, input: PromoteArtifactToCanonRequest): Promise<PromoteArtifactToCanonResult>;
  uploadMedia(projectId: string, file: File, trainingEligible: boolean): Promise<MediaAsset>;
  uploadWorkflow(projectId: string, file: File, name?: string, description?: string): Promise<WorkflowDefinition>;
  saveWorkflowRevision(workflowId: string, input: SaveWorkflowRevisionRequest): Promise<WorkflowDefinition>;
  listGenerationRecipes(includeArchived?: boolean): Promise<GenerationRecipe[]>;
  getGenerationRecipe(recipeId: string): Promise<GenerationRecipe>;
  createGenerationRecipe(input: CreateGenerationRecipeRequest): Promise<GenerationRecipe>;
  updateGenerationRecipe(recipeId: string, input: UpdateGenerationRecipeRequest): Promise<GenerationRecipe>;
  deleteGenerationRecipe(recipeId: string): Promise<GenerationRecipe>;
  recordGenerationRecipeEvidence(recipeId: string, jobId: string): Promise<RecipeEvidenceResponse>;
  startCreativeDnaTraining(input: CreateCreativeDnaTrainingJobRequest): Promise<CreativeDnaTrainingJob>;
  cancelCreativeDnaTraining(jobId: string): Promise<CreativeDnaTrainingJob>;
  reviewCreativeDnaTraining(jobId: string, decision: CreativeDnaTrainingReviewDecision, note: string): Promise<ReviewCreativeDnaTrainingResponse>;
  startModelTraining(input: CreateModelTrainingJobRequest): Promise<ModelTrainingJob>;
  cancelModelTraining(jobId: string): Promise<ModelTrainingJob>;
  reviewModelTrainingDataset(jobId: string, input: ReviewModelTrainingDatasetRequest): Promise<ModelTrainingJob>;
  reviewModelAdapter(adapterId: string, decision: ModelAdapterReviewDecision, note: string): Promise<ReviewModelAdapterResponse>;
  enrollLocalRunner(name: string): Promise<EnrollLocalRunnerResponse>;
  revokeLocalRunner(runnerId: string): Promise<LocalRunner>;
}
