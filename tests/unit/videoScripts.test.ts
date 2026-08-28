import { describe, expect, it } from "vitest";
import {
  compileVideoPromptWithSpeech,
  matchCreativeStudioRoute,
  normalizeGeneratedVideoScript,
  normalizeOwnerVideoScript,
  normalizeVideoScriptSeedPhrases,
  videoPromptProfileForIdentity,
  videoScriptWordRange,
} from "../../shared/contracts";

function result(spokenText: string, extra = "") {
  return JSON.stringify({
    schemaVersion: "creative-studio-video-script-output/1.0",
    spokenText,
    ...(extra ? { extra } : {}),
  });
}

describe("video script contracts", () => {
  it("uses explicit duration-aware dialogue budgets", () => {
    expect([5, 10, 15, 30, 60].map((duration) => videoScriptWordRange(duration as 5 | 10 | 15 | 30 | 60)))
      .toEqual([
        { minimum: 3, maximum: 8 },
        { minimum: 6, maximum: 16 },
        { minimum: 10, maximum: 24 },
        { minimum: 20, maximum: 48 },
        { minimum: 40, maximum: 96 },
      ]);
  });

  it("accepts strict Gemma JSON and rejects metadata, stage directions, extra keys, and bad budgets", () => {
    expect(normalizeGeneratedVideoScript(result("We kept the signal alive through midnight."), 10))
      .toBe("We kept the signal alive through midnight.");
    expect(() => normalizeGeneratedVideoScript("Here is your script", 10)).toThrow("video_script_output_invalid_json");
    expect(() => normalizeGeneratedVideoScript(result("(whispers) We kept the signal alive through midnight."), 10))
      .toThrow("video_script_stage_direction_invalid");
    expect(() => normalizeGeneratedVideoScript(result("Here is the script: we kept it alive."), 10))
      .toThrow("video_script_metadata_leak");
    expect(() => normalizeGeneratedVideoScript(result("We kept the signal alive through midnight.", "not allowed"), 10))
      .toThrow("video_script_output_invalid");
    expect(() => normalizeGeneratedVideoScript(result("Too short."), 10)).toThrow("video_script_word_budget_too_short");
    expect(() => normalizeGeneratedVideoScript(result("one two three four five six seven eight nine"), 5))
      .toThrow("video_script_word_budget_exceeded");
  });

  it("keeps owner edits spoken-only while allowing a deliberately short line", () => {
    expect(normalizeOwnerVideoScript("Stay with me.", 60)).toBe("Stay with me.");
    expect(() => normalizeOwnerVideoScript("[whispering] Stay with me.", 10)).toThrow("video_script_stage_direction_invalid");
    expect(normalizeVideoScriptSeedPhrases(["borrowed body", "the city remembers"]))
      .toEqual(["borrowed body", "the city remembers"]);
    expect(() => normalizeVideoScriptSeedPhrases([])).toThrow("video_script_seed_phrases_invalid");
  });

  it("feeds an approved script through the deterministic model-specific speech compiler", () => {
    const script = "We kept the signal alive through midnight.";
    const h3 = compileVideoPromptWithSpeech("The subject turns toward the transmitter.", {
      mode: "exact-script",
      text: script,
    }, videoPromptProfileForIdentity({ name: "MiniMax H3 I2V" }));
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
