import { describe, expect, it } from "vitest";
import {
  assessVideoPerformance,
  canonicalGenerationPerformanceParameters,
  type WorkflowParameter,
} from "../../shared/contracts";
import {
  ONE_CLICK_VIDEO_DURATION_SECONDS,
  ONE_CLICK_VIDEO_MEGAPIXELS,
  oneClickVideoSettings,
  videoPerformanceModeForArmedConsent,
  videoRenderConsentSignature,
  videoRenderFrameCount,
  videoRenderNeedsConfirmation,
} from "../../src/features/generation/createEntry";

describe("speed-safe video creation", () => {
  it("uses the same fast workload for standard and four-way one-click animation", () => {
    expect(oneClickVideoSettings("standard")).toEqual({
      durationSeconds: ONE_CLICK_VIDEO_DURATION_SECONDS,
      megapixels: ONE_CLICK_VIDEO_MEGAPIXELS,
      outputCount: 2,
    });
    expect(oneClickVideoSettings("four-way")).toEqual({
      durationSeconds: 5,
      megapixels: 0.2,
      outputCount: 4,
    });
  });

  it("requires confirmation for longer clips or higher detail without flagging rounded 0.2 MP frames", () => {
    expect(videoRenderNeedsConfirmation({ durationSeconds: 5, megapixels: 0.2 })).toBe(false);
    expect(videoRenderNeedsConfirmation({ durationSeconds: 5, megapixels: 0.218 })).toBe(false);
    expect(videoRenderNeedsConfirmation({ durationSeconds: 10, megapixels: 0.2 })).toBe(true);
    expect(videoRenderNeedsConfirmation({ durationSeconds: 5, megapixels: 0.5 })).toBe(true);
  });

  it("prefers an exposed frame total and otherwise derives the duration timeline", () => {
    expect(videoRenderFrameCount({ durationSeconds: 30, fps: 24, exposedFrames: 721 })).toBe(721);
    expect(videoRenderFrameCount({ durationSeconds: 30, fps: 24, exposedFrames: null })).toBe(721);
    expect(videoRenderFrameCount({ durationSeconds: 5, fps: null, exposedFrames: null })).toBeNull();
  });

  it("invalidates armed consent when semantic primitive workload controls change", () => {
    const parameter = (id: string, label: string, value: number): WorkflowParameter => ({
      id,
      label,
      kind: "number",
      value,
      mediaKind: null,
      binding: { format: "comfyui-api", nodeId: id.split("::")[0], inputName: "value" },
    });
    const base = [
      parameter("10::value", "Megapixels", 0.5),
      parameter("11::value", "Frame Rate", 24),
      parameter("12::value", "Frames", 241),
    ];
    const changed = base.map((item) => item.label === "Megapixels" ? { ...item, value: 0.9 }
      : item.label === "Frames" ? { ...item, value: 721 } : item);
    const assessment = (parameters: WorkflowParameter[]) => assessVideoPerformance({
      parameters: canonicalGenerationPerformanceParameters(parameters),
      models: [], inputAssetIds: [], inputArtifactIds: [], prompt: "", videoDurationSeconds: 10,
    });
    const before = assessment(base);
    const after = assessment(changed);
    const armedSignature = videoRenderConsentSignature({ workflowRevisionId: "workflowrev_same", workload: before.workload, outputCount: 2 });
    const changedSignature = videoRenderConsentSignature({ workflowRevisionId: "workflowrev_same", workload: after.workload, outputCount: 2 });

    expect(changedSignature).not.toBe(armedSignature);
    expect(videoPerformanceModeForArmedConsent({
      requiresExplicitHeavy: after.requiresExplicitHeavy,
      currentSignature: changedSignature,
      armedSignature,
    })).toBeNull();
    expect(videoPerformanceModeForArmedConsent({
      requiresExplicitHeavy: after.requiresExplicitHeavy,
      currentSignature: changedSignature,
      armedSignature: changedSignature,
    })).toBe("explicit-heavy");
  });
});
