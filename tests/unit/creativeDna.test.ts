import { describe, expect, it } from "vitest";
import {
  CREATIVE_DNA_SCHEMA_VERSION,
  compileCreativeDna,
  creativeDnaDescriptionSummaries,
  creativeDnaGenerationPrompt,
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
