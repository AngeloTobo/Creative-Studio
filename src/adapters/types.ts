import type {
  AcceptanceDecision,
  CreateCreativeDnaRequest,
  CreativeDnaArtifact,
  ReviewArtifactResponse,
  StudioSnapshot,
  SubmitJobRequest,
  Job,
} from "../../shared/contracts";

export interface StudioAdapter {
  readonly id: StudioSnapshot["adapter"]["id"];
  load(): Promise<StudioSnapshot>;
  refresh(): Promise<StudioSnapshot>;
  saveCreativeDna(input: CreateCreativeDnaRequest): Promise<CreativeDnaArtifact>;
  submitJob(input: SubmitJobRequest): Promise<Job>;
  reviewArtifact(artifactId: string, decision: AcceptanceDecision, note?: string): Promise<ReviewArtifactResponse>;
}
