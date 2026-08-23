import { describe, expect, it } from "vitest";
import type { WorkflowDefinition, WorkflowParameter } from "../../shared/contracts";
import { preferredQuickWorkflow, quickInputBindings, workflowCreateIntent } from "../../src/features/generation/quickCreate";

function workflow(id: string, modality: WorkflowDefinition["modality"], mediaKind: WorkflowParameter["mediaKind"] = null): WorkflowDefinition {
  return {
    id, projectId: "project_1", name: id, description: "", sourceFileName: `${id}.json`, modality,
    executionState: "ready", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
    currentRevision: {
      id: `${id}_revision`, workflowId: id, version: 1, parentRevisionId: null, format: "comfyui-api", contentHash: id,
      nodeCount: 1, models: [], createdAt: "2026-08-23T00:00:00.000Z",
      parameters: mediaKind ? [{ id: `${id}_media`, label: "Source", kind: "media", value: "source.png", mediaKind, binding: { format: "comfyui-api", nodeId: "1", inputName: mediaKind } }] : [],
    },
  };
}

describe("quick Create routing", () => {
  it("normalizes workflow modalities into the four task-first choices", () => {
    expect(workflowCreateIntent("audio")).toBe("music");
    expect(workflowCreateIntent("music")).toBe("music");
    expect(workflowCreateIntent("video")).toBe("video");
    expect(workflowCreateIntent("image")).toBe("image");
  });

  it("prefers a source-compatible workflow while preserving modality", () => {
    const textImage = workflow("text-image", "image");
    const imageToImage = workflow("image-image", "image", "image");
    const video = workflow("image-video", "video", "image");
    expect(preferredQuickWorkflow([textImage, imageToImage, video], "image", "image")?.id).toBe("image-image");
    expect(preferredQuickWorkflow([imageToImage, textImage, video], "image", null)?.id).toBe("text-image");
    expect(preferredQuickWorkflow([textImage, imageToImage, video], "video", "image")?.id).toBe("image-video");
  });

  it("automatically binds one compatible retained source without overwriting explicit inputs", () => {
    const parameters = workflow("image-video", "video", "image").currentRevision.parameters;
    expect(quickInputBindings(parameters, {}, { id: "media_1", kind: "image" })).toEqual({ "image-video_media": "media_1" });
    expect(quickInputBindings(parameters, { "image-video_media": "media_2" }, { id: "media_1", kind: "image" })).toEqual({ "image-video_media": "media_2" });
    expect(quickInputBindings(parameters, {}, { id: "media_1", kind: "audio" })).toEqual({});
  });
});
