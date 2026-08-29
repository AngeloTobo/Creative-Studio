import { describe, expect, it } from "vitest";
import {
  OVERNIGHT_PLAN_SCHEMA_VERSION,
  minimumOvernightOutputCount,
  normalizeOvernightPlan,
  overnightPlanSlots,
  overnightTaskSeed,
} from "../../shared/contracts";

describe("Overnight Studio contracts", () => {
  it("builds a stable, story-grouped image and soundtrack plan", () => {
    expect(overnightPlanSlots(["image", "music", "image"], 6, 2)).toEqual([
      { ordinal: 1, storyIndex: 1, role: "scene-image", modality: "image" },
      { ordinal: 2, storyIndex: 1, role: "scene-image", modality: "image" },
      { ordinal: 3, storyIndex: 1, role: "soundtrack", modality: "music" },
      { ordinal: 4, storyIndex: 2, role: "scene-image", modality: "image" },
      { ordinal: 5, storyIndex: 2, role: "scene-image", modality: "image" },
      { ordinal: 6, storyIndex: 2, role: "soundtrack", modality: "music" },
    ]);
  });

  it("reserves a primary work for every story and represents every selected medium", () => {
    expect(minimumOvernightOutputCount(["image", "music"], 3)).toBe(4);
    expect(minimumOvernightOutputCount(["image", "video", "music"], 3)).toBe(5);
    expect(overnightPlanSlots(["image", "music"], 4, 3)).toEqual([
      { ordinal: 1, storyIndex: 1, role: "scene-image", modality: "image" },
      { ordinal: 2, storyIndex: 1, role: "soundtrack", modality: "music" },
      { ordinal: 3, storyIndex: 2, role: "scene-image", modality: "image" },
      { ordinal: 4, storyIndex: 3, role: "scene-image", modality: "image" },
    ]);
  });

  it("stamps a non-song audio workflow as a soundscape", () => {
    expect(overnightPlanSlots(["image", "music"], 3, 1, "soundscape")).toContainEqual({
      ordinal: 3,
      storyIndex: 1,
      role: "soundscape",
      modality: "music",
    });
  });

  it("normalizes only an exact plan that matches every reserved slot", () => {
    const slots = overnightPlanSlots(["image", "music"], 4, 1);
    const plan = normalizeOvernightPlan({
      schemaVersion: OVERNIGHT_PLAN_SCHEMA_VERSION,
      title: "The Glass Orchard",
      logline: "A nocturnal orchard remembers each visitor through light and sound.",
      stories: [{ index: 1, title: "The Glass Orchard", premise: "One traveler follows a pulse through an orchard that stores memories in translucent fruit." }],
      outputs: slots.map((slot, index) => ({
        ...slot,
        sceneIndex: slot.modality === "music" ? null : index + 1,
        title: slot.modality === "music" ? "Orchard pulse" : `Orchard scene ${index + 1}`,
        prompt: slot.modality === "music"
          ? "Measured nocturnal electronics with glass percussion, warm low bass, and a restrained luminous rise."
          : `A traveler crosses a nocturnal glass orchard in scene ${index + 1}, illuminated fruit holding visible traces of memory.`,
      })),
    }, slots, 1);

    expect(plan.outputs.map((output) => [output.ordinal, output.role, output.modality])).toEqual(
      slots.map((slot) => [slot.ordinal, slot.role, slot.modality]),
    );
    expect(plan.outputs.find((output) => output.modality === "music")?.sceneIndex).toBeNull();
  });

  it("rejects extra keys, altered slots, and invalid music scene numbers", () => {
    const slots = overnightPlanSlots(["image", "music"], 3, 1);
    const valid = {
      schemaVersion: OVERNIGHT_PLAN_SCHEMA_VERSION,
      title: "Signal Garden",
      logline: "A hidden garden translates distant signals into a changing ecology.",
      stories: [{ index: 1, title: "Signal Garden", premise: "A patient observer follows one signal as it changes the garden before sunrise." }],
      outputs: slots.map((slot, index) => ({
        ...slot,
        sceneIndex: slot.modality === "music" ? null : index + 1,
        title: slot.modality === "music" ? "Garden score" : `Garden scene ${index + 1}`,
        prompt: "A precise, production-ready direction with concrete subject, environment, light, motion, material, and sound details.",
      })),
    };

    expect(() => normalizeOvernightPlan({ ...valid, commentary: "not allowed" }, slots, 1)).toThrow("overnight_plan_invalid");
    expect(() => normalizeOvernightPlan({
      ...valid,
      outputs: valid.outputs.map((output, index) => index === 0 ? { ...output, role: "scene-video" } : output),
    }, slots, 1)).toThrow("overnight_plan_output_invalid");
    expect(() => normalizeOvernightPlan({
      ...valid,
      outputs: valid.outputs.map((output) => output.modality === "music" ? { ...output, sceneIndex: 1 } : output),
    }, slots, 1)).toThrow("overnight_plan_output_invalid");
  });

  it("derives repeatable, ordinal-specific unsigned seeds", () => {
    const first = overnightTaskSeed("overnight_repeatable", 1);
    expect(first).toBe(overnightTaskSeed("overnight_repeatable", 1));
    expect(first).not.toBe(overnightTaskSeed("overnight_repeatable", 2));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(0xffff_ffff);
  });
});
