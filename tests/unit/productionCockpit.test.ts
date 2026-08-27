import { describe, expect, it } from "vitest";
import {
  compileCreativeDna,
  deriveProductionCockpit,
  type Artifact,
  type CreativeDnaTrainingJob,
  type Job,
  type MediaAsset,
  type Project,
  type ProductionCockpitInput,
} from "../../shared/contracts";

const createdAt = "2026-08-16T20:00:00.000Z";
const computedAt = "2026-08-16T20:05:00.000Z";
const project: Project = {
  id: "project_cockpit",
  activeDnaArtifactId: "dna_cockpit",
  name: "Cockpit Project",
  type: "Production System",
  status: "active",
  description: "",
  note: "",
  hue: "#d946ef",
  initials: "CP",
  createdAt,
  updatedAt: createdAt,
};
const dna = compileCreativeDna({
  name: "Cockpit DNA",
  directive: "A precise luminous image with controlled contrast and a tactile edge.",
  targetModality: "image",
}, {
  artifactId: "dna_cockpit",
  projectId: project.id,
  version: 1,
  rootArtifactId: "dna_cockpit",
  parentArtifactId: null,
  createdAt,
});
const stamp = {
  schemaVersion: 1 as const,
  source: "creative-dna" as const,
  createdAt,
  reusedFromJobId: null,
  prompt: dna.generationPrompts.image,
  provider: "local-comfyui",
  modality: "image",
  workflow: null,
  parameters: {},
  models: [],
  inputAssetIds: [],
};

function job(id: string, status: Job["status"], retryOfJobId: string | null = null): Job {
  return {
    id,
    projectId: project.id,
    dnaArtifactId: dna.artifactId,
    capability: "IMAGE_GENERATE",
    modality: "image",
    status,
    progress: status === "completed" ? 100 : 0,
    prompt: stamp.prompt,
    provider: "local-comfyui",
    upstreamId: null,
    artifactId: status === "completed" ? "artifact_cockpit" : null,
    retryOfJobId,
    error: status === "failed" ? "ComfyUI model unavailable" : null,
    createdAt,
    updatedAt: createdAt,
    startedAt: status === "queued" ? null : createdAt,
    executionStage: status === "completed" ? "completed" : status === "failed" ? "failed" : status === "running" ? "rendering" : "queued",
    stageUpdatedAt: createdAt,
    completedAt: status === "failed" || status === "completed" ? createdAt : null,
    settingsStamp: stamp,
  };
}

const artifact: Artifact = {
  id: "artifact_cockpit",
  projectId: project.id,
  jobId: "job_completed",
  dnaArtifactId: dna.artifactId,
  kind: "image",
  name: "Retained output",
  status: "ready",
  provider: "local-comfyui",
  prompt: stamp.prompt,
  preview: { kind: "remote-media", url: "/media", colors: ["#111827", "#7c3aed"] },
  lineage: { sourceArtifactIds: [], parentArtifactId: null },
  retention: { state: "retained", size: 4096 },
  settingsStamp: stamp,
  createdAt,
  updatedAt: createdAt,
};
const media: MediaAsset = {
  id: "media_cockpit",
  projectId: project.id,
  kind: "image",
  name: "Source",
  originalFileName: "source.png",
  mimeType: "image/png",
  size: 1024,
  source: "upload",
  status: "retained",
  contentUrl: "/source",
  trainingEligible: true,
  provenance: { uploadedByOwner: true, uploadedAt: createdAt, parentAssetIds: [] },
  createdAt,
  updatedAt: createdAt,
};
const training: CreativeDnaTrainingJob = {
  id: "training_cockpit",
  projectId: project.id,
  baseDnaArtifactId: dna.artifactId,
  resultDnaArtifactId: "dna_trained",
  name: "Cockpit DNA trained",
  targetModality: "image",
  status: "completed",
  progress: 100,
  provider: "local-creative-dna-runner",
  assetIds: [media.id],
  trainingExampleIds: [],
  runnerId: null,
  error: null,
  createdAt,
  updatedAt: createdAt,
  startedAt: createdAt,
  completedAt: createdAt,
};

