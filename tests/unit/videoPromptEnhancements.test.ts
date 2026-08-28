import { describe, expect, it } from "vitest";
import {
  matchCreativeStudioRoute,
  normalizeEnhancedVideoPrompt,
  videoPromptProfileForIdentity,
} from "../../shared/contracts";

const h3Timeline = `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
SHOT 1 (0.00-3.00 seconds): The glass figure holds the exact opening pose while fine rain moves across the visible light and a restrained push-in reveals small reflections turning over the surface. SHOT 2 (3.00-7.00 seconds): The figure slowly looks toward the river as one distant vehicle crosses behind the shoulder and its light briefly travels through the glass. SHOT 3 (7.00-10.00 seconds): The camera settles at profile; the eyes tighten with recognition, the rain softens, and the final city reflection rests across the cheek without replacing the scene. Audio: close rain, a quiet mechanical neck movement, distant traffic, and one low restrained musical tone.`;

describe("video prompt enhancement contracts", () => {
  it("selects model-specific H3 and LTX profiles", () => {
    expect(videoPromptProfileForIdentity({ name: "MiniMax H3 I2V", inputMode: "image-to-video" })).toMatchObject({
      id: "minimax-h3-i2v-motion/1.0",
      outputFormat: "minimax-h3-timeline",
      maximumWords: 180,
    });
    expect(videoPromptProfileForIdentity({ sourceFileName: "video_ltx2_5_i2v.json" })).toMatchObject({
      id: "ltx-2.5-motion/1.0",
      outputFormat: "natural-language",
      maximumWords: 200,
    });
  });

  it("keeps H3 first-frame alignment, timed shots, and audio inside the selected duration", () => {
    const profile = videoPromptProfileForIdentity({ name: "MiniMax H3 I2V", inputMode: "image-to-video" });
    expect(normalizeEnhancedVideoPrompt(h3Timeline, profile, { videoDurationSeconds: 10, inputMode: "image-to-video" }))
      .toBe(h3Timeline);
    expect(() => normalizeEnhancedVideoPrompt(h3Timeline.replace("10.00 seconds", "16.00 seconds"), profile, {
      videoDurationSeconds: 10,
      inputMode: "image-to-video",
    })).toThrow("video_prompt_enhancement_minimax_timing_invalid");
    expect(() => normalizeEnhancedVideoPrompt(h3Timeline.replace(/^.*\n/, ""), profile, {
      videoDurationSeconds: 10,
      inputMode: "image-to-video",
    })).toThrow("video_prompt_enhancement_minimax_picture_alignment_missing");
    const enDashTimeline = h3Timeline.replaceAll("0.00-3.00 seconds", "0.00–3.00s")
      .replaceAll("3.00-7.00 seconds", "3.00–7.00s")
      .replaceAll("7.00-10.00 seconds", "7.00–10.00s");
    expect(normalizeEnhancedVideoPrompt(enDashTimeline, profile, { videoDurationSeconds: 10, inputMode: "image-to-video" }))
      .toBe(enDashTimeline);
  });

  it("keeps LTX concise, chronological, and free of model commentary", () => {
    const profile = videoPromptProfileForIdentity({ name: "LTX 2.5 Image to Video" });
    const output = "The woman holds the opening profile as the camera begins a slow lateral move across the room. Her fingers tighten around the glass, dust rises through the window light, and a reflected figure passes behind her without interrupting the motion. She turns only after the reflection disappears; the camera closes the distance, the warm light cools, and the shot ends on her steady gaze as the room settles into stillness.";
    expect(normalizeEnhancedVideoPrompt(output, profile)).toBe(output);
    expect(() => normalizeEnhancedVideoPrompt(`${output} This prompt is ready for the target model.`, profile))
      .toThrow("video_prompt_enhancement_metadata_leak");
  });

  it("allowlists owner and runner prompt-enhancement routes exactly", () => {
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/prompt-enhancements")).toBe("prompt-enhancement-create");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/prompt-enhancements/promptenh_12345678")).toBe("prompt-enhancement-get");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/runner/prompt-enhancements/promptenh_12345678/complete"))
      .toBe("runner-prompt-enhancement-complete");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/prompt-enhancements/promptenh_12345678/complete")).toBeNull();
  });
});
