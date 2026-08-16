import type {
  AcceptanceDecision,
  CreateCreativeDnaRequest,
  CreativeDnaArtifact,
  ReviewArtifactResponse,
  StudioSnapshot,
  SubmitJobRequest,
  Job,
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
} from "../../shared/contracts";

export interface StudioAdapter {
  readonly id: StudioSnapshot["adapter"]["id"];
  load(): Promise<StudioSnapshot>;
  refresh(): Promise<StudioSnapshot>;
  createProject(input: CreateProjectRequest): Promise<Project>;
  updateProject(projectId: string, input: UpdateProjectRequest): Promise<Project>;
  archiveProject(projectId: string): Promise<Project>;
  saveCreativeDna(input: CreateCreativeDnaRequest): Promise<CreativeDnaArtifact>;
  submitJob(input: SubmitJobRequest): Promise<Job>;
  retryJob(jobId: string, idempotencyKey: string): Promise<Job>;
  cancelJob(jobId: string): Promise<Job>;
  reviewArtifact(artifactId: string, decision: AcceptanceDecision, note?: string): Promise<ReviewArtifactResponse>;
}
