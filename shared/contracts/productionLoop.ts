import type { CreativeDnaArtifact } from "./creativeDna";
import type {
  Artifact,
  CreativeDnaTrainingJob,
  CreativeDnaTrainingReview,
  CreativeTrainingExample,
  Job,
  Project,
} from "./domain";

export type ProductionLoopStage =
  | "needs-dna"
  | "ready-to-generate"
  | "generation-running"
  | "review-output"
  | "generation-failed"
  | "evidence-ready"
  | "training-running"
  | "review-training";

export type ProductionLoopSurface = "author" | "generation" | "queue" | "artifacts" | "training";

export type ProductionLoopAction = {
  surface: ProductionLoopSurface;
  label: string;
  detail: string;
};

export type ProjectProductionLoop = {
  projectId: string;
  stage: ProductionLoopStage;
  activeDnaArtifactId: string | null;
  activeDnaName: string | null;
  activeDnaVersion: number | null;
  activeGenerationJobId: string | null;
  reviewArtifactId: string | null;
  failedGenerationJobId: string | null;
  activeTrainingJobId: string | null;
  pendingTrainingReviewJobId: string | null;
  freshTrainingExampleIds: string[];
  usedTrainingExampleIds: string[];
  counts: {
    generationActive: number;
    outputsReadyForReview: number;
    outputsAccepted: number;
    evidenceFresh: number;
    evidenceUsed: number;
    trainingActive: number;
    trainingPendingReview: number;
    trainedVersionsApproved: number;
  };
  nextAction: ProductionLoopAction;
  computedAt: string;
};

export type ProductionLoopInput = {
  project: Project;
  dnaArtifacts: CreativeDnaArtifact[];
  jobs: Job[];
  artifacts: Artifact[];
  trainingExamples: CreativeTrainingExample[];
  trainingJobs: CreativeDnaTrainingJob[];
  trainingReviews: CreativeDnaTrainingReview[];
  reservedTrainingExampleIds?: string[];
  computedAt: string;
};

function newest<T extends { createdAt: string }>(values: T[]) {
  return [...values].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deriveProjectProductionLoop(input: ProductionLoopInput): ProjectProductionLoop {
  const dnaArtifacts = newest(input.dnaArtifacts.filter((item) => item.projectId === input.project.id));
  const jobs = newest(input.jobs.filter((item) => item.projectId === input.project.id));
  const artifacts = newest(input.artifacts.filter((item) => item.projectId === input.project.id));
  const examples = newest(input.trainingExamples.filter((item) => item.projectId === input.project.id));
  const trainingJobs = newest(input.trainingJobs.filter((item) => item.projectId === input.project.id));
  const reviews = newest(input.trainingReviews.filter((item) => item.projectId === input.project.id));
  const reviewFor = (artifactId: string) => reviews.find((review) => review.dnaArtifactId === artifactId) ?? null;
  const usableDna = (artifact: CreativeDnaArtifact) => !artifact.training || reviewFor(artifact.artifactId)?.decision === "approved";
  const activeDna = (input.project.activeDnaArtifactId
    ? dnaArtifacts.find((artifact) => artifact.artifactId === input.project.activeDnaArtifactId && usableDna(artifact))
    : null) ?? dnaArtifacts.find(usableDna) ?? null;

  const reservedExampleIds = new Set(input.reservedTrainingExampleIds ?? trainingJobs
    .filter((job) => job.status !== "failed" && job.status !== "cancelled")
    .flatMap((job) => job.trainingExampleIds));
  const readyExamples = examples.filter((example) => example.status === "training-ready");
  const freshExamples = readyExamples.filter((example) => !reservedExampleIds.has(example.id));
  const usedExamples = readyExamples.filter((example) => reservedExampleIds.has(example.id));
  const generationActive = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const outputsReady = artifacts.filter((artifact) => artifact.status === "ready");
  const outputsAccepted = artifacts.filter((artifact) => artifact.status === "accepted");
  const trainingActive = trainingJobs.filter((job) => job.status === "waiting-for-runner" || job.status === "running");
  const pendingTrainingReviews = trainingJobs.filter((job) => job.status === "completed" && job.resultDnaArtifactId
    && !reviews.some((review) => review.trainingJobId === job.id));
  const latestFailedJob = jobs.find((job) => job.status === "failed" || job.status === "cancelled") ?? null;

  let stage: ProductionLoopStage;
  let nextAction: ProductionLoopAction;
  if (pendingTrainingReviews.length) {
    stage = "review-training";
    nextAction = { surface: "training", label: "Review trained version", detail: "Compare the completed profile before it can become active." };
  } else if (!activeDna) {
    stage = "needs-dna";
    nextAction = { surface: "author", label: "Build CreativeDNA", detail: "Create the first versioned production blueprint." };
  } else if (outputsReady.length) {
    stage = "review-output";
    nextAction = { surface: "artifacts", label: "Review retained result", detail: "Accept or reject the retained output with a note." };
  } else if (trainingActive.length) {
    stage = "training-running";
    nextAction = { surface: "training", label: "Track DNA training", detail: "The local trainer owns this durable run." };
  } else if (generationActive.length) {
    stage = "generation-running";
    nextAction = { surface: "queue", label: "Track production", detail: "The job continues without an open browser." };
  } else if (freshExamples.length) {
    stage = "evidence-ready";
    nextAction = { surface: "training", label: "Train next version", detail: "Use newly accepted prompt and exact-settings evidence once." };
  } else if (latestFailedJob && jobs[0]?.id === latestFailedJob.id) {
    stage = "generation-failed";
    nextAction = { surface: "queue", label: "Review failure and retry", detail: "Retry as a new durable job while retaining failure history." };
  } else {
    stage = "ready-to-generate";
    nextAction = { surface: "generation", label: "Generate from active DNA", detail: "Produce the next retained result from this exact version." };
  }

  return {
    projectId: input.project.id,
    stage,
    activeDnaArtifactId: activeDna?.artifactId ?? null,
    activeDnaName: activeDna?.name ?? null,
    activeDnaVersion: activeDna?.version ?? null,
    activeGenerationJobId: generationActive[0]?.id ?? null,
    reviewArtifactId: outputsReady[0]?.id ?? null,
    failedGenerationJobId: latestFailedJob?.id ?? null,
    activeTrainingJobId: trainingActive[0]?.id ?? null,
    pendingTrainingReviewJobId: pendingTrainingReviews[0]?.id ?? null,
    freshTrainingExampleIds: freshExamples.map((example) => example.id),
    usedTrainingExampleIds: usedExamples.map((example) => example.id),
    counts: {
      generationActive: generationActive.length,
      outputsReadyForReview: outputsReady.length,
      outputsAccepted: outputsAccepted.length,
      evidenceFresh: freshExamples.length,
      evidenceUsed: usedExamples.length,
      trainingActive: trainingActive.length,
      trainingPendingReview: pendingTrainingReviews.length,
      trainedVersionsApproved: reviews.filter((review) => review.decision === "approved").length,
    },
    nextAction,
    computedAt: input.computedAt,
  };
}
