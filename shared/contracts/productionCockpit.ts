import type { CreativeDnaArtifact } from "./creativeDna";
import type {
  Acceptance,
  Artifact,
  CreativeDnaTrainingJob,
  CreativeDnaTrainingReview,
  GenerationModality,
  Job,
  LocalRunner,
  MediaAsset,
  Project,
} from "./domain";

export type ProductionCockpitSurface = "dna" | "gallery" | "queue" | "runtime";
export type ProductionCockpitSeverity = "critical" | "warning" | "info";
export type ProductionCockpitDecision = "unreviewed" | "accepted" | "rejected" | "archived" | "approved" | "not-applicable";
export type ProductionCockpitActionKind =
  | "review-training"
  | "review-artifact"
  | "retry-generation"
  | "restart-training"
  | "runner-offline"
  | "runner-error";

export type ProductionCockpitAction = {
  id: string;
  kind: ProductionCockpitActionKind;
  severity: ProductionCockpitSeverity;
  projectId: string | null;
  projectName: string | null;
  entityId: string;
  modality: GenerationModality | "training" | null;
  title: string;
  detail: string;
  actionLabel: string;
  surface: ProductionCockpitSurface;
  createdAt: string;
};

export type ProductionCockpitRun = {
  id: string;
  kind: "generation" | "training";
  projectId: string;
  projectName: string;
  modality: GenerationModality | "training";
  status: Job["status"] | CreativeDnaTrainingJob["status"];
  progress: number;
  provider: string;
  workflowName: string | null;
  workflowRevision: number | null;
  dnaArtifactId: string | null;
  dnaName: string | null;
  dnaVersion: number | null;
  decision: ProductionCockpitDecision;
  runnerId: string | null;
  runnerName: string | null;
  runnerDevice: string | null;
  queuePosition: number | null;
  durationMs: number;
  retainedBytes: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductionCockpitRunner = {
  id: string;
  name: string;
  state: LocalRunner["state"];
  version: string | null;
  device: string | null;
  activeJobId: string | null;
  lastError: string | null;
  lastHeartbeatAt: string | null;
};

export type ProductionCockpit = {
  summary: {
    actionRequired: number;
    activeRuns: number;
    outputsAwaitingReview: number;
    retainedOutputs: number;
    failedRuns: number;
    offlineRunners: number;
    storedBytes: number;
    retainedFiles: number;
    activeProjects: number;
  };
  actions: ProductionCockpitAction[];
  runs: ProductionCockpitRun[];
  runners: ProductionCockpitRunner[];
  computedAt: string;
};

export type ProductionCockpitInput = {
  projects: Project[];
  dnaArtifacts: CreativeDnaArtifact[];
  jobs: Job[];
  artifacts: Artifact[];
  mediaAssets: MediaAsset[];
  acceptances: Acceptance[];
  trainingJobs: CreativeDnaTrainingJob[];
  trainingReviews: CreativeDnaTrainingReview[];
  runners: LocalRunner[];
  jobRuntime?: Record<string, { runnerId: string | null }>;
  computedAt: string;
};

const PRIORITY: Record<ProductionCockpitSeverity, number> = { critical: 0, warning: 1, info: 2 };

function elapsed(createdAt: string, completedAt: string | null | undefined, computedAt: string) {
  const start = new Date(createdAt).getTime();
  const end = new Date(completedAt || computedAt).getTime();
  return Math.max(0, Number.isFinite(start) && Number.isFinite(end) ? end - start : 0);
}

function newest<T extends { createdAt: string }>(values: T[]) {
  return [...values].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deriveProductionCockpit(input: ProductionCockpitInput): ProductionCockpit {
  const projects = new Map(input.projects.map((project) => [project.id, project]));
  const dna = new Map(input.dnaArtifacts.map((artifact) => [artifact.artifactId, artifact]));
  const artifactsByJob = new Map(input.artifacts.map((artifact) => [artifact.jobId, artifact]));
  const acceptances = newest(input.acceptances);
  const reviews = newest(input.trainingReviews);
  const retriedJobIds = new Set(input.jobs.flatMap((job) => job.retryOfJobId ? [job.retryOfJobId] : []));
  const runners = new Map(input.runners.map((runner) => [runner.id, runner]));
  const activeGeneration = newest(input.jobs.filter((job) => job.status === "queued" || job.status === "running"));
  const activeTraining = newest(input.trainingJobs.filter((job) => job.status === "waiting-for-runner" || job.status === "running"));
  const queue = [...activeGeneration.map((job) => ({ id: job.id, createdAt: job.createdAt })), ...activeTraining.map((job) => ({ id: job.id, createdAt: job.createdAt }))]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const queuePosition = new Map(queue.map((item, index) => [item.id, index + 1]));

  const generationRuns: ProductionCockpitRun[] = input.jobs.map((job) => {
    const artifact = artifactsByJob.get(job.id) ?? null;
    const decision = artifact ? acceptances.find((item) => item.artifactId === artifact.id)?.decision ?? "unreviewed" : "not-applicable";
    const blueprint = dna.get(job.dnaArtifactId) ?? null;
    const runnerId = input.jobRuntime?.[job.id]?.runnerId ?? input.runners.find((runner) => runner.activeJobId === job.id)?.id ?? null;
    const runner = runnerId ? runners.get(runnerId) ?? null : null;
    return {
      id: job.id,
      kind: "generation",
      projectId: job.projectId,
      projectName: projects.get(job.projectId)?.name ?? "Unknown project",
      modality: job.modality,
      status: job.status,
      progress: job.progress,
      provider: job.provider,
      workflowName: job.settingsStamp.workflow?.name ?? null,
      workflowRevision: job.settingsStamp.workflow?.version ?? null,
      dnaArtifactId: job.dnaArtifactId,
      dnaName: blueprint?.name ?? null,
      dnaVersion: blueprint?.version ?? null,
      decision,
      runnerId,
      runnerName: runner?.name ?? null,
      runnerDevice: runner?.device ?? null,
      queuePosition: queuePosition.get(job.id) ?? null,
      durationMs: elapsed(job.createdAt, job.completedAt, input.computedAt),
      retainedBytes: artifact?.retention.size ?? 0,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  });

  const trainingRuns: ProductionCockpitRun[] = input.trainingJobs.map((job) => {
    const blueprint = job.resultDnaArtifactId ? dna.get(job.resultDnaArtifactId) ?? null : job.baseDnaArtifactId ? dna.get(job.baseDnaArtifactId) ?? null : null;
    const review = reviews.find((item) => item.trainingJobId === job.id) ?? null;
    const runner = job.runnerId ? runners.get(job.runnerId) ?? null : null;
    return {
      id: job.id,
      kind: "training",
      projectId: job.projectId,
      projectName: projects.get(job.projectId)?.name ?? "Unknown project",
      modality: "training",
      status: job.status,
      progress: job.progress,
      provider: job.provider,
      workflowName: null,
      workflowRevision: null,
      dnaArtifactId: job.resultDnaArtifactId ?? job.baseDnaArtifactId,
      dnaName: blueprint?.name ?? job.name,
      dnaVersion: blueprint?.version ?? null,
      decision: review?.decision === "approved" ? "approved" : review?.decision === "rejected" ? "rejected" : job.status === "completed" ? "unreviewed" : "not-applicable",
      runnerId: job.runnerId,
      runnerName: runner?.name ?? null,
      runnerDevice: runner?.device ?? null,
      queuePosition: queuePosition.get(job.id) ?? null,
      durationMs: elapsed(job.createdAt, job.completedAt, input.computedAt),
      retainedBytes: 0,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  });

  const actions: ProductionCockpitAction[] = [];
  for (const job of input.trainingJobs) {
    const project = projects.get(job.projectId);
    const reviewed = reviews.some((review) => review.trainingJobId === job.id);
    if (job.status === "completed" && job.resultDnaArtifactId && !reviewed) actions.push({
      id: `review-training:${job.id}`, kind: "review-training", severity: "critical", projectId: job.projectId,
      projectName: project?.name ?? "Unknown project", entityId: job.id, modality: "training",
      title: "Review trained CreativeDNA", detail: `${job.name} completed and cannot become active until you approve or reject it with a note.`,
      actionLabel: "Review trained version", surface: "dna", createdAt: job.completedAt ?? job.updatedAt,
    });
    const hasReplacement = input.trainingJobs.some((candidate) => candidate.projectId === job.projectId && candidate.createdAt > job.createdAt);
    if (job.status === "failed" && !hasReplacement) actions.push({
      id: `restart-training:${job.id}`, kind: "restart-training", severity: "warning", projectId: job.projectId,
      projectName: project?.name ?? "Unknown project", entityId: job.id, modality: "training",
      title: "Training needs attention", detail: job.error || "The local training run failed. Inspect its retained history before starting a replacement.",
      actionLabel: "Inspect and restart", surface: "dna", createdAt: job.completedAt ?? job.updatedAt,
    });
  }
  for (const artifact of input.artifacts.filter((item) => item.status === "ready")) {
    const project = projects.get(artifact.projectId);
    actions.push({
      id: `review-artifact:${artifact.id}`, kind: "review-artifact", severity: "critical", projectId: artifact.projectId,
      projectName: project?.name ?? "Unknown project", entityId: artifact.id, modality: artifact.kind,
      title: `Review retained ${artifact.kind}`, detail: `${artifact.name} is retained and waiting for an accept or reject note.`,
      actionLabel: "Review output", surface: "gallery", createdAt: artifact.updatedAt,
    });
  }
  for (const job of input.jobs.filter((item) => item.status === "failed" && !retriedJobIds.has(item.id))) {
    const project = projects.get(job.projectId);
    actions.push({
      id: `retry-generation:${job.id}`, kind: "retry-generation", severity: "warning", projectId: job.projectId,
      projectName: project?.name ?? "Unknown project", entityId: job.id, modality: job.modality,
      title: `${job.modality} production failed`, detail: job.error || "The durable job failed and can be retried without deleting its history.",
      actionLabel: "Retry as new job", surface: "queue", createdAt: job.completedAt ?? job.updatedAt,
    });
  }
  const localWorkWaiting = [...input.jobs.filter((job) => (job.status === "queued" || job.status === "running") && job.provider === "local-comfyui"), ...activeTraining];
  if (localWorkWaiting.length && !input.runners.some((runner) => runner.state === "online" || runner.state === "busy")) actions.push({
    id: "runner-offline", kind: "runner-offline", severity: "critical", projectId: null, projectName: null,
    entityId: "local-runner", modality: null, title: "Local Runner is offline",
    detail: `${localWorkWaiting.length} local ${localWorkWaiting.length === 1 ? "run is" : "runs are"} waiting for an authenticated machine.`,
    actionLabel: "Inspect runtime", surface: "runtime", createdAt: input.computedAt,
  });
  for (const runner of input.runners.filter((item) => item.state !== "revoked" && item.lastError)) actions.push({
    id: `runner-error:${runner.id}`, kind: "runner-error", severity: "warning", projectId: null, projectName: null,
    entityId: runner.id, modality: null, title: `${runner.name} reported an error`, detail: runner.lastError!,
    actionLabel: "Inspect runner", surface: "runtime", createdAt: runner.lastHeartbeatAt ?? input.computedAt,
  });

  actions.sort((a, b) => PRIORITY[a.severity] - PRIORITY[b.severity] || b.createdAt.localeCompare(a.createdAt));
  const runs = [...generationRuns, ...trainingRuns].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const retainedArtifacts = input.artifacts.filter((artifact) => artifact.retention.state === "retained");
  return {
    summary: {
      actionRequired: actions.length,
      activeRuns: activeGeneration.length + activeTraining.length,
      outputsAwaitingReview: input.artifacts.filter((artifact) => artifact.status === "ready").length,
      retainedOutputs: retainedArtifacts.length,
      failedRuns: input.jobs.filter((job) => job.status === "failed").length + input.trainingJobs.filter((job) => job.status === "failed").length,
      offlineRunners: input.runners.filter((runner) => runner.state === "offline").length,
      storedBytes: input.mediaAssets.reduce((total, asset) => total + asset.size, 0) + retainedArtifacts.reduce((total, artifact) => total + (artifact.retention.size ?? 0), 0),
      retainedFiles: input.mediaAssets.length + retainedArtifacts.length,
      activeProjects: input.projects.filter((project) => project.status === "active").length,
    },
    actions,
    runs,
    runners: input.runners.map((runner) => ({
      id: runner.id, name: runner.name, state: runner.state, version: runner.version, device: runner.device,
      activeJobId: runner.activeJobId, lastError: runner.lastError, lastHeartbeatAt: runner.lastHeartbeatAt,
    })),
    computedAt: input.computedAt,
  };
}
