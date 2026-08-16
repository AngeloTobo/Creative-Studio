import { describe, expect, it } from "vitest";
import { CREATIVE_DNA_SCHEMA_VERSION, compileCreativeDna } from "../../shared/contracts";

const fixedMeta = {
  artifactId: "dna_child",
  version: 2,
  rootArtifactId: "dna_root",
  parentArtifactId: "dna_parent",
  createdAt: "2026-08-15T20:00:00.000Z",
};

describe("CreativeDNA v1", () => {
  it("preserves lineage and typed cross-modal translations", () => {
    const artifact = compileCreativeDna({
      name: "Night Glass",
      directive: "A luminous late-night piece that opens wide and lands rough.",
      targetModality: "music",
      dimensions: { energy: 82, warmth: 18 },
    }, fixedMeta);
    expect(artifact.schemaVersion).toBe(CREATIVE_DNA_SCHEMA_VERSION);
    expect(artifact.version).toBe(2);
    expect(artifact.lineage).toEqual({ rootArtifactId: "dna_root", parentArtifactId: "dna_parent" });
    expect(artifact.shared.energy).toBe(82);
    expect(artifact.shared.warmth).toBe(18);
    expect(artifact.translations).toHaveLength(2);
    expect(artifact.generationPrompts.music).toMatch(/original 60-second track/i);
    expect(artifact.generationPrompts.image).toMatch(/original image/i);
  });

  it("keeps commercial reference identity out of downstream prompts", () => {
    const referenceLabel = "Protected Song by Famous Artist";
    const artifact = compileCreativeDna({
      directive: "Make an original release with restrained verses and a bright final lift.",
      targetModality: "music",
      sourceKind: "commercial_reference",
      referenceLabel,
    }, fixedMeta);
    expect(artifact.source.referenceLabel).toBe(referenceLabel);
    expect(artifact.rights.policy).toBe("abstract-attributes-only");
    expect(artifact.rights.blockedDownstream).toContain("identifiable melody");
    expect(artifact.generationPrompts.music).not.toContain(referenceLabel);
    expect(artifact.generationPrompts.image).not.toContain(referenceLabel);
  });

  it("bounds dimensions and rejects incomplete reference provenance", () => {
    const artifact = compileCreativeDna({ directive: "A compact graphic composition.", targetModality: "image", dimensions: { energy: 140, tension: -20 } }, fixedMeta);
    expect(artifact.shared.energy).toBe(100);
    expect(artifact.shared.tension).toBe(0);
    expect(() => compileCreativeDna({ directive: "Use this reference safely.", targetModality: "image", sourceKind: "commercial_reference" }, fixedMeta)).toThrow("reference_label_required");
  });
});
