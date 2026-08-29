import { describe, expect, it } from "vitest";
import {
  assertLoveLoopPromptPolicy,
  loveLoopDailyBlueprints,
  loveLoopLocalDate,
  loveLoopVideoPromptForProfile,
  type CreativeDnaDimensions,
} from "../../shared/contracts";
import { loveLoopErrorDetail } from "../../src/features/loveLoop/loveLoopPresentation";

const dimensions: CreativeDnaDimensions = {
  energy: 71,
  tension: 43,
  contrast: 78,
  warmth: 68,
  spaciousness: 73,
  rhythmicity: 61,
  organicity: 39,
  polish: 82,
};

function chicagoParts(value: string) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

describe("Love Loop daily schedule", () => {
  it("creates exactly three stable, unique surprise windows with two images and one video", () => {
    const first = loveLoopDailyBlueprints("love_repeatable", "2026-08-29", "America/Chicago", dimensions);
    const repeated = loveLoopDailyBlueprints("love_repeatable", "2026-08-29", "America/Chicago", dimensions);

    expect(repeated).toEqual(first);
    expect(first).toHaveLength(3);
    expect(new Set(first.map((drop) => drop.scheduledFor)).size).toBe(3);
    expect(new Set(first.map((drop) => drop.conceptId)).size).toBe(3);
    expect(first.filter((drop) => drop.modality === "image")).toHaveLength(2);
    expect(first.filter((drop) => drop.modality === "video")).toHaveLength(1);
    expect(first.map((drop) => drop.ordinal)).toEqual([1, 2, 3]);

    const localMinutes = first.map((drop) => {
      const parts = chicagoParts(drop.scheduledFor);
      expect(`${parts.year}-${parts.month}-${parts.day}`).toBe("2026-08-29");
      return Number(parts.hour) * 60 + Number(parts.minute);
    });
    expect(localMinutes[0]).toBeGreaterThanOrEqual(8 * 60 + 15);
    expect(localMinutes[0]).toBeLessThanOrEqual(10 * 60 + 45);
    expect(localMinutes[1]).toBeGreaterThanOrEqual(13 * 60);
    expect(localMinutes[1]).toBeLessThanOrEqual(16 * 60 + 30);
    expect(localMinutes[2]).toBeGreaterThanOrEqual(19 * 60);
    expect(localMinutes[2]).toBeLessThanOrEqual(22 * 60);
  });

  it("keeps local dates and valid daytime windows across both Chicago DST boundaries", () => {
    for (const localDate of ["2026-03-08", "2026-11-01"]) {
      const drops = loveLoopDailyBlueprints("love_dst", localDate, "America/Chicago", dimensions);
      expect(drops).toHaveLength(3);
      for (const drop of drops) {
        const parts = chicagoParts(drop.scheduledFor);
        expect(`${parts.year}-${parts.month}-${parts.day}`).toBe(localDate);
        expect(loveLoopLocalDate(new Date(drop.scheduledFor), "America/Chicago")).toBe(localDate);
      }
    }
  });

  it("varies concepts, seeds, times, and shuffled modality positions across days", () => {
    const days = Array.from({ length: 32 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10);
      return loveLoopDailyBlueprints("love_varied", date, "America/Chicago", dimensions);
    });
    expect(new Set(days.flat().map((drop) => drop.seed)).size).toBe(96);
    expect(new Set(days.flat().map((drop) => drop.conceptId)).size).toBeGreaterThanOrEqual(7);
    expect(new Set(days.map((drops) => drops.findIndex((drop) => drop.modality === "video"))).size).toBe(3);
    expect(new Set(days.flat().map((drop) => drop.scheduledFor.slice(11, 16))).size).toBeGreaterThan(20);
  });

  it("keeps names, fake quotes, provider metadata, and manipulative language out of every prompt", () => {
    const drops = loveLoopDailyBlueprints("love_private", "2026-08-29", "America/Chicago", dimensions);
    for (const drop of drops) {
      expect(assertLoveLoopPromptPolicy(drop.prompt)).toBe(drop.prompt);
      expect(drop.prompt).toMatch(/artist/i);
      expect(drop.prompt).toMatch(/husband/i);
      expect(drop.prompt).not.toMatch(/Angelo|ComfyUI|Gemma|workflow|language model|["“”]/i);
      expect(drop.prompt).not.toMatch(/worship|possess|cannot live without/i);
      if (drop.modality === "video") {
        const natural = loveLoopVideoPromptForProfile(drop.prompt, "natural-language", 5);
        const minimax = loveLoopVideoPromptForProfile(drop.prompt, "minimax-h3-timeline", 5);
        expect(natural).not.toMatch(/^SHOT/i);
        expect(natural).toMatch(/scene-specific ambience/i);
        expect(minimax).toMatch(/^SHOT 1 \(0\.00s–5\.00s\):/i);
        expect(minimax).toMatch(/\nAudio:/i);
      }
    }
  });

  it("translates all eight CreativeDNA axes into concrete provider direction", () => {
    const prompt = loveLoopDailyBlueprints("love_all_axes", "2026-08-29", "America/Chicago", dimensions)[0].prompt;
    expect(prompt).toContain("decisive kinetic gesture");
    expect(prompt).toContain("gentle point of friction");
    expect(prompt).toContain("bold tonal separation");
    expect(prompt).toContain("warm amber");
    expect(prompt).toContain("wide breathing room");
    expect(prompt).toContain("restrained rhythm");
    expect(prompt).toContain("deliberate exchange between tactile and engineered materials");
    expect(prompt).toContain("highly resolved surfaces");
  });

  it("turns jobless setup failures into useful repair instructions", () => {
    expect(loveLoopErrorDetail("love_loop_workflow_changed")).toMatch(/saved model changed/i);
    expect(loveLoopErrorDetail("love_loop_fast_video_required")).toMatch(/fast limit/i);
    expect(loveLoopErrorDetail("creative_dna_not_found")).toMatch(/CreativeDNA is unavailable/i);
    expect(loveLoopErrorDetail("unexpected_failure_code")).toBe("Setup stopped: unexpected failure code");
  });

  it("rejects invalid schedule identities, timezones, and unsafe prompt text", () => {
    expect(() => loveLoopDailyBlueprints("bad", "2026-08-29", "America/Chicago", dimensions)).toThrow("love_loop_schedule_invalid");
    expect(() => loveLoopDailyBlueprints("love_valid", "2026-08-29", "Not/A_Timezone", dimensions)).toThrow("love_loop_schedule_invalid");
    expect(() => assertLoveLoopPromptPolicy("Angelo says \"I am perfect\" because a language model said so.".repeat(4))).toThrow("love_loop_prompt_policy_failed");
    expect(() => assertLoveLoopPromptPolicy("The artist repeats “a fabricated quotation from his husband” as testimony. ".repeat(3))).toThrow("love_loop_prompt_policy_failed");
  });
});
