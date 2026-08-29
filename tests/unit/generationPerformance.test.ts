import { describe, expect, it } from "vitest";
import {
  GENERATION_LONG_RUN_THRESHOLD_MS,
  assessImagePerformance,
  assessVideoPerformance,
  analyzeGenerationWorkload,
  canonicalGenerationPerformanceParameters,
  fastImageParameterOverrides,
  generationProviderWorkloadProfile,
  generationTiming,
  withGenerationProviderWorkload,
  workflowRuntimeHistory,
  type Job,
  type GenerationSettingsStamp,
  type SubmitJobRequest,
  type WorkflowParameter,
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
  it("types video consent separately in the submission and immutable durable stamp", () => {
    const request = {
      projectId: "project_video",
      dnaArtifactId: "dna_video",
      modality: "video",
      idempotencyKey: "video_contract_0001",
      videoPerformanceMode: "explicit-heavy",
    } satisfies SubmitJobRequest;
    const durable = {
      schemaVersion: 1,
      source: "comfyui-workflow",
      createdAt: "2026-08-29T00:00:00.000Z",
      reusedFromJobId: null,
      prompt: "A figure crosses the frame.",
      provider: "local-comfyui",
      modality: "video",
      videoDurationSeconds: 30,
      videoPerformance: {
        schemaVersion: "creative-studio-video-performance/1.0",
        mode: request.videoPerformanceMode,
        workflowRevisionId: "workflowrev_video_30s",
        workload: { durationSeconds: 30, width: 352, height: 624, megapixels: 0.5, frames: 721, fps: 24, requiresExplicitHeavy: true, reasons: ["30s exceeds the 5s fast limit"] },
      },
      workflow: { workflowId: "workflow_video", revisionId: "workflowrev_video_30s", version: 2, name: "LTX 2.5", format: "comfyui-api", contentHash: "abc" },
      parameters: {}, models: [], inputAssetIds: [],
    } satisfies GenerationSettingsStamp;
    expect(durable.videoPerformance.mode).toBe("explicit-heavy");
    expect(durable.videoPerformance.workflowRevisionId).toBe(durable.workflow.revisionId);
  });

  it("uses semantic Comfy primitive labels and the worst exposed video controls", () => {
    const parameters: WorkflowParameter[] = [
      { id: "10::value", label: "Width", kind: "number", value: 448, mediaKind: null, binding: { format: "comfyui-api", nodeId: "10", inputName: "value" } },
      { id: "11::value", label: "Height", kind: "number", value: 448, mediaKind: null, binding: { format: "comfyui-api", nodeId: "11", inputName: "value" } },
      { id: "12::value", label: "Megapixels", kind: "number", value: 0.5, mediaKind: null, binding: { format: "comfyui-api", nodeId: "12", inputName: "value" } },
      { id: "13::value", label: "Frame Rate", kind: "number", value: 24, mediaKind: null, binding: { format: "comfyui-api", nodeId: "13", inputName: "value" } },
      { id: "14::value", label: "Frames", kind: "number", value: 721, mediaKind: null, binding: { format: "comfyui-api", nodeId: "14", inputName: "value" } },
    ];
    const projected = canonicalGenerationPerformanceParameters(parameters);
    expect(projected).toMatchObject({
      "creative-studio::width": 448,
      "creative-studio::height": 448,
      "creative-studio::megapixels": 0.5,
      "creative-studio::fps": 24,
      "creative-studio::frames": 721,
    });
    const assessment = assessVideoPerformance({
      parameters: projected,
      models: [], inputAssetIds: [], inputArtifactIds: [], prompt: "", videoDurationSeconds: 5,
    });
    expect(assessment.requiresExplicitHeavy).toBe(true);
    expect(assessment.workload.megapixels).toBe(0.5);
    expect(assessment.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("0.5 MP"),
      expect.stringContaining("721 frames"),
    ]));
  });

  it("keeps the proven 5s 0.2 MP timeline fast and requires explicit consent for costly or unknown evidence", () => {
    const source = (parameters: Record<string, string | number | boolean>, durationSeconds?: number) => ({
      parameters, models: [], inputAssetIds: [], inputArtifactIds: [], prompt: "", videoDurationSeconds: durationSeconds,
    });
    expect(assessVideoPerformance(source({ megapixels: 0.2, fps: 24, frames: 121 }, 5)).requiresExplicitHeavy).toBe(false);
    expect(assessVideoPerformance(source({ megapixels: 0.5, fps: 24, frames: 721 }, 30)).requiresExplicitHeavy).toBe(true);
    expect(assessVideoPerformance(source({ megapixels: 0.2, frames: 721 }, 5)).reasons).toEqual(expect.arrayContaining([expect.stringContaining("without exposed fps")]));
    expect(assessVideoPerformance(source({ megapixels: 0.2, fps: 60, frames: 301 }, 5)).reasons).toEqual(expect.arrayContaining([expect.stringContaining("60 fps")]));
    expect(assessVideoPerformance(source({}, undefined)).reasons).toEqual(expect.arrayContaining([
      "duration is not exposed by this workflow",
      "resolution is not exposed by this workflow",
    ]));
  });

  it("reduces a costly image workflow to the proven fast local target without changing creative controls", () => {
    const parameters: WorkflowParameter[] = [
      { id: "13::width", label: "Width", kind: "number", value: 1024, mediaKind: null, binding: { format: "comfyui-api", nodeId: "13", inputName: "width" } },
      { id: "13::height", label: "Height", kind: "number", value: 1024, mediaKind: null, binding: { format: "comfyui-api", nodeId: "13", inputName: "height" } },
      { id: "3::steps", label: "Steps", kind: "number", value: 30, mediaKind: null, binding: { format: "comfyui-api", nodeId: "3", inputName: "steps" } },
      { id: "13::batch_size", label: "Batch", kind: "number", value: 2, mediaKind: null, binding: { format: "comfyui-api", nodeId: "13", inputName: "batch_size" } },
      { id: "3::seed", label: "Seed", kind: "number", value: 42, mediaKind: null, binding: { format: "comfyui-api", nodeId: "3", inputName: "seed" } },
      { id: "2::text", label: "Prompt", kind: "text", value: "Keep this exact scene", mediaKind: null, binding: { format: "comfyui-api", nodeId: "2", inputName: "text" } },
    ];
    const overrides = fastImageParameterOverrides(parameters);
    expect(overrides).toEqual({ "13::width": 512, "13::height": 512, "3::steps": 8, "13::batch_size": 1 });
    expect(overrides).not.toHaveProperty("3::seed");
    expect(overrides).not.toHaveProperty("2::text");
    expect(assessImagePerformance(Object.fromEntries(parameters.map((parameter) => [parameter.id, overrides[parameter.id] ?? parameter.value])))).toEqual({ requiresExplicitCustom: false, reasons: [] });
  });

  it("requires an explicit custom choice when resolution or steps cannot be verified", () => {
    expect(assessImagePerformance({ "2::text": "A scene", "3::seed": 42 })).toMatchObject({
      requiresExplicitCustom: true,
      reasons: ["resolution is not exposed by this workflow", "sampling steps are not exposed by this workflow"],
    });
  });

  it("projects the versioned AFDFW image profile into complete direct-generation evidence", () => {
    const profile = generationProviderWorkloadProfile("afdfw-z-image", "image");
    expect(profile).toMatchObject({
      profileId: "afdfw-z-image-bridge-v1",
      parameters: { width: 768, height: 1216, steps: 32, frames: 1, batch_size: 1 },
      models: ["z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors", "ae.safetensors"],
    });
    const enriched = withGenerationProviderWorkload({
      ...stamp,
      workflow: null,
      provider: "afdfw-z-image",
      parameters: { prompt: stamp.prompt },
      models: [],
    });
    expect(enriched.workloadEvidence).toMatchObject({ source: "provider-profile", profileId: "afdfw-z-image-bridge-v1" });
    expect(analyzeGenerationWorkload(enriched)).toMatchObject({
      width: 768,
      height: 1216,
      steps: 32,
      frames: 1,
      modelCount: 3,
    });
    expect(analyzeGenerationWorkload(enriched).facts).toEqual(expect.arrayContaining(["768×1216 · 0.93 MP", "32 steps", "1 frame", "3 models"]));
  });

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
    expect(timing).toMatchObject({ isLongRunning: true, stageLabel: "Rendering in ComfyUI", comfyApiUnresponsive: false });
  });

  it("distinguishes a live runner heartbeat from a stale Comfy observation", () => {
    const active = {
      ...job("unresponsive", "2026-08-18T12:00:00.000Z", "2026-08-18T12:21:00.000Z"),
      status: "running" as const,
      completedAt: null,
      executionStage: "rendering" as const,
      stageUpdatedAt: "2026-08-18T12:18:00.000Z",
      updatedAt: "2026-08-18T12:21:00.000Z",
    };
    expect(generationTiming(active, "2026-08-18T12:21:00.000Z")).toMatchObject({
      comfyApiUnresponsive: true,
      comfyObservationAgeMs: 3 * 60_000,
      stageLabel: "ComfyUI API unresponsive; GPU may still be rendering",
    });
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
