import { describe, expect, it } from "vitest";
import { applyWorkflowValues, canonicalWorkflowParameterValue, generationWorkflowPromptParameters, inspectWorkflowGraph, musicPromptProfileForIdentity, primaryWorkflowPromptParameter, recoverWorkflowPromptRoles, workflowParameterChoices } from "../../shared/contracts";

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

  it("canonicalizes ResolutionSelector shorthand to an exact ComfyUI enum", () => {
    const graph = {
      "409": { class_type: "ResolutionSelector", inputs: { aspect_ratio: "9:16", megapixels: 0.9 } },
      "75": { class_type: "SaveVideo", inputs: { video: ["409", 0] } },
    };
    const inspection = inspectWorkflowGraph(graph);
    const aspectRatio = inspection.parameters.find((parameter) => parameter.id === "409::aspect_ratio")!;
    expect(workflowParameterChoices(aspectRatio)).toContain("9:16 (Portrait Widescreen)");
    expect(canonicalWorkflowParameterValue(aspectRatio, "9:16")).toBe("9:16 (Portrait Widescreen)");
    const updated = applyWorkflowValues(graph, inspection.parameters, { "409::aspect_ratio": "9:16" }) as typeof graph;
    expect(updated["409"].inputs.aspect_ratio).toBe("9:16 (Portrait Widescreen)");
    expect(() => applyWorkflowValues(graph, inspection.parameters, { "409::aspect_ratio": "portrait-ish" })).toThrow("invalid_workflow_parameter_choice");
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

  it("selects the positive ComfyUI prompt without treating negative text or lyrics as the generation description", () => {
    const inspection = inspectWorkflowGraph({
      "1": { class_type: "CLIPTextEncode", inputs: { text: "Concrete subject description" }, _meta: { title: "Positive Prompt" } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "blur, artifacts" }, _meta: { title: "Negative Prompt" } },
      "3": { class_type: "SaveImage", inputs: { images: ["4", 0] } },
    });
    expect(primaryWorkflowPromptParameter(inspection.parameters, "image")?.id).toBe("1::text");
  });

  it("traces the LTX 2.5 positive conditioning path instead of overwriting its negative encoder", () => {
    const graph = {
      "405:373": { class_type: "CLIPTextEncode", inputs: { text: "bad anatomy, captions, black frames", clip: ["405:350", 1] }, _meta: { title: "CLIP Text Encode (Prompt)" } },
      "405:376": { class_type: "PrimitiveStringMultiline", inputs: { value: "Arctic hunter demo with a centered LTX-2.5 title" }, _meta: { title: "Prompt" } },
      "405:380": { class_type: "TextGenerateLTX2Prompt", inputs: { prompt: ["405:376", 0], seed: 1 }, _meta: { title: "LTX prompt enhancer" } },
      "405:382": { class_type: "ImpactSwitch", inputs: { select: 1, input1: ["405:376", 0], input2: ["405:380", 0] }, _meta: { title: "Prompt mode" } },
      "405:364": { class_type: "CLIPTextEncode", inputs: { text: ["405:382", 0], clip: ["405:350", 1] }, _meta: { title: "CLIP Text Encode (Prompt)" } },
      "405:370": { class_type: "LTXVConditioning", inputs: { positive: ["405:364", 0], negative: ["405:373", 0], frame_rate: 24 }, _meta: { title: "LTXV Conditioning" } },
      "405:400": { class_type: "SaveVideo", inputs: { video: ["405:370", 0] }, _meta: { title: "Save video" } },
    };
    const inspection = inspectWorkflowGraph(graph);
    const positive = inspection.parameters.find((parameter) => parameter.id === "405:376::value");
    const negative = inspection.parameters.find((parameter) => parameter.id === "405:373::text");
    expect(positive).toMatchObject({ promptRole: "positive", value: "Arctic hunter demo with a centered LTX-2.5 title" });
    expect(negative).toMatchObject({ promptRole: "negative", value: "bad anatomy, captions, black frames" });
    expect(negative?.label).toMatch(/^Negative ·/);
    expect(generationWorkflowPromptParameters(inspection.parameters).map((parameter) => parameter.id)).toEqual(["405:376::value"]);
    expect(primaryWorkflowPromptParameter(inspection.parameters, "video")?.id).toBe("405:376::value");
    const updated = applyWorkflowValues(graph, inspection.parameters, { "405:376::value": "A ceramic body emerging from violet water" }) as typeof graph;
    expect(updated["405:376"].inputs.value).toBe("A ceramic body emerging from violet water");
    expect(updated["405:373"].inputs.text).toBe("bad anatomy, captions, black frames");
  });

  it("recovers contaminated legacy prompt-role metadata from the retained graph", () => {
    const graph = {
      "405:373": { class_type: "CLIPTextEncode", inputs: { text: "captions, black frames", clip: ["405:350", 1] }, _meta: { title: "CLIP Text Encode (Prompt)" } },
      "405:376": { class_type: "PrimitiveStringMultiline", inputs: { value: "A ceramic body entering violet water" }, _meta: { title: "Prompt" } },
      "405:364": { class_type: "CLIPTextEncode", inputs: { text: ["405:376", 0], clip: ["405:350", 1] } },
      "405:370": { class_type: "LTXVConditioning", inputs: { positive: ["405:364", 0], negative: ["405:373", 0] } },
      "75": { class_type: "SaveVideo", inputs: { video: ["405:370", 0] } },
    };
    const stored = inspectWorkflowGraph(graph).parameters.map((parameter) => parameter.kind === "text"
      ? { ...parameter, promptRole: "positive" as const }
      : parameter);
    const recovered = recoverWorkflowPromptRoles(graph, stored);
    expect(recovered.find((parameter) => parameter.id === "405:373::text")?.promptRole).toBe("negative");
    expect(generationWorkflowPromptParameters(recovered).map((parameter) => parameter.id)).toEqual(["405:376::value"]);
  });

  it("selects different prompt contracts for MiniMax Music 3 and Stable Audio", () => {
    expect(musicPromptProfileForIdentity({
      name: "MiniMax Music 3",
      models: ["minimax_music3_dit_fp16.safetensors"],
      parameters: [{ id: "37:13::caption", label: "Caption" }],
    })).toMatchObject({ id: "minimax-music-3-structured-caption/1.0", outputFormat: "structured-caption" });
    expect(musicPromptProfileForIdentity({
      name: "Stable Audio 3 Medium",
      models: ["stable_audio_3_medium.safetensors", "t5gemma_b_b_ul2.safetensors"],
      parameters: [{ id: "12::value", label: "Music prompt" }],
    })).toMatchObject({ id: "stable-audio-natural-language/1.0", outputFormat: "natural-language" });
  });
});
