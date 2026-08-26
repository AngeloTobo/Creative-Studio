import { describe, expect, it } from "vitest";
import { modelTrainingAssetKind, modelTrainingRecipe, normalizeModelTrainingConcept } from "../../shared/contracts";

describe("real model training contracts", () => {
  it("keeps music training on the explicit ACE-Step provider", () => {
    const music = modelTrainingRecipe("music-style", "balanced");
    expect(music.provider).toBe("ace-step-1.5-lora");
    expect(music.optimization.epochs).toBe(100);
    expect(modelTrainingAssetKind("music-style")).toBe("audio");
  });

  it("normalizes a reusable music style concept without accepting commands or paths", () => {
    const concept = normalizeModelTrainingConcept({
      target: "music-style",
      name: "Embryo pulse",
      triggerToken: "Embryo Pulse!!",
      description: "A tactile electronic music language with controlled friction and an intimate spatial field.",
      continuityRules: ["Keep the bass tactile and close.", "Keep the bass tactile and close."],
    });
    expect(concept.triggerToken).toBe("embryo_pulse");
    expect(concept.continuityRules).toEqual(["Keep the bass tactile and close."]);
  });

  it("rejects unsupported training targets", () => {
    expect(() => modelTrainingRecipe("video" as never, "proof")).toThrow("invalid_model_training_target");
  });
});
