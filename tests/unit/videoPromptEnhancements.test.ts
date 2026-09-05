import { describe, expect, it } from "vitest";
import {
  compileVideoPromptWithSpeech,
  matchCreativeStudioRoute,
  MINIMAX_PICTURE_ALIGNMENT_INSTRUCTION,
  normalizeEnhancedVideoPrompt,
  normalizeVideoSpeechStamp,
  VIDEO_EXTENSION_SOUND_DIRECTIVE,
  VIDEO_NO_DIALOGUE_DIRECTIVE,
  VIDEO_SOUND_DESIGN_DIRECTIVE,
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
    const headerlessTimeline = h3Timeline.replace(/^.*\n/, "");
    expect(normalizeEnhancedVideoPrompt(headerlessTimeline, profile, {
      videoDurationSeconds: 10,
      inputMode: "image-to-video",
    })).toBe(h3Timeline);
    expect(normalizeEnhancedVideoPrompt(`Here is the enhanced direction.\n${headerlessTimeline}`, profile, {
      videoDurationSeconds: 10,
      inputMode: "image-to-video",
    })).toBe(h3Timeline);
    expect(normalizeEnhancedVideoPrompt(`For the target video, at 0.00 seconds, the pink abstract shape from Shot 1 is fully referenced. ${headerlessTimeline}`, profile, {
      videoDurationSeconds: 10,
      inputMode: "image-to-video",
    })).toBe(h3Timeline);
    const colonTimeline = headerlessTimeline
      .replace("SHOT 1 (0.00-3.00 seconds):", "SHOT 1: 0.00 - 3.00")
      .replace("SHOT 2 (3.00-7.00 seconds):", "SHOT 2: 3.00 - 7.00")
      .replace("SHOT 3 (7.00-10.00 seconds):", "SHOT 3: 7.00 - 10.00");
    expect(normalizeEnhancedVideoPrompt(`For the target video, at 0.00 seconds, the detailed frame is fully referenced.\n${colonTimeline}`, profile, {
      videoDurationSeconds: 10,
      inputMode: "image-to-video",
    })).toBe(`${MINIMAX_PICTURE_ALIGNMENT_INSTRUCTION}\n${colonTimeline}`);
    const labeledTimeline = headerlessTimeline
      .replace("SHOT 1 (0.00-3.00 seconds):", "SHOT 1 — OPENING ANCHOR AND PRIMARY MOTION (0.00–3.00 seconds):")
      .replace("SHOT 2 (3.00-7.00 seconds):", "SHOT 2 — DEVELOPMENT ACROSS THE FRAME (3.00–7.00 seconds):")
      .replace("SHOT 3 (7.00-10.00 seconds):", "SHOT 3 — FINAL REACTION AND RESOLVED VISUAL BEAT (7.00–10.00 seconds):");
    expect(normalizeEnhancedVideoPrompt(labeledTimeline, profile, { videoDurationSeconds: 10, inputMode: "image-to-video" }))
      .toBe(`${MINIMAX_PICTURE_ALIGNMENT_INSTRUCTION}\n${labeledTimeline}`);
    const pointTimeline = headerlessTimeline
      .replace("SHOT 1 (0.00-3.00 seconds):", "SHOT 1 — 0.00 seconds:")
      .replace("SHOT 2 (3.00-7.00 seconds):", "SHOT 2 — 3.00 seconds:")
      .replace("SHOT 3 (7.00-10.00 seconds):", "SHOT 3 — 7.00 seconds:");
    expect(normalizeEnhancedVideoPrompt(pointTimeline, profile, { videoDurationSeconds: 10, inputMode: "image-to-video" }))
      .toBe(`${MINIMAX_PICTURE_ALIGNMENT_INSTRUCTION}\n${pointTimeline}`);
    expect(() => normalizeEnhancedVideoPrompt(headerlessTimeline.replace("The glass figure", "<Picture 1> shows the glass figure"), profile, {
      videoDurationSeconds: 10,
      inputMode: "image-to-video",
    })).toThrow("video_prompt_enhancement_minimax_picture_alignment_duplicate");
    const enDashTimeline = h3Timeline.replaceAll("0.00-3.00 seconds", "0.00–3.00s")
      .replaceAll("3.00-7.00 seconds", "3.00–7.00s")
      .replaceAll("7.00-10.00 seconds", "7.00–10.00s");
    expect(normalizeEnhancedVideoPrompt(enDashTimeline, profile, { videoDurationSeconds: 10, inputMode: "image-to-video" }))
      .toBe(enDashTimeline);
  });

  it("re-canonicalizes first-frame alignment after owner edits and removes it when the source is detached", () => {
    const profile = videoPromptProfileForIdentity({ name: "MiniMax H3 I2V", inputMode: "image-to-video" });
    const timeline = h3Timeline.replace(`${MINIMAX_PICTURE_ALIGNMENT_INSTRUCTION}\n`, "");
    const restored = compileVideoPromptWithSpeech(timeline, undefined, profile, { inputMode: "image-to-video" });
    expect(restored.prompt.startsWith(`${MINIMAX_PICTURE_ALIGNMENT_INSTRUCTION}\nSHOT 1`)).toBe(true);
    expect(restored.prompt.match(/<Picture 1>/g)).toHaveLength(1);

    const deduplicated = compileVideoPromptWithSpeech(h3Timeline, undefined, profile, { inputMode: "video-extension" });
    expect(deduplicated.prompt.match(/<Picture 1>/g)).toHaveLength(1);

    const sourceDetached = compileVideoPromptWithSpeech(h3Timeline, undefined, profile, { inputMode: "text-to-video" });
    expect(sourceDetached.prompt).not.toContain("Picture 1");
  });

  it("rejects source references without a frame and timelines that do not reach the selected duration", () => {
    const profile = videoPromptProfileForIdentity({ name: "MiniMax H3 I2V" });
    const timeline = h3Timeline.replace(`${MINIMAX_PICTURE_ALIGNMENT_INSTRUCTION}\n`, "");
    expect(normalizeEnhancedVideoPrompt(timeline, profile, { videoDurationSeconds: 10, inputMode: "text-to-video" }))
      .toBe(timeline);
    expect(() => normalizeEnhancedVideoPrompt(timeline.replace("The glass figure", "Picture 1 shows the glass figure"), profile, {
      videoDurationSeconds: 10,
      inputMode: "text-to-video",
    })).toThrow("video_prompt_enhancement_minimax_picture_alignment_unexpected");
    expect(() => normalizeEnhancedVideoPrompt(
      timeline.replaceAll("3.00", "0.05").replaceAll("7.00", "0.10").replaceAll("10.00", "0.15"),
      profile,
      { videoDurationSeconds: 15, inputMode: "image-to-video" },
    )).toThrow("video_prompt_enhancement_minimax_timing_invalid");
  });

  it("keeps LTX concise, chronological, and free of model commentary", () => {
    const profile = videoPromptProfileForIdentity({ name: "LTX 2.5 Image to Video" });
    const output = "The woman holds the opening profile as the camera begins a slow lateral move across the room. Her fingers tighten around the glass, dust rises through the window light, and a reflected figure passes behind her without interrupting the motion. She turns only after the reflection disappears; the camera closes the distance, the warm light cools, and the shot ends on her steady gaze as the room settles into stillness.";
    expect(normalizeEnhancedVideoPrompt(output, profile)).toBe(output);
    expect(() => normalizeEnhancedVideoPrompt(`${output} This prompt is ready for the target model.`, profile))
      .toThrow("video_prompt_enhancement_metadata_leak");
  });

  it("defaults every video prompt to an explicit no-speech policy", () => {
    const h3Profile = videoPromptProfileForIdentity({ name: "MiniMax H3 I2V" });
    const compiled = compileVideoPromptWithSpeech(h3Timeline, undefined, h3Profile);
    expect(compiled.speech).toEqual({
      schemaVersion: "creative-studio-video-speech/1.0",
      mode: "no-speech",
      authoredText: null,
      spokenText: null,
      directive: `${VIDEO_NO_DIALOGUE_DIRECTIVE} ${VIDEO_SOUND_DESIGN_DIRECTIVE}`,
    });
    expect(compiled.prompt).toMatch(/Audio: .*No dialogue or intelligible human speech/);
    expect(compiled.prompt).toContain("Foley synchronized to visible actions");
    expect(compiled.prompt).not.toContain("bright arpeggiated synths");
    expect(compiled.prompt).not.toMatch(/Owl City/i);
    expect(compiled.prompt).not.toContain("(S1)");
    expect(normalizeVideoSpeechStamp(compiled.speech)).toEqual(compiled.speech);
  });

  it("requires fresh synchronized sound inside both H3 and LTX extension prompts", () => {
    const h3Profile = videoPromptProfileForIdentity({ name: "MiniMax H3 I2V" });
    const h3 = compileVideoPromptWithSpeech(h3Timeline, undefined, h3Profile, { continuationSound: true });
    expect(h3.prompt.match(new RegExp(VIDEO_EXTENSION_SOUND_DIRECTIVE, "g"))).toHaveLength(1);
    expect(h3.prompt).toMatch(new RegExp(`Audio:.*${VIDEO_EXTENSION_SOUND_DIRECTIVE}`));

    const ltxProfile = videoPromptProfileForIdentity({ name: "LTX 2.5 Image to Video" });
    const ltx = compileVideoPromptWithSpeech("The subject crosses the room in one continuous shot.", undefined, ltxProfile, { continuationSound: true });
    expect(ltx.prompt.match(new RegExp(VIDEO_EXTENSION_SOUND_DIRECTIVE, "g"))).toHaveLength(1);
    expect(ltx.prompt).toContain("do not loop the source track or leave the new segment silent");
    expect(ltx.prompt).toContain("No dialogue or intelligible human speech");
  });

  it("replaces only the old injected music default when a retained setup is reused", () => {
    const legacy = "Keep sound active with scene-specific ambience and effects, bright arpeggiated synths, sparkling electronic layers, buoyant programmed percussion, wistful melodic hooks, and a dreamy nocturnal-city texture when appropriate.";
    const source = `A boot lands in wet gravel. Audio: close gravel crunch and a short puddle splash. ${VIDEO_NO_DIALOGUE_DIRECTIVE} ${legacy}`;
    const profile = videoPromptProfileForIdentity({ name: "LTX 2.5" });
    const compiled = compileVideoPromptWithSpeech(source, undefined, profile);
    expect(compiled.prompt).toContain("close gravel crunch and a short puddle splash");
    expect(compiled.prompt).not.toContain("arpeggiated");
    expect(compiled.prompt).toContain("No added music, beat, or score unless explicitly requested");
    const recompiled = compileVideoPromptWithSpeech(compiled.prompt, undefined, profile);
    expect(recompiled.prompt.split(VIDEO_SOUND_DESIGN_DIRECTIVE)).toHaveLength(2);
    expect(recompiled.prompt.split(VIDEO_NO_DIALOGUE_DIRECTIVE)).toHaveLength(2);
    expect(normalizeVideoSpeechStamp(recompiled.speech)).toEqual(recompiled.speech);
  });

  it("preserves expressly authored music and exact dialogue while applying the scene sound policy", () => {
    const profile = videoPromptProfileForIdentity({ name: "LTX 2.5" });
    const compiled = compileVideoPromptWithSpeech("A pianist presses one key. Keep the requested gentle piano score under the rain.", { mode: "exact-script", text: "Listen to the rain." }, profile);
    expect(compiled.prompt).toContain("Keep the requested gentle piano score under the rain.");
    expect(compiled.speech.spokenText).toBe("Listen to the rain.");
    expect(compiled.prompt).toContain('"Listen to the rain."');
    expect(compiled.prompt).toContain("unless explicitly requested");
  });

  it("removes inherited generated-sound defaults from an explicitly silent extension", () => {
    const profile = videoPromptProfileForIdentity({ name: "LTX 2.5" });
    const previous = compileVideoPromptWithSpeech("The curtains settle as the camera stops.", undefined, profile, { continuationSound: true });
    const silent = compileVideoPromptWithSpeech(previous.prompt, undefined, profile, { soundDesign: false });
    expect(silent.prompt).not.toContain(VIDEO_SOUND_DESIGN_DIRECTIVE);
    expect(silent.prompt).not.toContain(VIDEO_EXTENSION_SOUND_DIRECTIVE);
    expect(silent.speech.directive).toBe(VIDEO_NO_DIALOGUE_DIRECTIVE);
  });

  it("does not add sound-generation instructions to source-only or silent extensions", () => {
    const profile = videoPromptProfileForIdentity({ name: "LTX 2.5 Image to Video" });
    const compiled = compileVideoPromptWithSpeech(
      "The subject crosses the room in one continuous shot.",
      { mode: "no-speech" },
      profile,
      { soundDesign: false },
    );
    expect(compiled.speech.directive).toBe(VIDEO_NO_DIALOGUE_DIRECTIVE);
    expect(compiled.prompt).toContain(VIDEO_NO_DIALOGUE_DIRECTIVE);
    expect(compiled.prompt).not.toContain("Keep sound active");
    expect(compiled.prompt).not.toContain(VIDEO_EXTENSION_SOUND_DIRECTIVE);
    expect(normalizeVideoSpeechStamp(compiled.speech)).toEqual(compiled.speech);
  });

  it("simplifies a natural line and uses MiniMax H3 dialogue syntax", () => {
    const h3Profile = videoPromptProfileForIdentity({ name: "MiniMax H3 I2V" });
    const compiled = compileVideoPromptWithSpeech(h3Timeline, {
      mode: "short-natural-line",
      text: "Have the subject say: um, I think we should leave this impossible city before it folds into us, you know? Then add a long explanation.",
    }, h3Profile);
    expect(compiled.speech).toMatchObject({
      mode: "short-natural-line",
      spokenText: "I think we should leave this impossible city before it folds into us?",
    });
    expect(compiled.prompt).toContain("(S1) is the visible subject.");
    expect(compiled.prompt).toContain("<d>[English] I think we should leave this impossible city before it folds into us?</d>");
    expect(compiled.prompt.indexOf("<d>[English]")).toBeLessThan(compiled.prompt.indexOf("Audio:"));
    expect(normalizeVideoSpeechStamp(compiled.speech)).toEqual(compiled.speech);
  });

  it("preserves an exact script verbatim and prohibits improvised words", () => {
    const ltxProfile = videoPromptProfileForIdentity({ name: "LTX 2.5 Image to Video" });
    const script = "Wait—this isn't our sky.  Keep moving.";
    const compiled = compileVideoPromptWithSpeech("The subject crosses the room in one continuous shot.", {
      mode: "exact-script",
      text: script,
    }, ltxProfile);
    expect(compiled.speech.authoredText).toBe(script);
    expect(compiled.speech.spokenText).toBe(script);
    expect(compiled.prompt).toContain(`"${script}"`);
    expect(compiled.prompt).toMatch(/Do not add, repeat, paraphrase, or improvise any other words/);
    expect(normalizeVideoSpeechStamp(compiled.speech)).toEqual(compiled.speech);
    expect(() => normalizeVideoSpeechStamp({ ...compiled.speech, spokenText: "Something else." })).toThrow("invalid_video_speech_stamp");
  });

  it("allowlists owner and runner prompt-enhancement routes exactly", () => {
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/prompt-enhancements")).toBe("prompt-enhancement-create");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/prompt-enhancements/promptenh_12345678")).toBe("prompt-enhancement-get");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/runner/prompt-enhancements/promptenh_12345678/complete"))
      .toBe("runner-prompt-enhancement-complete");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/prompt-enhancements/promptenh_12345678/complete")).toBeNull();
  });
});
