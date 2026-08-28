import { describe, expect, it } from "vitest";
import {
  generationBatchAttempt,
  generationBatchIdempotencyKey,
  generationBatchSeed,
  generationGoalCanScout,
  generationGoalOutputCount,
  generationGoalRunLabel,
} from "../../src/features/generation/generationGoals";

describe("generation goals", () => {
  it("creates a three-result image scout and preserves the two-video default", () => {
    expect(generationGoalOutputCount("scout", "image")).toBe(3);
    expect(generationGoalOutputCount("explore", "video")).toBe(2);
    expect(generationGoalOutputCount("master", "music")).toBe(1);
    expect(generationGoalOutputCount("explore", "image", false, 4)).toBe(4);
    expect(generationGoalOutputCount("master", "video", false, 1)).toBe(1);
  });

  it("requires a retained or uploaded image source for scouting", () => {
    expect(generationGoalCanScout("image", "image")).toBe(true);
    expect(generationGoalCanScout("image", null)).toBe(false);
    expect(generationGoalCanScout("image", "video")).toBe(false);
    expect(generationGoalCanScout("video", "image")).toBe(false);
  });

  it("uses artist-facing action labels", () => {
    expect(generationGoalRunLabel("scout", "image")).toBe("Generate 3 scouts");
    expect(generationGoalRunLabel("master", "music")).toBe("Generate master song");
  });

  it("keeps batch-role retries idempotent and Worker-safe", () => {
    const batchId = "video_pair_123e4567-e89b-12d3-a456-426614174000";
    expect(generationBatchIdempotencyKey(batchId, "aligned")).toBe(generationBatchIdempotencyKey(batchId, "aligned"));
    expect(generationBatchIdempotencyKey(batchId, "aligned")).not.toBe(generationBatchIdempotencyKey(batchId, "discovery"));
    expect(generationBatchIdempotencyKey(batchId, "discovery")).toMatch(/^[a-z0-9_-]{16,100}$/i);
  });

  it("derives distinct, reproducible renderer seeds for every retained output", () => {
    const batchId = "output_batch_123e4567-e89b-12d3-a456-426614174000";
    expect(generationBatchSeed(batchId, 0)).toBe(generationBatchSeed(batchId, 0));
    expect(new Set([0, 1, 2, 3].map((index) => generationBatchSeed(batchId, index))).size).toBe(4);
    expect(generationBatchSeed(batchId, 0)).toBeGreaterThanOrEqual(0);
    expect(generationBatchSeed(batchId, 0)).toBeLessThanOrEqual(0xffff_ffff);
  });

  it("rotates a partial batch when the artist changes the request", () => {
    const first = generationBatchAttempt({ id: "pair_one", signature: "" }, "prompt A", () => "pair_two");
    expect(generationBatchAttempt(first, "prompt A", () => "pair_two")).toEqual(first);
    expect(generationBatchAttempt(first, "prompt B", () => "pair_two")).toEqual({ id: "pair_two", signature: "prompt B" });
  });
});
