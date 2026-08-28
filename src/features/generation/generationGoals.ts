import type { GenerationModality } from "../../../shared/contracts";

export type GenerationGoal = "scout" | "explore" | "master";
export type GenerationOutputCount = 1 | 2 | 4;

export const GENERATION_OUTPUT_COUNTS: readonly GenerationOutputCount[] = [1, 2, 4] as const;

export const GENERATION_GOALS: ReadonlyArray<{
  id: GenerationGoal;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: "scout",
    label: "Scout directions",
    shortLabel: "Scout",
    description: "Three fast image directions for side-by-side review.",
  },
  {
    id: "explore",
    label: "Explore one",
    shortLabel: "Explore",
    description: "One recommended result using the fastest safe local settings.",
  },
  {
    id: "master",
    label: "Final master",
    shortLabel: "Master",
    description: "One result using the exact settings you choose.",
  },
] as const;

export function generationGoalOutputCount(
  goal: GenerationGoal,
  modality: GenerationModality,
  evolutionEnabled = false,
  requestedCount: GenerationOutputCount = modality === "video" ? 2 : 1,
) {
  if (evolutionEnabled || (goal === "scout" && modality === "image")) return 3;
  if (modality === "music") return 1;
  return requestedCount;
}

export function generationGoalCanScout(
  modality: GenerationModality,
  sourceKind: "image" | "audio" | "video" | null,
) {
  return modality === "image" && sourceKind === "image";
}

export function generationGoalRunLabel(goal: GenerationGoal, modality: GenerationModality) {
  if (goal === "scout" && modality === "image") return "Generate 3 scouts";
  if (goal === "master") return modality === "music" ? "Generate master song" : `Generate master ${modality}`;
  return modality === "music" ? "Generate song" : `Generate ${modality}`;
}

export function generationBatchIdempotencyKey(
  batchId: string,
  role: string,
) {
  return `batch_${batchId}_${role}`.replace(/[^a-z0-9_-]/gi, "_").slice(0, 100);
}

/** A new batch gets fresh variation while retries of that exact batch remain reproducible. */
export function generationBatchSeed(batchId: string, outputIndex: number) {
  let hash = 0x811c9dc5;
  const source = `${batchId}:${Math.max(0, Math.floor(outputIndex))}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type GenerationBatchAttempt = {
  id: string;
  signature: string;
};

/** Reuse a partial batch only while the artist's complete request is unchanged. */
export function generationBatchAttempt(
  current: GenerationBatchAttempt,
  requestSignature: string,
  nextId: () => string,
): GenerationBatchAttempt {
  if (!current.signature || current.signature === requestSignature) {
    return { id: current.id, signature: requestSignature };
  }
  return { id: nextId(), signature: requestSignature };
}
