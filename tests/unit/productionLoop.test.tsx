import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  compileCreativeDna,
  deriveProjectProductionLoop,
  type Artifact,
  type CreativeDnaTrainingJob,
  type CreativeTrainingExample,
  type Project,
} from "../../shared/contracts";
import { ProductionLoopPanel } from "../../src/features/creative-dna/ProductionLoopPanel";

const createdAt = "2026-08-16T20:00:00.000Z";
const project: Project = {
  id: "project_loop",
  activeDnaArtifactId: "dna_loop",
  name: "Production Loop",
  type: "Creative System",
  status: "active",
  description: "",
  note: "",
  hue: "#d946ef",
  initials: "PL",
  createdAt,
  updatedAt: createdAt,
};
const dna = compileCreativeDna({
  name: "Measured night",
  directive: "A luminous night image with a controlled human edge.",
  targetModality: "image",
}, {
  artifactId: "dna_loop",
  projectId: project.id,
  version: 1,
  rootArtifactId: "dna_loop",
  parentArtifactId: null,
  createdAt,
});
const settingsStamp = {
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
const artifact: Artifact = {
  id: "artifact_loop",
  projectId: project.id,
  jobId: "job_loop",
  dnaArtifactId: dna.artifactId,
  kind: "image",
  name: "Measured night result",
  status: "accepted",
  provider: "local-comfyui",
  prompt: dna.generationPrompts.image,
  preview: { kind: "remote-media", url: "/media", colors: ["#111827", "#7c3aed"] },
  lineage: { sourceArtifactIds: [], parentArtifactId: null },
  retention: { state: "retained", size: 2048 },
  settingsStamp,
  createdAt,
  updatedAt: createdAt,
};
const example: CreativeTrainingExample = {
  id: "example_loop",
  projectId: project.id,
  dnaArtifactId: dna.artifactId,
  artifactId: artifact.id,
  kind: "image",
  status: "training-ready",
  prompt: artifact.prompt,
  settingsStamp,
  createdAt,
  updatedAt: createdAt,
};

function trainingJob(status: CreativeDnaTrainingJob["status"]): CreativeDnaTrainingJob {
  return {
    id: "training_loop",
    projectId: project.id,
    baseDnaArtifactId: dna.artifactId,
    resultDnaArtifactId: null,
    name: "Next DNA",
    targetModality: "image",
    status,
    progress: 0,
    provider: "local-creative-dna-runner",
    assetIds: [],
    trainingExampleIds: [example.id],
    runnerId: null,
    error: null,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    completedAt: null,
  };
}

function derive(trainingJobs: CreativeDnaTrainingJob[] = []) {
  return deriveProjectProductionLoop({
    project,
    dnaArtifacts: [dna],
    jobs: [],
    artifacts: [artifact],
    trainingExamples: [example],
    trainingJobs,
    trainingReviews: [],
    computedAt: createdAt,
  });
}

describe("CreativeDNA production loop", () => {
  it("prioritizes a completed trained-version review even when no DNA is active yet", () => {
    const pendingDna = { ...dna, training: {} as NonNullable<typeof dna.training> };
    const pendingJob = {
      ...trainingJob("completed"),
      resultDnaArtifactId: pendingDna.artifactId,
      progress: 100,
      completedAt: createdAt,
    };
    const loop = deriveProjectProductionLoop({
      project: { ...project, activeDnaArtifactId: null },
      dnaArtifacts: [pendingDna],
      jobs: [],
      artifacts: [],
      trainingExamples: [],
      trainingJobs: [pendingJob],
      trainingReviews: [],
      computedAt: createdAt,
    });
    expect(loop).toMatchObject({
      stage: "review-training",
      activeDnaArtifactId: null,
      pendingTrainingReviewJobId: pendingJob.id,
      nextAction: { surface: "training", label: "Review trained version" },
    });
  });

  it("routes fresh accepted evidence into the next explicit owner action", () => {
    const loop = derive();
    expect(loop).toMatchObject({
      stage: "evidence-ready",
      activeDnaArtifactId: dna.artifactId,
      freshTrainingExampleIds: [example.id],
      usedTrainingExampleIds: [],
      nextAction: { surface: "training", label: "Train next version" },
    });
    const markup = renderToStaticMarkup(<ProductionLoopPanel loop={loop} onAction={() => undefined} />);
    expect(markup).toContain("Make, decide, learn, repeat");
    expect(markup).toContain("Train next version");
    expect(markup).toContain("1 fresh evidence");
  });

  it("does not silently reuse evidence captured by a durable run and releases it after cancellation", () => {
    const reserved = derive([trainingJob("waiting-for-runner")]);
    expect(reserved.stage).toBe("training-running");
    expect(reserved.freshTrainingExampleIds).toEqual([]);
    expect(reserved.usedTrainingExampleIds).toEqual([example.id]);

    const released = derive([trainingJob("cancelled")]);
    expect(released.stage).toBe("evidence-ready");
    expect(released.freshTrainingExampleIds).toEqual([example.id]);
  });
});
