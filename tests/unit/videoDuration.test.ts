import { describe, expect, it } from "vitest";
import {
  normalizeVideoDurationSeconds,
  videoDurationLabel,
  videoWorkflowDurationParameters,
  videoWorkflowDurationProfile,
  workflowSupportsVideoDuration,
  type WorkflowDefinition,
  type WorkflowParameter,
} from "../../shared/contracts";

function numberParameter(id: string, label: string, inputName: string, value: number): WorkflowParameter {
  return {
    id,
    label,
    kind: "number",
    value,
    mediaKind: null,
    binding: { format: "comfyui-api", nodeId: id.split("::")[0], inputName },
  };
}

function workflow(name: string, parameters: WorkflowParameter[]): WorkflowDefinition {
  return {
    id: `workflow_${name}`,
    projectId: "project_1",
    name,
    description: "",
    sourceFileName: `${name}.json`,
    modality: "video",
    executionState: "ready",
    currentRevision: {
      id: `revision_${name}`,
      workflowId: `workflow_${name}`,
      version: 1,
      parentRevisionId: null,
      format: "comfyui-api",
      contentHash: name,
      nodeCount: 1,
      parameters,
      models: [],
      createdAt: "2026-08-25T00:00:00.000Z",
    },
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
}

describe("video duration contracts", () => {
  it("recognizes direct and primitive-bound Comfy duration controls without confusing transitions", () => {
    const direct = numberParameter("1::duration", "Duration", "duration", 10);
    const primitive = numberParameter("2::value", "Float (duration)", "value", 5);
    const transition = numberParameter("3::value", "Transition duration", "value", 0.5);
    expect(videoWorkflowDurationParameters([direct, primitive, transition])).toEqual([direct, primitive]);
  });

  it("keeps MiniMax H3 at 15 seconds and exposes retained LTX long renders through one minute", () => {
    const duration = numberParameter("2::value", "Duration", "value", 5);
    const h3 = workflow("MiniMax Video H3", [duration]);
    const ltx = workflow("LTX 2.5 Image to Video", [duration]);
    expect(videoWorkflowDurationProfile(h3)).toMatchObject({ family: "minimax-h3", maxSeconds: 15 });
    expect(workflowSupportsVideoDuration(h3, 15)).toBe(true);
    expect(workflowSupportsVideoDuration(h3, 30)).toBe(false);
    expect(workflowSupportsVideoDuration(ltx, 60)).toBe(true);
  });

  it("accepts only the five owner-facing lengths", () => {
    expect(normalizeVideoDurationSeconds("60")).toBe(60);
    expect(normalizeVideoDurationSeconds(20)).toBeNull();
    expect(videoDurationLabel(60)).toBe("1m");
  });
});
