// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error Plain ESM runner has no TypeScript declarations.
import { contentType, findComfyOutput, validateGenerationPromptGraph, validateComfyMediaOutputGraph, comfyPromptSchedulesMediaOutput } from "../../runner/index.mjs";
import { inspectWorkflowGraph } from "../../shared/contracts/workflows";

const graph = JSON.parse(readFileSync(new URL("../../runner/workflows/hunyuan3d-image-to-mesh.json", import.meta.url), "utf8"));

describe("local mesh output", () => {
  it("normalizes native Comfy audio aliases for retained downloads", () => {
    expect(contentType("Songs_00001.flac", "audio/x-flac")).toBe("audio/flac");
    expect(contentType("audio.wav", "audio/x-wav")).toBe("audio/wav");
    expect(contentType("mesh.glb", "application/octet-stream")).toBe("model/gltf-binary");
  });
  it("validates retained image conditioning without requiring a text encoder", () => {
    const bundle = { job: { modality: "3d", settingsStamp: { inputBindings: { "2::image": "artifact_source" } } },
      workflow: { currentRevision: inspectWorkflowGraph(graph) } };
    expect(() => validateGenerationPromptGraph(bundle, graph)).not.toThrow();
    expect(() => validateGenerationPromptGraph({ ...bundle, job: { ...bundle.job, settingsStamp: { inputBindings: {} } } }, graph)).toThrow("mesh_source_binding_required");
  });
  it("requires a scheduled SaveGLB sink and discovers the real nested 3d output", () => {
    expect(validateComfyMediaOutputGraph(graph, "3d")).toEqual(["10"]);
    expect(comfyPromptSchedulesMediaOutput([1, "prompt", graph, {}, ["10"]], graph, "3d")).toBe(true);
    expect(comfyPromptSchedulesMediaOutput([1, "prompt", graph, {}, ["13"]], graph, "3d")).toBe(false);
    const output = findComfyOutput({ outputs: { "10": { "3d": [{ filename: "mesh.glb", subfolder: "CreativeStudio/Mesh", type: "output" }] } } }, "3d", graph);
    expect(output).toMatchObject({ filename: "mesh.glb", nodeId: "10" });
  });

  it("rejects previews and non-self-contained mesh formats", () => {
    expect(findComfyOutput({ outputs: { "10": { "3d": [{ filename: "mesh.gltf" }, { filename: "preview.png" }] } } }, "3d", graph)).toBeNull();
    expect(() => validateComfyMediaOutputGraph({ "1": { class_type: "PreviewImage" } }, "3d")).toThrow("comfyui_workflow_media_output_missing");
  });

  it("imports the installed Hunyuan model as an image-conditioned 3d workflow", () => {
    const inspected = inspectWorkflowGraph(graph);
    expect(inspected.modality).toBe("3d");
    expect(inspected.parameters.some((parameter) => parameter.kind === "media" && parameter.mediaKind === "image")).toBe(true);
  });
});
