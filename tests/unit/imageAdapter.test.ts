import { describe, expect, it } from "vitest";
import { imageAdapterParameterIds } from "../../shared/contracts/imageAdapter";
import { imageStyleWorkflowGraph } from "../../shared/contracts/imageStyleWorkflow";
import { inspectWorkflowGraph, type WorkflowDefinition } from "../../shared/contracts/workflows";

function workflow(model = "v1-5-pruned-emaonly-fp16.safetensors", duplicate = false): WorkflowDefinition {
  const inspection = inspectWorkflowGraph({
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model } },
    "2": { class_type: "LoraLoader", inputs: { model: ["1", 0], clip: ["1", 1], lora_name: "style.safetensors", strength_model: 0.8, strength_clip: 0.8 } },
    ...(duplicate ? { "3": { class_type: "LoraLoaderModelOnly", inputs: { model: ["2", 0], lora_name: "other.safetensors", strength_model: 0.5 } } } : {}),
  });
  return { id: "workflow_test", projectId: "project_test", name: "Style", description: "", sourceFileName: "style.json",
    modality: "image", executionState: "ready", createdAt: "", updatedAt: "",
    currentRevision: { ...inspection, id: "revision_test", workflowId: "workflow_test", version: 1, parentRevisionId: null, contentHash: "", createdAt: "" } };
}

describe("image style adapter compatibility", () => {
  it("builds a prompt-mapped graph with dormant adapter strengths until approval", () => {
    const graph = imageStyleWorkflowGraph("creative-studio/modeltrain_abc123/adapter_model.safetensors", "my_style");
    const inspected = inspectWorkflowGraph(graph);
    expect(inspected.modality).toBe("image");
    expect(inspected.parameters.some((parameter) => parameter.promptRole === "positive")).toBe(true);
    expect(graph["2"].inputs.strength_model).toBe(0);
    expect(() => imageStyleWorkflowGraph("../bad.safetensors", "style")).toThrow("image_adapter_path_invalid");
  });
  it("binds the exact SD1.5 base and both strengths on one loader", () => {
    const result = imageAdapterParameterIds(workflow());
    expect(result?.fileId).toContain("lora_name");
    expect(result?.strengthIds).toHaveLength(2);
  });
  it("never binds SD1.5 weights to an unrelated model", () => {
    expect(imageAdapterParameterIds(workflow("flux.safetensors"))).toBeNull();
  });
  it("does not overwrite an ambiguous adapter chain", () => {
    expect(imageAdapterParameterIds(workflow(undefined, true))).toBeNull();
  });
});
