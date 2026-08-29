import { describe, expect, it } from "vitest";
import {
  THIRTY_SECOND_VIDEO_STRATEGY_SIMULATION,
  TRUSTED_LTX_25_I2V_PORTRAIT_30S,
  assessTrustedVideoPresetExecution,
  assessTrustedVideoPresetGraph,
  assessTrustedVideoPresetSupport,
  inspectWorkflowGraph,
  matchesTrustedVideoPreset,
  simulateThirtySecondVideoStrategies,
  trustedVideoGraphFamilyHash,
  trustedVideoPresetParameterOverrides,
  trustedVideoPresetStamp,
  type GenerationSettingsStamp,
  type WorkflowDefinition,
  type WorkflowScalar,
} from "../../shared/contracts";
import { TRUSTED_LTX_25_I2V_GRAPH_FIXTURE } from "../worker/fixtures/trustedLtx25I2vGraph";

const CREATED_AT = "2026-08-29T12:00:00.000Z";

function graphFixture() {
  return structuredClone(TRUSTED_LTX_25_I2V_GRAPH_FIXTURE);
}

function ltxWorkflow(graph = graphFixture()): WorkflowDefinition {
  const inspection = inspectWorkflowGraph(graph);
  return {
    id: "workflow_ltx_25_i2v",
    projectId: "project_video",
    name: "LTX 2.5 Image to Video",
    description: "Production LTX 2.5 image-to-video graph",
    sourceFileName: "video_ltx2_5_i2v.json",
    modality: inspection.modality,
    executionState: "ready",
    currentRevision: {
      id: "workflowrev_ltx_25_i2v_12",
      workflowId: "workflow_ltx_25_i2v",
      version: 12,
      parentRevisionId: "workflowrev_ltx_25_i2v_11",
      format: inspection.format,
      contentHash: "sha256:production-ltx-25-i2v",
      nodeCount: inspection.nodeCount,
      models: inspection.models,
      parameters: inspection.parameters,
      createdAt: CREATED_AT,
    },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function withValues(workflow: WorkflowDefinition, values: Record<string, WorkflowScalar>): WorkflowDefinition {
  return {
    ...workflow,
    currentRevision: {
      ...workflow.currentRevision,
      parameters: workflow.currentRevision.parameters.map((item) => (
        Object.prototype.hasOwnProperty.call(values, item.id) ? { ...item, value: values[item.id] } : item
      )),
    },
  };
}

function trustedStamp(): GenerationSettingsStamp {
  return {
    schemaVersion: 1,
    source: "comfyui-workflow",
    createdAt: CREATED_AT,
    reusedFromJobId: null,
    prompt: "A reflective figure turns through violet light.",
    provider: "local-comfyui",
    modality: "video",
    videoDurationSeconds: 30,
    videoPerformance: {
      schemaVersion: "creative-studio-video-performance/1.0",
      mode: "explicit-heavy",
      workflowRevisionId: "workflowrev_ltx_25_i2v_12",
      trustedPreset: trustedVideoPresetStamp(),
      workload: {
        durationSeconds: 30,
        width: null,
        height: null,
        megapixels: 0.2,
        frames: 721,
        fps: 24,
        requiresExplicitHeavy: true,
        reasons: ["30s exceeds the 5s fast limit"],
      },
    },
    workflow: {
      workflowId: "workflow_ltx_25_i2v",
      revisionId: "workflowrev_ltx_25_i2v_12",
      version: 12,
      name: "LTX 2.5 Image to Video",
      format: "comfyui-api",
      contentHash: "sha256:production-ltx-25-i2v",
    },
    parameters: Object.fromEntries(ltxWorkflow().currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])),
    models: [...TRUSTED_LTX_25_I2V_PORTRAIT_30S.requiredModels],
    inputAssetIds: ["media_start_frame"],
    inputArtifactIds: [],
    outputBatch: {
      schemaVersion: "creative-studio-output-batch/1.0",
      batchId: "batch_trusted_30s",
      index: 1,
      count: 1,
    },
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .reverse()
    .map(([key, item]) => [key, reverseObjectKeys(item)]));
}

