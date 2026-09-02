import { describe, expect, it } from "vitest";
import {
  isVideoPromptEnhancementError,
  videoPromptEnhancementErrorMessage,
} from "../../src/app/videoPromptEnhancementErrorMessage";

describe("video prompt enhancement error presentation", () => {
  it.each([
    ["video_prompt_enhancement_minimax_picture_alignment_missing", "align to your source"],
    ["video_prompt_enhancement_timing_invalid", "selected video length"],
    ["video_prompt_enhancement_timeline_invalid", "incomplete timed video plan"],
    ["video_prompt_enhancement_length_invalid", "safe length"],
    ["video_prompt_enhancement_metadata_leak", "setup instructions"],
    ["video_prompt_enhancement_source_binding_invalid", "image, model, or video length changed"],
    ["prompt enhancement context mismatch", "image, model, or video length changed"],
  ])("turns %s into a plain recovery message", (code, expected) => {
    const message = videoPromptEnhancementErrorMessage(new Error(code));
    expect(message).toContain(expected);
    expect(message).not.toContain(code);
    expect(message).not.toContain("_");
  });

  it("does not echo unknown backend failures", () => {
    const code = "video_prompt_enhancement_new_internal_failure";
    const message = videoPromptEnhancementErrorMessage(code);
    expect(message).toBe("Local Gemma could not prepare a safe Enhanced version.");
    expect(message).not.toContain(code);
  });

  it("recognizes prompt-enhancement codes embedded in transport errors", () => {
    expect(isVideoPromptEnhancementError("HTTP 422: video_prompt_enhancement_timeline_invalid")).toBe(true);
    expect(isVideoPromptEnhancementError("prompt enhancement context mismatch")).toBe(true);
    expect(isVideoPromptEnhancementError("workflow_not_found")).toBe(false);
  });
});
