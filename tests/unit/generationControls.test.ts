import { describe, expect, it } from "vitest";
import {
  estimateGenerationRuntime,
  generationCanvasOverrides,
  generationControlSet,
  inferGenerationAspectRatio,
  type GenerationWorkload,
  type WorkflowParameter,
} from "../../shared/contracts";

function parameter(id: string, label: string, value: string | number, inputName = id.split("::").at(-1) ?? id): WorkflowParameter {
  return { id, label, value, kind: typeof value === "number" ? "number" : "choice", mediaKind: null, binding: { format: "comfyui-api", nodeId: "1", inputName } };
}

const baseWorkload: GenerationWorkload = {
  width: 512, height: 512, megapixels: 0.262144, steps: 8, frames: 1, durationSeconds: 5, fps: 24,
  batchSize: 1, modelCount: 1, inputCount: 0, promptCharacters: 120, facts: [], likelyContributors: [], promptAssessment: "",
};

describe("graphical generation controls", () => {
  it("maps the 9:16 preset to a canonical ComfyUI choice", () => {
    const parameters = [parameter("409::aspect_ratio", "Aspect Ratio", "1:1 (Square)")];
    expect(generationCanvasOverrides(parameters, "9:16", null)).toEqual({ "409::aspect_ratio": "9:16 (Portrait Widescreen)" });
    expect(inferGenerationAspectRatio([{ ...parameters[0], value: "9:16 (Portrait Widescreen)" }])).toBe("9:16");
  });

  it("turns aspect and megapixels into stamped width and height values", () => {
    const parameters = [parameter("13::width", "Width", 512), parameter("13::height", "Height", 512)];
    const overrides = generationCanvasOverrides(parameters, "9:16", 0.9);
    expect(Number(overrides["13::width"]) / Number(overrides["13::height"])).toBeCloseTo(9 / 16, 2);
    expect(Number(overrides["13::width"]) * Number(overrides["13::height"]) / 1_000_000).toBeCloseTo(0.9, 1);
  });

  it("finds friendly controls even when a UI workflow stores generic value ids", () => {
    const controls = generationControlSet([
      parameter("398:361::value", "Frame Rate", 24, "value"),
      parameter("root:15::noise_seed", "Noise Seed", 1),
      parameter("root:20::steps", "Sampling Steps", 16),
    ]);
    expect(controls.fps[0]?.id).toBe("398:361::value");
    expect(controls.seed[0]?.id).toBe("root:15::noise_seed");
    expect(controls.steps[0]?.id).toBe("root:20::steps");
  });

  it("scales historical time by visible workload and shows the cost of multiple outputs", () => {
    const estimate = estimateGenerationRuntime(4 * 60_000, { ...baseWorkload, megapixels: 0.5, durationSeconds: 10 }, { ...baseWorkload, megapixels: 0.25 }, 2)!;
    expect(estimate.workloadScale).toBe(4);
    expect(estimate.perOutputLowMs).toBe(12 * 60_000);
    expect(estimate.totalHighMs).toBe(48 * 60_000);
  });
});
