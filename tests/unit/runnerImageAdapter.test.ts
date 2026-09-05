// @vitest-environment node
import { describe, expect, it } from "vitest";
// @ts-expect-error The Windows runner is runtime-only ESM.
import { applyModelAdapterBindings } from "../../runner/index.mjs";
import { inspectWorkflowGraph } from "../../shared/contracts/workflows";
import { imageStyleWorkflowGraph } from "../../shared/contracts/imageStyleWorkflow";

describe("retained image adapter execution", () => {
  const path = "creative-studio/modeltrain_abc123/adapter_model.safetensors";
  const graph = imageStyleWorkflowGraph(path, "my_style");
  const parameters = inspectWorkflowGraph(graph).parameters;
  const stamp = { modelAdapters: [{ provider: "comfy-sd15-lora", relativePath: path, strength: 0.8 }],
    parameters: { "2::lora_name": path, "2::strength_model": 0.8, "2::strength_clip": 0.8 } };
  it("binds the approved checkpoint and strengths without altering its immutable graph", () => {
    const result = applyModelAdapterBindings(graph, parameters, stamp);
    expect(result["2"].inputs).toMatchObject({ lora_name: path, strength_model: 0.8, strength_clip: 0.8 });
    expect(graph["2"].inputs.strength_model).toBe(0);
  });
  it("rejects a substituted checkpoint or mismatched strength", () => {
    expect(() => applyModelAdapterBindings(graph, parameters, { ...stamp, parameters: { ...stamp.parameters, "2::lora_name": "other.safetensors" } })).toThrow("model_adapter_path_mismatch");
    expect(() => applyModelAdapterBindings(graph, parameters, { ...stamp, parameters: { ...stamp.parameters, "2::strength_clip": 1 } })).toThrow("model_adapter_strength_mismatch");
  });
});