function input(jobs: Job[]): ProductionCockpitInput {
  return {
    projects: [project],
    dnaArtifacts: [dna],
    jobs,
    artifacts: [artifact],
    mediaAssets: [media],
    acceptances: [],
    trainingJobs: [training],
    trainingReviews: [],
    runners: [],
    computedAt,
  };
}

describe("production cockpit", () => {
  it("derives cross-project actions, queue state, retained storage, and durable history", () => {
    const cockpit = deriveProductionCockpit(input([
      job("job_failed", "failed"),
      job("job_queued", "queued"),
      job("job_completed", "completed"),
    ]));

    expect(cockpit.summary).toMatchObject({
      actionRequired: 4,
      activeRuns: 1,
      queuedRuns: 1,
      runningRuns: 0,
      completedRuns: 2,
      generationRuns: 3,
      trainingRuns: 1,
      outputsAwaitingReview: 1,
      trainingAwaitingReview: 1,
      retainedOutputs: 1,
      failedRuns: 1,
      storedBytes: 5120,
      retainedFiles: 2,
      activeProjects: 1,
    });
    expect(cockpit.actions.map((action) => action.kind)).toEqual([
      "runner-offline",
      "review-training",
      "review-artifact",
      "retry-generation",
    ]);
    expect(cockpit.runs.find((run) => run.id === "job_queued")).toMatchObject({
      projectName: project.name,
      queuePosition: 1,
      dnaName: dna.name,
      decision: "not-applicable",
    });
    expect(cockpit.runs.find((run) => run.id === "job_completed")).toMatchObject({
      title: artifact.name,
      artifactId: artifact.id,
      retainedBytes: 4096,
      decision: "unreviewed",
      stageLabel: "Completed and retained",
    });
  });

  it("orders generation and training activity newest to oldest by creation time", () => {
    const newestJob = { ...job("job_newest", "queued"), createdAt: "2026-08-16T20:04:00.000Z", updatedAt: "2026-08-16T20:04:00.000Z" };
    const olderJobWithRecentUpdate = { ...job("job_older", "running"), createdAt: "2026-08-16T19:00:00.000Z", updatedAt: "2026-08-16T20:05:00.000Z" };
    const cockpit = deriveProductionCockpit(input([olderJobWithRecentUpdate, newestJob]));

    expect(cockpit.runs.map((run) => run.id)).toEqual(["job_newest", "training_cockpit", "job_older"]);
  });

  it("keeps failed runs in history but resolves their retry action after a durable replacement exists", () => {
    const cockpit = deriveProductionCockpit(input([
      job("job_failed", "failed"),
      { ...job("job_retry", "queued", "job_failed"), createdAt: "2026-08-16T20:01:00.000Z" },
      job("job_completed", "completed"),
    ]));

    expect(cockpit.summary.failedRuns).toBe(1);
    expect(cockpit.runs.some((run) => run.id === "job_failed" && run.status === "failed")).toBe(true);
    expect(cockpit.actions.some((action) => action.kind === "retry-generation")).toBe(false);
  });

  it("keeps a cancelled generation actionable until a durable replacement exists", () => {
    const cancelled = { ...job("job_cancelled", "cancelled"), error: "cancelled_by_user" };
    const cockpit = deriveProductionCockpit(input([cancelled]));

    expect(cockpit.runs).toContainEqual(expect.objectContaining({ id: cancelled.id, status: "cancelled" }));
    expect(cockpit.actions).toContainEqual(expect.objectContaining({
      kind: "retry-generation",
      entityId: cancelled.id,
      title: "image production cancelled",
    }));
  });

  it("raises a visible warning after a generation runs for twenty minutes without marking it failed", () => {
    const running = {
      ...job("job_long", "running"),
      createdAt: "2026-08-16T19:39:00.000Z",
      startedAt: "2026-08-16T19:40:00.000Z",
      updatedAt: "2026-08-16T20:04:00.000Z",
      stageUpdatedAt: "2026-08-16T20:04:00.000Z",
      executionStage: "rendering" as const,
    };
    const cockpit = deriveProductionCockpit(input([running]));
    expect(cockpit.actions).toContainEqual(expect.objectContaining({
      kind: "long-running-generation",
      entityId: running.id,
      title: "image run passed 20 minutes",
    }));
    expect(cockpit.runs.find((run) => run.id === running.id)).toMatchObject({ status: "running", durationMs: 25 * 60_000 });
  });
});
