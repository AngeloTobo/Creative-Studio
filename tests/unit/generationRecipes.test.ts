import { describe, expect, it } from "vitest";
import {
  generationRecipePromptProfileForSettingsStamp,
  generationRecipeSourceKindsForWorkflow,
  generationRecipeSupportsSources,
  summarizeRecipeEvidence,
  type GenerationSettingsStamp,
  type RecipeEvidence,
} from "../../shared/contracts";

const baseEvidence = {
  recipeId: "recipe_1",
  observedAt: "2026-08-26T12:00:00.000Z",
  createdAt: "2026-08-26T12:00:00.000Z",
  updatedAt: "2026-08-26T12:00:00.000Z",
} as const;

describe("generation recipes", () => {
  const directStamp: GenerationSettingsStamp = {
    schemaVersion: 1,
    source: "comfyui-workflow",
    createdAt: "2026-08-26T12:00:00.000Z",
    reusedFromJobId: null,
    prompt: "A violet glass figure",
    provider: "local-comfyui",
    modality: "image",
    workflow: { workflowId: "workflow_1", revisionId: "revision_1", version: 1, name: "Z Image Turbo", format: "comfyui-api", contentHash: "hash_1" },
    parameters: {},
    models: ["z_image_turbo_bf16.safetensors"],
    inputAssetIds: [],
  };

  it("summarizes observed speed, failures, and review decisions", () => {
    const evidence: RecipeEvidence[] = [
      { ...baseEvidence, id: "evidence_1", jobId: "job_1", outcome: "completed", durationMs: 8_000, failure: null, acceptance: "accepted" },
      { ...baseEvidence, id: "evidence_2", jobId: "job_2", outcome: "completed", durationMs: 14_000, failure: null, acceptance: "rejected" },
      { ...baseEvidence, id: "evidence_3", jobId: "job_3", outcome: "failed", durationMs: 10_000, failure: "out_of_memory", acceptance: "unreviewed" },
      { ...baseEvidence, id: "evidence_4", jobId: "job_4", outcome: "cancelled", durationMs: null, failure: null, acceptance: "archived" },
    ];

    expect(summarizeRecipeEvidence(evidence)).toEqual({
      runs: 4,
      completed: 2,
      failed: 1,
      cancelled: 1,
      accepted: 1,
      rejected: 1,
      acceptanceRate: 0.5,
      medianDurationMs: 10_000,
      fastestDurationMs: 8_000,
      slowestDurationMs: 14_000,
    });
  });

  it("requires every source kind requested by a generation intent", () => {
    const recipe = { sourceKinds: ["prompt", "image"] as const };
    expect(generationRecipeSupportsSources(recipe, ["prompt"])).toBe(true);
    expect(generationRecipeSupportsSources(recipe, ["prompt", "image"])).toBe(true);
    expect(generationRecipeSupportsSources(recipe, ["video"])).toBe(false);
    expect(generationRecipeSupportsSources(recipe, [])).toBe(false);
  });

  it("derives exact direct and enhanced prompt profiles from immutable settings", () => {
    expect(generationRecipePromptProfileForSettingsStamp(directStamp, "image")).toEqual({
      id: "creative-studio-image-direct-prompt",
      version: "1.0",
      targetModel: "z_image_turbo_bf16.safetensors",
    });
    expect(generationRecipePromptProfileForSettingsStamp({
      ...directStamp,
      modality: "music",
      promptEnhancement: {
        schemaVersion: "creative-studio-song-prompt-enhancement/1.1",
        sourcePrompt: "Violet pulse",
        enhancedPrompt: "A structured music caption",
        provider: "local-comfyui",
        workflowId: "gemma4-song-prompt-enhancer",
        workflowVersion: 1,
        model: "gemma4_e4b_it_fp8_scaled.safetensors",
        comfyPromptId: "prompt_1",
        sourceWordCount: 2,
        enhancedWordCount: 4,
        createdAt: directStamp.createdAt,
        promptProfileId: "minimax-music-3-structured-caption/1.0",
        targetModel: "MiniMax Music 3",
        outputFormat: "structured-caption",
      },
    }, "music")).toEqual({
      id: "minimax-music-3-structured-caption",
      version: "1.0",
      targetModel: "MiniMax Music 3",
    });
  });

  it("uses workflow media inputs rather than lineage media for recipe compatibility", () => {
    expect(generationRecipeSourceKindsForWorkflow([
      { id: "1::prompt", label: "Prompt", kind: "text", value: "Continue", mediaKind: null, promptRole: "positive", binding: { format: "comfyui-api", nodeId: "1", inputName: "prompt" } },
      { id: "2::image", label: "Final frame", kind: "media", value: "frame.png", mediaKind: "image", binding: { format: "comfyui-api", nodeId: "2", inputName: "image" } },
    ])).toEqual(["prompt", "image"]);
  });
});
