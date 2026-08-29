import { describe, expect, it } from "vitest";
import type { OvernightWorkflowSelection, StudioSnapshot, WorkflowDefinition } from "../../shared/contracts";
import {
  estimatedOvernightDuration,
  isEligibleOvernightWorkflow,
  overnightWorkflowCandidates,
  overnightWorkflowModality,
} from "../../src/features/overnight/overnightPresentation";

function workflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "workflow_image",
    projectId: "project_1",
    name: "Image workflow",
    description: "",
    sourceFileName: "image.json",
    modality: "image",
    executionState: "ready",
    currentRevision: {
      id: "revision_1",
      workflowId: "workflow_image",
      version: 1,
      parentRevisionId: null,
      format: "comfyui-api",
      contentHash: "hash",
      nodeCount: 2,
      parameters: [{
        id: "6::text",
        label: "Positive prompt",
        kind: "text",
        value: "",
        mediaKind: null,
        promptRole: "positive",
        binding: { format: "comfyui-api", nodeId: "6", inputName: "text" },
      }],
      models: ["model.safetensors"],
      createdAt: "2026-08-28T00:00:00.000Z",
    },
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("overnight presentation", () => {
  it("allows only executable prompt-only workflows from the active project", () => {
    const eligible = workflow();
    expect(isEligibleOvernightWorkflow(eligible, "project_1", "image")).toBe(true);
    expect(isEligibleOvernightWorkflow({ ...eligible, executionState: "api-export-required" }, "project_1", "image")).toBe(false);
    expect(isEligibleOvernightWorkflow({ ...eligible, projectId: "project_2" }, "project_1", "image")).toBe(false);
    expect(isEligibleOvernightWorkflow({
      ...eligible,
      currentRevision: {
        ...eligible.currentRevision,
        parameters: [...eligible.currentRevision.parameters, {
          id: "7::image",
          label: "Source image",
          kind: "media",
          value: "",
          mediaKind: "image",
          binding: { format: "comfyui-api", nodeId: "7", inputName: "image" },
        }],
      },
    }, "project_1", "image")).toBe(false);
  });

  it("normalizes audio workflows to the music lane", () => {
    expect(overnightWorkflowModality(workflow({ modality: "audio" }))).toBe("music");
    expect(overnightWorkflowModality(workflow({ modality: "3d" }))).toBeNull();
  });

  it("shows the actual immutable video duration instead of assuming five seconds", () => {
    const base = workflow();
    const video = workflow({
      id: "workflow_video",
      name: "LTX 2.5 text to video",
      sourceFileName: "video_ltx2_5_t2v.json",
      modality: "video",
      currentRevision: {
        ...base.currentRevision,
        id: "revision_video",
        workflowId: "workflow_video",
        parameters: [...base.currentRevision.parameters, {
          id: "9::duration",
          label: "Video duration seconds",
          kind: "number",
          value: 30,
          mediaKind: null,
          binding: { format: "comfyui-api", nodeId: "9", inputName: "duration" },
        }],
      },
    });
    const snapshot = { workflows: [video], recipes: [] } as unknown as StudioSnapshot;
    expect(overnightWorkflowCandidates(snapshot, "project_1", "video")[0]?.selection.videoDurationSeconds).toBe(30);
  });

  it("sums the actual selected slot mix from observed workflow medians", () => {
    const selection = (modality: "image" | "music", duration: number): OvernightWorkflowSelection => ({
      modality,
      recipeId: null,
      recipeUpdatedAt: null,
      workflowId: `workflow_${modality}`,
      workflowRevisionId: `revision_${modality}`,
      workflowName: `${modality} workflow`,
      workflowVersion: 1,
      targetModel: "model.safetensors",
      promptProfileId: "profile/1.0",
      promptOutputFormat: "natural-language",
      videoDurationSeconds: null,
      estimatedDurationMs: duration,
    });
    expect(estimatedOvernightDuration([selection("image", 60_000)], 4)).toBe(240_000);
    expect(estimatedOvernightDuration([selection("image", 60_000), selection("music", 120_000)], 4, 1)).toBe(300_000);
    expect(estimatedOvernightDuration([], 4)).toBeNull();
  });
});
