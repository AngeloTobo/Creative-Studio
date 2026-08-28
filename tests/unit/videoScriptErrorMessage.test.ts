import { describe, expect, it } from "vitest";
import { videoScriptErrorMessage } from "../../src/features/generation/videoScriptErrorMessage";

describe("full video script error presentation", () => {
  it.each([
    ["video_script_ending_missing", "final visual beat"],
    ["video_script_natural_format_invalid", "chronological prose"],
    ["video_script_progression_missing", "three chronological sentences"],
    ["video_script_prompt_derivation_invalid", "verify how this branch was derived"],
    ["video_script_source_binding_invalid", "Reselect the image or video"],
  ])("turns %s into an actionable owner-facing repair", (code, repair) => {
    const message = videoScriptErrorMessage(new Error(code));
    expect(message).toContain(repair);
    expect(message).not.toContain(code);
    expect(message).not.toContain("_");
  });
});
