import { describe, expect, it } from "vitest";
import {
  compileVideoPromptWithSpeech,
  createFourWayVideoGenerationVersions,
  deterministicReplacementVideoPrompt,
  matchCreativeStudioRoute,
  normalizeGeneratedFullVideoScript,
  normalizeGeneratedVideoScript,
  normalizeOwnerFullVideoScript,
  normalizeOwnerVideoScript,
  normalizeVideoScriptSeedPhrases,
  videoFullScriptWordRange,
  videoPromptProfileForIdentity,
  videoScriptInputRequestsSpeech,
  videoScriptWordRange,
} from "../../shared/contracts";

const h3Profile = videoPromptProfileForIdentity({ name: "MiniMax H3 Text to Video" });
const fullTimeline = "SHOT 1 (0.00-3.00 seconds): In a white fashion studio, the subject turns one shoulder toward the key light while fabric drifts behind them. The camera begins a slow waist-high push, preserving the clean background and long floor shadow.\nSHOT 2 (3.00-7.00 seconds): They cross the set with a measured step as the lens pans beside them; reflected silver light travels over the jacket and the surrounding curtains move gently.\nSHOT 3 (7.00-10.00 seconds): The camera settles into a close-up as they hold a final pose, the studio glow softens, and the frame becomes still.\nAudio: soft room tone, fabric movement, restrained footsteps, a quiet shutter click, and low ambient music without dialogue.";
const naturalProfile = videoPromptProfileForIdentity({ name: "LTX 2.5 video" });
const naturalFullScript = "A fashion model waits in a white studio while loose fabric drifts behind one shoulder and the opening light creates a long floor shadow. The camera begins wide, tracks beside a measured walk, then moves into a close frame as silver reflections cross the jacket and the background curtains respond to each step. Soft room ambience, restrained footsteps, fabric movement, and a low electronic pulse settle as the subject holds the final pose and the closing image becomes still.";

function legacyResult(spokenText: string, extra = "") {
  return JSON.stringify({
    schemaVersion: "creative-studio-video-script-output/1.0",
    spokenText,
    ...(extra ? { extra } : {}),
  });
}

function fullResult(fullScript: string, spokenText: string | null, extra = false) {
  return JSON.stringify({
    schemaVersion: "creative-studio-video-script-output/2.0",
    fullScript,
    spokenText,
    ...(extra ? { extra: "not allowed" } : {}),
  });
}

