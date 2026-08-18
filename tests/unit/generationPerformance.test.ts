import { describe, expect, it } from "vitest";
import {
  GENERATION_LONG_RUN_THRESHOLD_MS,
  analyzeGenerationWorkload,
  generationTiming,
  workflowRuntimeHistory,
  type Job,
} from "../../shared/contracts";

const stamp = {
  schemaVersion: 1 as const,
  source: "comfyui-workflow" as const,
  createdAt: "2026-08-18T12:00:00.000Z",
  reusedFromJobId: null,
  prompt: "A precise studio portrait with controlled light.",
  provider: "local-comfyui",
  modality: "image",
  workflow: {
    workflowId: "workflow_image",
    revisionId: "workflow_revision_4",
    version: 4,
    name: "Fast portrait",
    format: "comfyui-api" as const,
    contentHash: "abc123",
  },
  parameters: {
    "1::width": 1536,
    "1::height": 1024,
    "8::steps": 36,
    "9::batch_size": 2,
  },
  models: ["model-a.safetensors", "model-b.safetensors", "vae.safetensors"],
  inputAssetIds: ["media_reference"],
};

function job(id: string, startedAt: string, completedAt: string): Job {
  return {
    id,
    projectId: "project_performance",
    dnaArtifactId: "dna_performance",
    capability: "IMAGE_GENERATE",
    modality: "image",
    status: "completed",
    progress: 100,
    prompt: stamp.prompt,
    provider: "local-comfyui",
    upstreamId: `prompt_${id}`,
    artifactId: `artifact_${id}`,
    retryOfJobId: null,
    error: null,
    createdAt: "2026-08-18T11:59:00.000Z",
    updatedAt: completedAt,
    startedAt,
    executionStage: "completed",
    stageUpdatedAt: completedAt,
    completedAt,
    settingsStamp: stamp,
  };
}

describe("generation performance evidence", () => {
  it("extracts stamped workload factors without blaming an ordinary prompt", () => {
    const workload = analyzeGenerationWorkload(stamp);
    expect(workload).toMatchObject({ width: 1536, height: 1024, steps: 36, batchSize: 2, modelCount: 3, inputCount: 1 });
    expect(workload.megapixels).toBeCloseTo(1.572864);
    expect(workload.likelyContributors).toEqual(expect.arrayContaining([
      "1.57 MP frame size",
      "36 sampling steps",
      "batch size 2",
      "3 model files and possible first-run loading",
    ]));
    expect(workload.promptAssessment).toContain("unlikely to be the main render-time cause");
  });

  it("marks an active run after twenty minutes but keeps timing it", () => {
    const active = { ...job("active", "2026-08-18T12:00:00.000Z", "2026-08-18T12:21:00.000Z"), status: "running" as const, completedAt: null, executionStage: "rendering" as const };
    const timing = generationTiming(active, "2026-08-18T12:21:00.000Z");
    expect(timing.executionMs).toBe(21 * 60_000);
    expect(timing.executionMs).toBeGreaterThan(GENERATION_LONG_RUN_THRESHOLD_MS);
    expect(timing).toMatchObject({ isLongRunning: true, stageLabel: "Rendering in ComfyUI" });
  });

  it("uses only completed runs from the exact immutable workflow revision", () => {
    const history = workflowRuntimeHistory([
      job("fast", "2026-08-18T12:00:00.000Z", "2026-08-18T12:04:00.000Z"),
      job("slow", "2026-08-18T12:00:00.000Z", "2026-08-18T12:08:00.000Z"),
      { ...job("other", "2026-08-18T12:00:00.000Z", "2026-08-18T12:01:00.000Z"), settingsStamp: { ...stamp, workflow: { ...stamp.workflow, revisionId: "other_revision" } } },
    ], stamp.workflow.revisionId);
    expect(history).toEqual({ count: 2, medianMs: 6 * 60_000, fastestMs: 4 * 60_000 });
  });
});
