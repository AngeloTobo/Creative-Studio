import { describe, expect, it } from "vitest";
import { compileCreativeDna, createSongPromptRecommendations } from "../../shared/contracts";

describe("MiniMax Music 3 prompt recommendations", () => {
  it("grounds three distinct captions in the retained art description and CreativeDNA", () => {
    const dna = compileCreativeDna({
      name: "Glass Weather",
      directive: "A nocturnal world with patient tension, electric color, and a deliberately human edge.",
      targetModality: "image",
      dimensions: { energy: 72, tension: 68, warmth: 35, spaciousness: 76, rhythmicity: 63, organicity: 42, contrast: 81, polish: 57 },
    }, {
      artifactId: "dna_song_prompt",
      projectId: "project_song_prompt",
      version: 1,
      rootArtifactId: "dna_song_prompt",
      createdAt: "2026-08-23T20:00:00.000Z",
    });
    const art = "A translucent embryo-like form floats in a violet chamber, crossed by fine branching vessels and lit from within against a deep black field.";
    const recommendations = createSongPromptRecommendations({ artDescription: art, dna });

    expect(recommendations.map((item) => item.id)).toEqual(["art-dna", "dna-forward", "new-angle"]);
    expect(new Set(recommendations.map((item) => item.prompt)).size).toBe(3);
    for (const recommendation of recommendations) {
      expect(recommendation.evidence).toEqual({ artDescription: true, creativeDna: true });
      expect(recommendation.prompt).toContain(art);
      expect(recommendation.prompt).toContain(dna.source.directive);
      expect(recommendation.prompt).toContain("Global Metadata:");
      expect(recommendation.prompt).toContain("Vocal Details:");
      expect(recommendation.prompt).toContain("Arrangement:");
      expect(recommendation.prompt.length).toBeLessThanOrEqual(2_400);
    }
  });

  it("never leaks a commercial reference label and returns nothing without real evidence", () => {
    const dna = compileCreativeDna({
      directive: "Restrained verses, grainy texture, and a bright final lift.",
      targetModality: "music",
      sourceKind: "commercial_reference",
      referenceLabel: "Protected Artist Identity",
    }, {
      artifactId: "dna_rights_safe_song",
      projectId: "project_song_prompt",
      version: 1,
      rootArtifactId: "dna_rights_safe_song",
      createdAt: "2026-08-23T20:00:00.000Z",
    });
    const recommendations = createSongPromptRecommendations({ dna });
    expect(recommendations).toHaveLength(3);
    expect(recommendations.every((item) => !item.prompt.includes("Protected Artist Identity"))).toBe(true);
    expect(createSongPromptRecommendations({})).toEqual([]);
  });
});