describe("trusted 30-second LTX video preset", () => {
  it("supports only the exact production parameter surface and control bindings", () => {
    expect(assessTrustedVideoPresetSupport(ltxWorkflow())).toEqual({
      supported: true,
      matches: false,
      reasons: [],
    });

    const missingControl = ltxWorkflow();
    missingControl.currentRevision.parameters = missingControl.currentRevision.parameters
      .filter((item) => item.id !== "398:380::thinking");
    expect(assessTrustedVideoPresetSupport(missingControl)).toMatchObject({
      supported: false,
      matches: false,
    });
    expect(assessTrustedVideoPresetSupport(missingControl).reasons).toContain("required parameter 398:380::thinking is missing");

    const wrongNodeCount = ltxWorkflow();
    wrongNodeCount.currentRevision.nodeCount = 49;
    expect(assessTrustedVideoPresetSupport(wrongNodeCount).reasons).toContain("node count differs from the measured graph");
  });

  it("overrides exact measured controls and never prompt, seed, or retained media", () => {
    const workflow = ltxWorkflow();
    const overrides = trustedVideoPresetParameterOverrides(workflow.currentRevision.parameters);

    expect(overrides).toMatchObject({
      "398:362::value": 30,
      "403::aspect_ratio": "9:16 (Portrait Widescreen)",
      "403::megapixels": 0.2,
      "398:361::value": 24,
      "398:380::thinking": false,
      "398:383::value": true,
      "398:363::value": false,
      "398:352::sampler_name": "euler_ancestral",
      "398:341::sampler_name": "euler_ancestral",
      "398:388::video_cfg": 1,
      "398:391::video_cfg": 1,
      "398:388::audio_cfg": 1,
      "398:391::audio_cfg": 1,
      "398:357::strength": 0.7,
      "398:349::strength": 1,
      "398:356::batch_size": 1,
      "398:366::batch_size": 1,
    });
    expect(overrides).not.toHaveProperty("395::image");
    expect(overrides).not.toHaveProperty("398:376::value");
    expect(overrides).not.toHaveProperty("398:373::text");
    expect(overrides).not.toHaveProperty("398:339::noise_seed");
    expect(overrides).not.toHaveProperty("398:338::noise_seed");
  });

  it("matches the exact production execution, including ordered stage strengths", () => {
    expect(assessTrustedVideoPresetExecution(ltxWorkflow(), 1)).toEqual({
      supported: true,
      matches: true,
      reasons: [],
    });
    expect(assessTrustedVideoPresetExecution(withValues(ltxWorkflow(), {
      "398:357::strength": 1,
      "398:349::strength": 0.7,
    }), 1).reasons).toContain("stage image strengths must remain 1 then 0.7");
  });

  it.each([
    ["duration", "398:362::value", 15, "duration must be 30 seconds"],
    ["aspect ratio", "403::aspect_ratio", "16:9 (Widescreen)", "aspect ratio must be 9:16"],
    ["resolution", "403::megapixels", 0.5, "resolution must be 0.20 MP"],
    ["frame rate", "398:361::value", 30, "frame rate must be 24 fps"],
    ["thinking", "398:380::thinking", true, "prompt-enhancement thinking must be disabled"],
    ["prompt enhancement", "398:383::value", false, "internal prompt enhancement must be enabled"],
    ["image-to-video mode", "398:363::value", true, "image-to-video mode must remain enabled"],
    ["first sampler", "398:352::sampler_name", "dpmpp_2m", "samplers must be euler_ancestral"],
    ["second sampler", "398:341::sampler_name", "dpmpp_2m", "samplers must be euler_ancestral"],
    ["first video CFG", "398:388::video_cfg", 1.5, "video CFG must be 1"],
    ["second audio CFG", "398:391::audio_cfg", 1.5, "audio CFG must be 1"],
    ["first strength", "398:357::strength", 0.8, "stage image strengths must remain 1 then 0.7"],
    ["second strength", "398:349::strength", 0.8, "stage image strengths must remain 1 then 0.7"],
    ["video batch", "398:356::batch_size", 2, "batch size must be 1"],
    ["audio batch", "398:366::batch_size", 2, "batch size must be 1"],
  ] as const)("rejects %s drift", (_label, id, value, reason) => {
    expect(assessTrustedVideoPresetExecution(withValues(ltxWorkflow(), { [id]: value }), 1).reasons).toContain(reason);
  });

  it("rejects multiple outputs and model-inventory drift", () => {
    expect(assessTrustedVideoPresetExecution(ltxWorkflow(), 2).reasons).toContain("trusted speed requires one output");
    const wrongModel = ltxWorkflow();
    wrongModel.currentRevision.models = [
      ...TRUSTED_LTX_25_I2V_PORTRAIT_30S.requiredModels.slice(0, -1),
      "different-video-vae.safetensors",
    ];
    expect(assessTrustedVideoPresetExecution(wrongModel, 1).reasons)
      .toContain("model inventory differs from the measured graph");
  });

  it("pins the exact 50-node graph family while allowing only versioned owner controls", async () => {
    const graph = graphFixture();
    expect(await trustedVideoGraphFamilyHash(graph)).toBe(TRUSTED_LTX_25_I2V_PORTRAIT_30S.graphFamily.sha256);
    expect(await trustedVideoGraphFamilyHash(reverseObjectKeys(graph))).toBe(TRUSTED_LTX_25_I2V_PORTRAIT_30S.graphFamily.sha256);

    const ownerVariable = graphFixture() as Record<string, { inputs: Record<string, unknown>; _meta?: Record<string, unknown> }>;
    ownerVariable["398:376"].inputs.value = "A completely different authored prompt.";
    ownerVariable["398:339"].inputs.noise_seed = 999_123;
    ownerVariable["403"].inputs.megapixels = 0.5;
    ownerVariable["398:397"]._meta = { title: "A renamed display-only node" };
    expect(await trustedVideoGraphFamilyHash(ownerVariable)).toBe(TRUSTED_LTX_25_I2V_PORTRAIT_30S.graphFamily.sha256);
  });

  it.each([
    ["first-pass schedule", (graph: Record<string, { class_type?: string; inputs: Record<string, unknown> }>) => { graph["398:397"].inputs.sigmas = "1.0, 0.5, 0.0"; }],
    ["refine schedule", (graph: Record<string, { class_type?: string; inputs: Record<string, unknown> }>) => { graph["398:396"].inputs.sigmas = "0.85, 0.0"; }],
    ["tiled VAE", (graph: Record<string, { class_type?: string; inputs: Record<string, unknown> }>) => { graph["398:374"].inputs.tile_size = 1024; }],
    ["upscaler", (graph: Record<string, { class_type?: string; inputs: Record<string, unknown> }>) => { graph["398:371"].inputs.model_name = "other-upscaler.safetensors"; }],
    ["edge", (graph: Record<string, { class_type?: string; inputs: Record<string, unknown> }>) => { graph["398:348"].inputs.samples = ["398:340", 0]; }],
    ["class", (graph: Record<string, { class_type?: string; inputs: Record<string, unknown> }>) => { graph["398:348"].class_type = "Passthrough"; }],
  ])("rejects hidden %s graph drift", async (_label, mutate) => {
    const graph = graphFixture() as Record<string, { class_type?: string; inputs: Record<string, unknown> }>;
    mutate(graph);
    expect(await assessTrustedVideoPresetGraph(graph)).toMatchObject({ supported: false, matches: false });
  });

  it("rejects missing nodes and exposed-control type drift", async () => {
    const missing = graphFixture() as Record<string, unknown>;
    delete missing["398:374"];
    expect(await assessTrustedVideoPresetGraph(missing)).toMatchObject({ supported: false, matches: false });

    const wrongType = graphFixture() as Record<string, { inputs: Record<string, unknown> }>;
    wrongType["398:362"].inputs.value = "30";
    expect(await assessTrustedVideoPresetGraph(wrongType)).toMatchObject({ supported: false, matches: false });
  });

  it("recognizes only a graph-bound server stamp", () => {
    const exact = trustedStamp();
    expect(matchesTrustedVideoPreset(exact)).toBe(true);
    expect(matchesTrustedVideoPreset({
      ...exact,
      videoPerformance: {
        ...exact.videoPerformance!,
        trustedPreset: {
          ...exact.videoPerformance!.trustedPreset!,
          graphFamily: { ...exact.videoPerformance!.trustedPreset!.graphFamily, sha256: "forged" },
        },
      },
    })).toBe(false);
    expect(matchesTrustedVideoPreset({
      ...exact,
      videoPerformance: { ...exact.videoPerformance!, workload: { ...exact.videoPerformance!.workload, frames: 720 } },
    })).toBe(false);
  });

  it("keeps the 100,000-trial comparison static and immune to unrelated history", () => {
    expect(simulateThirtySecondVideoStrategies())
      .toEqual(THIRTY_SECOND_VIDEO_STRATEGY_SIMULATION);
  });

  it("records runtime trust without claiming artist-reviewed quality", () => {
    const definition = TRUSTED_LTX_25_I2V_PORTRAIT_30S;
    const stamp = trustedVideoPresetStamp();
    expect(definition.evidence.completedRuns).toBe(definition.evidence.terminalRuns);
    expect(stamp.graphFamily).toMatchObject({
      sha256: definition.graphFamily.sha256,
      nodeCount: 50,
      firstPassSteps: 8,
      refinePassSteps: 3,
      latentUpscale: "2x",
      decode: "tiled-vae",
    });
    expect(stamp.evidence.qualityStatus).toBe("unreviewed");
  });
});
