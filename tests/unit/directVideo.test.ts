import { describe, expect, it } from "vitest";
import {
  DEFAULT_CREATIVE_DNA_DIMENSIONS,
  createFourWayVideoGenerationVersions,
  createVideoGenerationVersions,
  normalizeVideoGenerationVariant,
} from "../../shared/contracts";
import { directVideoEnhancementDecision, videoPairIdForOutputBatch } from "../../src/features/generation/directVideo";

const productionBatchId = "output_batch_123e4567-e89b-12d3-a456-426614174000";

describe("direct video generation", () => {
  it("derives contract-valid pair IDs from production output batch IDs", () => {
    const boardPairId = videoPairIdForOutputBatch(productionBatchId, "board");
    const standardPairId = videoPairIdForOutputBatch(productionBatchId, 1);
    expect(boardPairId).toBe("video_pair_123e4567-e89b-12d3-a456-426614174000-board");
    expect(standardPairId).toBe("video_pair_123e4567-e89b-12d3-a456-426614174000-pair-1");

    const board = createFourWayVideoGenerationVersions({
      exactPrompt: "The figure turns toward the light.",
      enhancedPrompt: "The figure turns toward the light as the camera arcs into a radiant city reveal.",
      dimensions: DEFAULT_CREATIVE_DNA_DIMENSIONS,
      pairId: boardPairId,
      boardSeed: 123,
      hasSource: true,
    });
    const standard = createVideoGenerationVersions({
      direction: "The figure turns toward the light.",
      dimensions: DEFAULT_CREATIVE_DNA_DIMENSIONS,
      pairId: standardPairId,
      discoverySeed: 456,
      hasSource: true,
    });
    expect([...board, ...standard].map((version) => normalizeVideoGenerationVariant(version.variant).pairId))
      .toEqual([boardPairId, boardPairId, boardPairId, boardPairId, standardPairId, standardPairId]);

    const bounded = videoPairIdForOutputBatch(`output_batch_${"a".repeat(120)}`, Number.MAX_SAFE_INTEGER);
    expect(bounded.replace(/^video_pair_/, "")).toHaveLength(80);
    expect(() => videoPairIdForOutputBatch(productionBatchId, 0)).toThrow("invalid_output_batch_lane");
  });

  it("applies a completed matching enhancement instead of leaving auto-start stalled", () => {
    const input = {
      completed: true,
      contextMatches: true,
      sourcePrompt: "The figure turns toward the light.",
      enhancedPrompt: "The camera arcs around the figure as the city ignites.",
    };
    expect(directVideoEnhancementDecision({ ...input, currentPrompt: input.sourcePrompt })).toBe("apply");
    expect(directVideoEnhancementDecision({ ...input, currentPrompt: input.enhancedPrompt })).toBe("apply");
  });

  it("stops truthfully when the owner edits while enhancement is running", () => {
    expect(directVideoEnhancementDecision({
      completed: true,
      contextMatches: true,
      sourcePrompt: "The figure turns toward the light.",
      enhancedPrompt: "The camera arcs around the figure as the city ignites.",
      currentPrompt: "Keep the camera locked and let the lights fade.",
    })).toBe("stop-edited");
  });
});
