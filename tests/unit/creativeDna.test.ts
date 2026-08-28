import { describe, expect, it } from "vitest";
import {
  CREATIVE_DNA_SCHEMA_VERSION,
  compileCreativeDna,
  createFourWayVideoGenerationVersions,
  createVideoGenerationVersions,
  creativeDnaDescriptionSummaries,
  creativeDnaGenerationPrompt,
  normalizeVideoGenerationVariant,
  resolveCreativeDnaGenerationArtifact,
  type CreativeDnaTrainingAnalysis,
} from "../../shared/contracts";

const fixedMeta = {
  artifactId: "dna_child",
  projectId: "project_test",
  version: 2,
  rootArtifactId: "dna_root",
  parentArtifactId: "dna_parent",
  createdAt: "2026-08-15T20:00:00.000Z",
};

describe("CreativeDNA v1", () => {
  it("creates a faithful and a random-DNA-led video version from one direction", () => {
    const dimensions = { energy: 64, tension: 48, contrast: 62, warmth: 55, spaciousness: 58, rhythmicity: 60, organicity: 50, polish: 58 };
    const versions = createVideoGenerationVersions({
      direction: "A glass figure turns toward an approaching storm while the camera moves across the rooftop.",
      dimensions,
      pairId: "video_pair_test-12345678",
      discoverySeed: 4_294_967_294,
      hasSource: true,
    });
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      prompt: "A glass figure turns toward an approaching storm while the camera moves across the rooftop.",
      variant: { pairId: "video_pair_test-12345678", role: "aligned", seed: null, personalStyleWeight: 100, randomDnaWeight: 0, randomDimensions: null },
    });
    expect(versions[1].variant).toMatchObject({
      pairId: "video_pair_test-12345678",
      role: "discovery",
      seed: 4_294_967_294,
      personalStyleWeight: 30,
      randomDnaWeight: 70,
    });
    expect(versions[1].prompt).toContain(versions[0].prompt);
    expect(versions[1].prompt).not.toBe(versions[0].prompt);
    expect(versions[1].variant.effectiveDimensions).not.toEqual(dimensions);
    expect(createVideoGenerationVersions({ direction: versions[0].prompt, dimensions, pairId: "video_pair_test-12345678", discoverySeed: 4_294_967_294, hasSource: true })[1]).toEqual(versions[1]);
    expect(normalizeVideoGenerationVariant(versions[0].variant)).toEqual(versions[0].variant);
    expect(normalizeVideoGenerationVariant(versions[1].variant)).toEqual(versions[1].variant);
  });

  it("rejects a Discovery stamp unless random DNA outweighs personal style", () => {
    const [, discovery] = createVideoGenerationVersions({
      direction: "A suspended object rotates once in a quiet blue chamber.",
      dimensions: { energy: 50, tension: 50, contrast: 50, warmth: 50, spaciousness: 50, rhythmicity: 50, organicity: 50, polish: 50 },
      pairId: "video_pair_test-87654321",
      discoverySeed: 42,
      hasSource: false,
    });
    expect(() => normalizeVideoGenerationVariant({ ...discovery.variant, personalStyleWeight: 70, randomDnaWeight: 30 })).toThrow("invalid_video_generation_variant");
  });

  it("creates a deterministic and truthful four-way image-to-video board", () => {
    const dimensions = { energy: 64, tension: 48, contrast: 62, warmth: 55, spaciousness: 58, rhythmicity: 60, organicity: 50, polish: 58 };
    const input = {
      exactPrompt: "The figure turns toward the storm as the camera moves across the rooftop.",
      enhancedPrompt: "The figure holds still for one beat, then turns toward the storm while the camera slides low across the wet rooftop and settles on the reflected skyline.",
      dimensions,
      pairId: "video_pair_board-12345678",
      boardSeed: 4_294_967_294,
      hasSource: true,
    } as const;
    const versions = createFourWayVideoGenerationVersions(input);
    expect(versions.map((version) => version.variant.role)).toEqual(["exact", "enhanced", "left-field", "awe"]);
    expect(versions.map((version) => version.prompt)).toHaveLength(new Set(versions.map((version) => version.prompt)).size);
    expect(versions.map((version) => version.variant.seed)).toHaveLength(new Set(versions.map((version) => version.variant.seed)).size);
    expect(versions[0].prompt).toBe(input.exactPrompt);
    expect(versions[1].prompt).toBe(input.enhancedPrompt);
    expect(versions[2].variant).toMatchObject({ schemaVersion: "creative-studio-video-variant/1.1", personalStyleWeight: 25, randomDnaWeight: 75 });
    expect(versions[3].variant).toMatchObject({ schemaVersion: "creative-studio-video-variant/1.1", personalStyleWeight: 10, randomDnaWeight: 90 });
    expect(versions[2].prompt).toMatch(/Preserve the source subject/);
    expect(versions[3].prompt).toMatch(/opening frame must remain unmistakable/);
    expect(createFourWayVideoGenerationVersions(input)).toEqual(versions);
    versions.forEach((version) => expect(normalizeVideoGenerationVariant(version.variant)).toEqual(version.variant));
  });

  it("does not claim an Enhanced version when no actual enhancement exists", () => {
    expect(() => createFourWayVideoGenerationVersions({
      exactPrompt: "The figure turns toward the storm.",
      enhancedPrompt: "  THE figure turns toward   the storm. ",
      dimensions: { energy: 50, tension: 50, contrast: 50, warmth: 50, spaciousness: 50, rhythmicity: 50, organicity: 50, polish: 50 },
      pairId: "video_pair_board-87654321",
      boardSeed: 42,
      hasSource: true,
    })).toThrow("enhanced_prompt_must_differ");
  });

  it("preserves lineage and typed cross-modal translations", () => {
    const artifact = compileCreativeDna({
      name: "Night Glass",
      directive: "A luminous late-night piece that opens wide and lands rough.",
      targetModality: "music",
      dimensions: { energy: 82, warmth: 18 },
    }, fixedMeta);
    expect(artifact.schemaVersion).toBe(CREATIVE_DNA_SCHEMA_VERSION);
    expect(artifact.projectId).toBe("project_test");
    expect(artifact.version).toBe(2);
    expect(artifact.lineage).toEqual({ rootArtifactId: "dna_root", parentArtifactId: "dna_parent" });
    expect(artifact.shared.energy).toBe(82);
    expect(artifact.shared.warmth).toBe(18);
    expect(artifact.translations).toHaveLength(2);
    expect(artifact.generationPrompts.music).toMatch(/original 60-second track/i);
    expect(artifact.generationPrompts.image).toBe("A luminous late-night piece that opens wide and lands rough.");
    expect(artifact.generationPrompts.image).not.toMatch(/Create an original image|CreativeDNA:|Direction:/i);
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

  it("retains selected owner uploads as provenance without leaking asset identity into prompts", () => {
    const artifact = compileCreativeDna({
      name: "Embryo study",
      directive: "A translucent organic form suspended in a quiet dark field with fine internal detail.",
      targetModality: "image",
      sourceKind: "owner_uploads",
      referenceAssetIds: ["media_owner_image", "media_owner_image", "media_owner_audio"],
    }, fixedMeta);
    expect(artifact.source).toMatchObject({
      kind: "owner_uploads",
      referenceLabel: null,
      referenceAssetIds: ["media_owner_image", "media_owner_audio"],
    });
    expect(artifact.evidence).toContainEqual(expect.objectContaining({ path: "source.referenceAssetIds", downstream: false }));
    expect(artifact.rights).toMatchObject({ policy: "original-input", referenceStoredAsProvenanceOnly: false });
    expect(artifact.generationPrompts.image).toBe(artifact.source.directive);
    expect(artifact.generationPrompts.image).not.toMatch(/media_owner|owner-upload/i);
    expect(() => compileCreativeDna({
      directive: "Reference my retained works.",
      targetModality: "image",
      sourceKind: "owner_uploads",
    }, fixedMeta)).toThrow("reference_assets_required");
  });

  it("bounds dimensions and rejects incomplete reference provenance", () => {
    const artifact = compileCreativeDna({ directive: "A compact graphic composition.", targetModality: "image", dimensions: { energy: 140, tension: -20 } }, fixedMeta);
    expect(artifact.shared.energy).toBe(100);
    expect(artifact.shared.tension).toBe(0);
    expect(() => compileCreativeDna({ directive: "Use this reference safely.", targetModality: "image", sourceKind: "commercial_reference" }, fixedMeta)).toThrow("reference_label_required");
  });

  it("uses a trained image description for existing DNA instead of its legacy generic directive", () => {
    const legacy = compileCreativeDna({ directive: "Evidence-synthesized image language from 1 consented image source.", targetModality: "image" }, fixedMeta);
    legacy.generationPrompts.image = "Create an original image. Direction: Evidence-synthesized image language.";
    legacy.training = {
      jobId: "training_1",
      runnerId: "runner_1",
      assetIds: ["media_1"],
      trainingExampleIds: [],
      analysis: {
        schemaVersion: "creative-dna-training-analysis/1.1",
        createdAt: fixedMeta.createdAt,
        summary: "Measured one source.",
        sources: [{
          sourceId: "media_1", mediaId: "media_1", sourceType: "upload", kind: "image", label: "Source image",
          detailedDescription: {
            schemaVersion: "creative-dna-media-description/1.0",
            text: "Analysis notes.\n\nA matte black balloon with a golden eye-like tuft floats above a green field beneath a pale overcast sky, centered in a wide landscape with soft diffused light and thin trailing filaments.",
            provider: "local-comfyui", workflowId: "gemma4-multimodal-description", workflowVersion: 1,
            model: "gemma4_e4b_it_fp8_scaled.safetensors", prompt: "Describe the image.", comfyPromptId: "prompt-12345678", settings: {},
          },
          observations: [], metrics: {}, dimensions: {}, confidence: 0.9,
        }],
        dimensions: Object.fromEntries(Object.entries(legacy.shared).map(([key, value]) => [key, { value, confidence: 0.9, sourceIds: ["media_1"] }])) as CreativeDnaTrainingAnalysis["dimensions"],
      },
    };
    const summaries = creativeDnaDescriptionSummaries(legacy.training.analysis.sources[0].detailedDescription!);
    expect(summaries.longSummary).toBe("Analysis notes.");
    expect(summaries.shortSummary).toMatch(/^A matte black balloon/);
    const resolved = resolveCreativeDnaGenerationArtifact(legacy);
    expect(resolved.source.directive).toMatch(/^A matte black balloon/);
    expect(creativeDnaGenerationPrompt(resolved, "image")).toBe(resolved.source.directive);
    expect(resolved.generationPrompts.image).not.toMatch(/Evidence-synthesized|Create an original image|CreativeDNA:/i);
  });
});
