export type DirectVideoEnhancementDecision = "wait" | "apply" | "stop-edited";

function canonicalPrompt(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function directVideoEnhancementDecision(input: {
  completed: boolean;
  contextMatches: boolean;
  sourcePrompt: string;
  enhancedPrompt: string | null | undefined;
  currentPrompt: string;
}): DirectVideoEnhancementDecision {
  if (!input.completed || !input.contextMatches || !input.enhancedPrompt?.trim()) return "wait";
  const current = canonicalPrompt(input.currentPrompt);
  if (current === canonicalPrompt(input.sourcePrompt) || current === canonicalPrompt(input.enhancedPrompt)) return "apply";
  return "stop-edited";
}

export function videoPairIdForOutputBatch(outputBatchId: string, lane: "board" | number) {
  if (lane !== "board" && (!Number.isSafeInteger(lane) || lane < 1)) throw new Error("invalid_output_batch_lane");
  const laneSuffix = lane === "board" ? "board" : `pair-${lane}`;
  const maxBatchSuffixLength = 80 - laneSuffix.length - 1;
  const suffix = outputBatchId
    .replace(/^output_batch_/i, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, Math.max(0, maxBatchSuffixLength));
  const pairId = `video_pair_${suffix}-${laneSuffix}`;
  if (!/^video_pair_[a-z0-9-]{8,80}$/i.test(pairId)) throw new Error("invalid_output_batch_id");
  return pairId;
}
