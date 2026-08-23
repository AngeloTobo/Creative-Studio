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
import { analyzeGenerationWorkload, formatGenerationDuration, generationTiming } from "./generationPerformance";

export type ProductionCockpitSurface = "dna" | "gallery" | "queue" | "runtime";
export type ProductionCockpitSeverity = "critical" | "warning" | "info";
export type ProductionCockpitDecision = "unreviewed" | "accepted" | "rejected" | "archived" | "approved" | "not-applicable";
export type ProductionCockpitActionKind =
  | "review-training"
  | "review-artifact"
  | "retry-generation"
  | "restart-training"
  | "long-running-generation"
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
  title: string;
  detail: string;
  projectId: string;
  projectName: string;
  modality: GenerationModality | "training";
  status: Job["status"] | CreativeDnaTrainingJob["status"];
  progress: number;
  provider: string;
  workflowName: string | null;
  workflowRevision: number | null;
  artifactId: string | null;
  dnaArtifactId: string | null;
  dnaName: string | null;
  dnaVersion: number | null;
  decision: ProductionCockpitDecision;
  runnerId: string | null;
  runnerName: string | null;
  runnerDevice: string | null;
  queuePosition: number | null;
  durationMs: number;
  queueMs: number | null;
  executionMs: number | null;
  stageLabel: string;
  workloadFacts: string[];
  models: string[];
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
    queuedRuns: number;
    runningRuns: number;
    completedRuns: number;
    generationRuns: number;
    trainingRuns: number;
    outputsAwaitingReview: number;
    trainingAwaitingReview: number;
    retainedOutputs: number;
    acceptedOutputs: number;
    rejectedOutputs: number;
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
    const timing = generationTiming(job, input.computedAt);
    const workload = analyzeGenerationWorkload(job.settingsStamp);
    return {
      id: job.id,
      kind: "generation",
      title: artifact?.name ?? `${job.modality === "music" ? "Music" : job.modality === "video" ? "Video" : "Image"} generation`,
      detail: job.prompt,
      projectId: job.projectId,
      projectName: projects.get(job.projectId)?.name ?? "Unknown project",
      modality: job.modality,
      status: job.status,
      progress: job.progress,
      provider: job.provider,
      workflowName: job.settingsStamp.workflow?.name ?? null,
      workflowRevision: job.settingsStamp.workflow?.version ?? null,
      artifactId: artifact?.id ?? null,
      dnaArtifactId: job.dnaArtifactId,
      dnaName: blueprint?.name ?? null,
      dnaVersion: blueprint?.version ?? null,
      decision,
      runnerId,
      runnerName: runner?.name ?? null,
      runnerDevice: runner?.device ?? null,
      queuePosition: queuePosition.get(job.id) ?? null,
      durationMs: elapsed(job.startedAt ?? job.createdAt, job.completedAt, input.computedAt),
      queueMs: timing.queueMs,
      executionMs: timing.executionMs,
      stageLabel: timing.stageLabel,
      workloadFacts: workload.facts,
      models: job.settingsStamp.models,
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
      title: job.name,
      detail: `${job.assetIds.length} upload${job.assetIds.length === 1 ? "" : "s"} · ${job.trainingExampleIds.length} accepted example${job.trainingExampleIds.length === 1 ? "" : "s"}`,
      projectId: job.projectId,
      projectName: projects.get(job.projectId)?.name ?? "Unknown project",
      modality: "training",
      status: job.status,
      progress: job.progress,
      provider: job.provider,
      workflowName: null,
      workflowRevision: null,
      artifactId: null,
      dnaArtifactId: job.resultDnaArtifactId ?? job.baseDnaArtifactId,
      dnaName: blueprint?.name ?? job.name,
      dnaVersion: blueprint?.version ?? null,
      decision: review?.decision === "approved" ? "approved" : review?.decision === "rejected" ? "rejected" : job.status === "completed" ? "unreviewed" : "not-applicable",
      runnerId: job.runnerId,
      runnerName: runner?.name ?? null,
      runnerDevice: runner?.device ?? null,
      queuePosition: queuePosition.get(job.id) ?? null,
      durationMs: elapsed(job.createdAt, job.completedAt, input.computedAt),
      queueMs: null,
      executionMs: null,
      stageLabel: job.status === "waiting-for-runner" ? "Waiting for Local Runner" : job.status === "running" ? "Training locally" : job.status === "completed" ? "Training complete" : job.status === "failed" ? "Training failed" : "Training cancelled",
      workloadFacts: [
        `${job.assetIds.length} upload${job.assetIds.length === 1 ? "" : "s"}`,
        `${job.trainingExampleIds.length} accepted example${job.trainingExampleIds.length === 1 ? "" : "s"}`,
      ],
      models: [],
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
  for (const job of activeGeneration) {
    const timing = generationTiming(job, input.computedAt);
    if (!timing.isLongRunning) continue;
    const project = projects.get(job.projectId);
    actions.push({
      id: `long-running-generation:${job.id}`, kind: "long-running-generation", severity: "warning", projectId: job.projectId,
      projectName: project?.name ?? "Unknown project", entityId: job.id, modality: job.modality,
      title: `${job.modality} run passed 20 minutes`,
      detail: `${timing.stageLabel} for ${formatGenerationDuration(timing.executionMs ?? timing.totalMs)}. The run remains active; inspect its stamped workload and exact-revision history before changing settings.`,
      actionLabel: "Inspect timing", surface: "queue", createdAt: job.stageUpdatedAt ?? job.updatedAt,
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
  const runs = [...generationRuns, ...trainingRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const retainedArtifacts = input.artifacts.filter((artifact) => artifact.retention.state === "retained");
  const latestAcceptanceByArtifact = new Map<string, Acceptance["decision"]>();
  for (const acceptance of acceptances) {
    if (!latestAcceptanceByArtifact.has(acceptance.artifactId)) latestAcceptanceByArtifact.set(acceptance.artifactId, acceptance.decision);
  }
  const allRuns = [...input.jobs, ...input.trainingJobs];
  return {
    summary: {
      actionRequired: actions.length,
      activeRuns: activeGeneration.length + activeTraining.length,
      queuedRuns: input.jobs.filter((job) => job.status === "queued").length + input.trainingJobs.filter((job) => job.status === "waiting-for-runner").length,
      runningRuns: input.jobs.filter((job) => job.status === "running").length + input.trainingJobs.filter((job) => job.status === "running").length,
      completedRuns: allRuns.filter((job) => job.status === "completed").length,
      generationRuns: input.jobs.length,
      trainingRuns: input.trainingJobs.length,
      outputsAwaitingReview: input.artifacts.filter((artifact) => artifact.status === "ready").length,
      trainingAwaitingReview: input.trainingJobs.filter((job) => job.status === "completed" && job.resultDnaArtifactId && !reviews.some((review) => review.trainingJobId === job.id)).length,
      retainedOutputs: retainedArtifacts.length,
      acceptedOutputs: input.artifacts.filter((artifact) => latestAcceptanceByArtifact.get(artifact.id) === "accepted").length,
      rejectedOutputs: input.artifacts.filter((artifact) => latestAcceptanceByArtifact.get(artifact.id) === "rejected").length,
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
