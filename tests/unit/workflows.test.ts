import { describe, expect, it } from "vitest";
import { applyWorkflowValues, inspectWorkflowGraph } from "../../shared/contracts";

describe("ComfyUI workflow inspection", () => {
  it("recognizes API prompt graphs and exposes only safe scalar controls", () => {
    const graph = {
      "57:28": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" }, _meta: { title: "Load model" } },
      "57:27": { class_type: "CLIPTextEncode", inputs: { text: "Initial prompt", clip: ["57:30", 0] }, _meta: { title: "Prompt" } },
      "57:3": { class_type: "KSampler", inputs: { seed: 0, steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple", denoise: 1, model: ["57:28", 0] }, _meta: { title: "Sampler" } },
    };
    const inspection = inspectWorkflowGraph(graph);
    expect(inspection).toMatchObject({ format: "comfyui-api", modality: "image", nodeCount: 3 });
    expect(inspection.models).toEqual(["z_image_turbo_bf16.safetensors"]);
    expect(inspection.parameters.map((parameter) => parameter.id)).toEqual(expect.arrayContaining(["57:27::text", "57:3::seed", "57:3::steps"]));
    expect(inspection.parameters.map((parameter) => parameter.id)).not.toContain("57:28::unet_name");
    const updated = applyWorkflowValues(graph, inspection.parameters, { "57:27::text": "Revised prompt", "57:3::seed": 12 }) as typeof graph;
    expect(updated["57:27"].inputs.text).toBe("Revised prompt");
    expect(updated["57:3"].inputs.seed).toBe(12);
    expect(graph["57:27"].inputs.text).toBe("Initial prompt");
  });

  it("recognizes UI graphs and their widget-backed controls without flattening the graph", () => {
    const graph = {
      id: "workflow",
      nodes: [
        { id: 114, type: "LoadImage", widgets_values: ["source.png", "image"] },
        { id: 115, type: "ResolutionSelector", widgets_values: ["16:9 (Widescreen)", 0.4, 32] },
        { id: 15, type: "RandomNoise", widgets_values: [1, "randomize"] },
        { id: 92, type: "SaveVideo", widgets_values: ["video/H3", "auto", "auto"] },
      ],
      links: [],
    };
    const inspection = inspectWorkflowGraph(graph);
    expect(inspection).toMatchObject({ format: "comfyui-ui", modality: "video", nodeCount: 4 });
    expect(inspection.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "root:114::image", kind: "media", value: "source.png" }),
      expect.objectContaining({ id: "root:115::megapixels", value: 0.4 }),
      expect.objectContaining({ id: "root:15::noise_seed", value: 1 }),
    ]));
    const updated = applyWorkflowValues(graph, inspection.parameters, { "root:115::megapixels": 0.8 }) as typeof graph;
    expect(updated.nodes[1].widgets_values[1]).toBe(0.8);
  });

  it("detects retained audio and video file inputs in API graphs", () => {
    const inspection = inspectWorkflowGraph({
      "1": { class_type: "LoadAudio", inputs: { audio: "voice.wav" }, _meta: { title: "Voice guide" } },
      "2": { class_type: "VHS_LoadVideo", inputs: { video: "motion.mp4", force_rate: 0 } },
      "3": { class_type: "SaveVideo", inputs: { video: ["2", 0] } },
    });
    expect(inspection.modality).toBe("video");
    expect(inspection.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "1::audio", kind: "media", mediaKind: "audio" }),
      expect.objectContaining({ id: "2::video", kind: "media", mediaKind: "video" }),
    ]));
  });
});