describe("video script contracts", () => {
  it("keeps legacy dialogue budgets and adds duration/profile-aware full-script budgets", () => {
    expect([5, 10, 15, 30, 60].map((duration) => videoScriptWordRange(duration as 5 | 10 | 15 | 30 | 60)))
      .toEqual([
        { minimum: 3, maximum: 8 },
        { minimum: 6, maximum: 16 },
        { minimum: 10, maximum: 24 },
        { minimum: 20, maximum: 48 },
        { minimum: 40, maximum: 96 },
      ]);
    expect(videoFullScriptWordRange(5, h3Profile)).toEqual({ minimum: 60, maximum: 100 });
    expect(videoFullScriptWordRange(10, h3Profile)).toEqual({ minimum: 60, maximum: 130 });
    expect(videoFullScriptWordRange(15, h3Profile)).toEqual({ minimum: 60, maximum: 160 });
  });

  it("turns a seed idea into a strict, complete full-script v2 result", () => {
    expect(normalizeGeneratedFullVideoScript(fullResult(fullTimeline, null), 10, h3Profile, "text-to-video", false))
      .toEqual({ fullScript: fullTimeline, spokenText: null });
    expect(() => normalizeGeneratedFullVideoScript("```json\n" + fullResult(fullTimeline, null) + "\n```", 10,
      h3Profile, "text-to-video", false)).toThrow("video_script_output_invalid_json");
    expect(() => normalizeGeneratedFullVideoScript(fullResult(fullTimeline, null, true), 10, h3Profile, "text-to-video", false))
      .toThrow("video_script_output_invalid");
    expect(() => normalizeGeneratedFullVideoScript(fullResult(fullTimeline.replace(/light|shadow|reflected|glow/gi, "color"), null), 10,
      h3Profile, "text-to-video", false)).toThrow("video_full_script_incomplete");
  });

  it("never invents dialogue, permits explicit dialogue with no minimum, and treats owner entry as consent", () => {
    expect(videoScriptInputRequestsSpeech({
      seedPhrases: ["They are posing for a fashion shoot"], sourceScript: null, sceneDirection: "No dialogue",
    })).toBe(false);
    expect(videoScriptInputRequestsSpeech({
      seedPhrases: ["They are posing for a fashion shoot"], sourceScript: null,
      sceneDirection: "Do not add speech; no one speaks.",
    })).toBe(false);
    expect(videoScriptInputRequestsSpeech({
      seedPhrases: ["They are posing for a fashion shoot"], sourceScript: null, sceneDirection: "She says: Hold still.",
    })).toBe(true);
    expect(() => normalizeGeneratedFullVideoScript(fullResult(fullTimeline, "Pose."), 10, h3Profile, "text-to-video", false))
      .toThrow("video_script_unrequested_dialogue");
    expect(normalizeGeneratedFullVideoScript(fullResult(fullTimeline, "Pose."), 10, h3Profile, "text-to-video", true).spokenText)
      .toBe("Pose.");
    expect(() => normalizeGeneratedFullVideoScript(fullResult(`${fullTimeline}\nThe subject says: "Pose."`, "Pose."), 10,
      h3Profile, "text-to-video", true)).toThrow("video_script_dialogue_embedded");
    expect(() => normalizeGeneratedFullVideoScript(fullResult(fullTimeline.replace("hold a final pose", "hold the final cue Pose"), "Pose"), 10,
      h3Profile, "text-to-video", true)).toThrow("video_script_dialogue_embedded");
    expect(normalizeOwnerFullVideoScript(fullTimeline, "Pose.", 10, h3Profile, "text-to-video", false).spokenText)
      .toBe("Pose.");
    expect(() => normalizeOwnerFullVideoScript(fullTimeline, "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen",
      10, h3Profile, "text-to-video", true)).toThrow("video_script_word_budget_exceeded");
    expect(() => normalizeOwnerFullVideoScript(fullTimeline.replace("They cross the set", "They say hello and cross the set"), null,
      10, h3Profile, "text-to-video", false)).toThrow("video_script_dialogue_embedded");
  });

  it("keeps owner edits inside the selected provider format and full target duration", () => {
    expect(normalizeOwnerFullVideoScript(naturalFullScript, null, 10, naturalProfile, "text-to-video", false).fullScript)
      .toBe(naturalFullScript);
    expect(() => normalizeOwnerFullVideoScript(`${naturalFullScript}\nAudio: duplicate`, null, 10, naturalProfile, "text-to-video", false))
      .toThrow("video_script_natural_format_invalid");
    expect(() => normalizeOwnerFullVideoScript(fullTimeline.replace("Audio:", "Audio: first line\nAudio:"), null,
      10, h3Profile, "text-to-video", false)).toThrow("video_full_script_timeline_invalid");
    expect(() => normalizeOwnerFullVideoScript(fullTimeline.replace(/10\.00/g, "9.00"), null,
      10, h3Profile, "text-to-video", false)).toThrow("video_full_script_timing_invalid");
    const pictured = `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n${fullTimeline.replace("SHOT 2", "<Picture 1> SHOT 2")}`;
    expect(() => normalizeOwnerFullVideoScript(pictured, null, 15, h3Profile, "image-to-video", false))
      .toThrow("video_full_script_picture_alignment_missing");
  });

  it("reconstructs deterministic left-field and awe variant prompts for lineage checks", () => {
    const dimensions = { energy: 50, tension: 55, contrast: 65, warmth: 40, spaciousness: 60, rhythmicity: 45, organicity: 70, polish: 75 };
    const versions = createFourWayVideoGenerationVersions({
      exactPrompt: naturalFullScript,
      enhancedPrompt: `${naturalFullScript} A restrained color transition sharpens the final beat.`,
      dimensions,
      pairId: "video_pair_script-lineage-001",
      boardSeed: 1842,
      hasSource: true,
    });
    expect(deterministicReplacementVideoPrompt(versions[2].variant, true)).toBe(versions[2].prompt);
    expect(deterministicReplacementVideoPrompt(versions[3].variant, true)).toBe(versions[3].prompt);
    expect(deterministicReplacementVideoPrompt(versions[0].variant, true)).toBeNull();
  });

  it("preserves strict legacy dialogue behavior for existing v1 rows", () => {
    expect(normalizeGeneratedVideoScript(legacyResult("We kept the signal alive through midnight."), 10))
      .toBe("We kept the signal alive through midnight.");
    expect(() => normalizeGeneratedVideoScript("Here is your script", 10)).toThrow("video_script_output_invalid_json");
    expect(() => normalizeGeneratedVideoScript(legacyResult("(whispers) We kept the signal alive through midnight."), 10))
      .toThrow("video_script_stage_direction_invalid");
    expect(() => normalizeGeneratedVideoScript(legacyResult("Here is the script: we kept it alive."), 10))
      .toThrow("video_script_metadata_leak");
    expect(() => normalizeGeneratedVideoScript(legacyResult("We kept the signal alive through midnight.", "not allowed"), 10))
      .toThrow("video_script_output_invalid");
    expect(() => normalizeGeneratedVideoScript(legacyResult("Too short."), 10)).toThrow("video_script_word_budget_too_short");
  });

  it("keeps legacy owner edits spoken-only", () => {
    expect(normalizeOwnerVideoScript("Stay with me.", 60)).toBe("Stay with me.");
    expect(() => normalizeOwnerVideoScript("[whispering] Stay with me.", 10)).toThrow("video_script_stage_direction_invalid");
    expect(normalizeVideoScriptSeedPhrases(["borrowed body", "the city remembers"]))
      .toEqual(["borrowed body", "the city remembers"]);
    expect(() => normalizeVideoScriptSeedPhrases([])).toThrow("video_script_seed_phrases_invalid");
  });

  it("feeds an approved legacy line through deterministic model-specific speech", () => {
    const script = "We kept the signal alive through midnight.";
    const h3 = compileVideoPromptWithSpeech("The subject turns toward the transmitter.", {
      mode: "exact-script",
      text: script,
    }, h3Profile);
    expect(h3.speech).toMatchObject({ mode: "exact-script", authoredText: script, spokenText: script });
    expect(h3.prompt).toContain(`<d>[English] ${script}</d>`);
  });

  it("allowlists only the exact owner and runner Script Builder routes", () => {
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/video-scripts")).toBe("video-script-create");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/video-scripts/videoscript_12345678")).toBe("video-script-get");
    expect(matchCreativeStudioRoute("PATCH", "/api/creative-studio/video-scripts/videoscript_12345678")).toBe("video-script-update");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/runner/video-scripts/videoscript_12345678/complete"))
      .toBe("runner-video-script-complete");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/video-scripts/videoscript_12345678/complete")).toBeNull();
  });
});
