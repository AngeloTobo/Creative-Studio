import type { AcceptanceDecision, GenerationModality, GenerationSettingsStamp, IsoDateString, MediaKind } from "./domain";
import { generationWorkflowPromptParameters, type WorkflowParameter, type WorkflowScalar } from "./workflows";

export const GENERATION_RECIPE_SCHEMA_VERSION = "creative-studio-generation-recipe/1.0" as const;

export type GenerationRecipeIntentTier = "scout" | "explore" | "master";
export type GenerationRecipeSourceKind = "prompt" | MediaKind;

export type GenerationRecipePromptProfile = {
  id: string;
  version: string;
  targetModel: string | null;
};

export type RecipeEvidenceOutcome = "completed" | "failed" | "cancelled";
export type RecipeEvidenceAcceptance = AcceptanceDecision | "unreviewed";

export type RecipeEvidence = {
  id: string;
  recipeId: string;
  jobId: string;
  outcome: RecipeEvidenceOutcome;
  durationMs: number | null;
  failure: string | null;
  acceptance: RecipeEvidenceAcceptance;
  observedAt: IsoDateString;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
};

export type RecipeEvidenceSummary = {
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  accepted: number;
  rejected: number;
  acceptanceRate: number | null;
  medianDurationMs: number | null;
  fastestDurationMs: number | null;
  slowestDurationMs: number | null;
};

export type GenerationRecipe = {
  schemaVersion: typeof GENERATION_RECIPE_SCHEMA_VERSION;
  id: string;
  name: string;
  description: string;
  projectId: string | null;
  worldId: string | null;
  mediaKind: GenerationModality;
  workflowId: string;
  workflowRevisionId: string;
  modelIdentifier: string | null;
  promptProfile: GenerationRecipePromptProfile;
  parameters: Record<string, WorkflowScalar>;
  sourceKinds: GenerationRecipeSourceKind[];
  intentTier: GenerationRecipeIntentTier;
  evidence: RecipeEvidence[];
  evidenceSummary: RecipeEvidenceSummary;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  archivedAt: IsoDateString | null;
};

export type CreateGenerationRecipeRequest = {
  name: string;
  description?: string;
  projectId?: string | null;
  worldId?: string | null;
  mediaKind: GenerationModality;
  workflowId: string;
  workflowRevisionId: string;
  modelIdentifier?: string | null;
  promptProfile: GenerationRecipePromptProfile;
  parameters: Record<string, WorkflowScalar>;
  sourceKinds: GenerationRecipeSourceKind[];
  intentTier: GenerationRecipeIntentTier;
};

export type UpdateGenerationRecipeRequest = Partial<CreateGenerationRecipeRequest>;
export type RecordRecipeEvidenceRequest = { jobId: string };

function recipeProfileIdentity(identity: string) {
  const separator = identity.lastIndexOf("/");
  return separator > 0
    ? { id: identity.slice(0, separator), version: identity.slice(separator + 1) }
    : { id: identity, version: "1.0" };
}

/**
 * Derives the only prompt-profile identity that can describe a stamped execution.
 * Enhanced music must keep the model-specific profile written by the runner; every
 * other workflow uses a deterministic direct-prompt profile.
 */
export function generationRecipePromptProfileForSettingsStamp(
  stamp: GenerationSettingsStamp,
  mediaKind: GenerationModality,
): GenerationRecipePromptProfile | null {
  if (mediaKind === "music" && stamp.promptEnhancement) {
    const identity = stamp.promptEnhancement.promptProfileId?.trim();
    const targetModel = stamp.promptEnhancement.targetModel?.trim();
    if (!identity || !targetModel) return null;
    return { ...recipeProfileIdentity(identity), targetModel };
  }
  const targetModel = stamp.models.find((model) => model.trim())?.trim()
    ?? stamp.workflow?.name.trim()
    ?? null;
  return {
    ...recipeProfileIdentity(`creative-studio-${mediaKind}-direct-prompt/1.0`),
    targetModel: targetModel || null,
  };
}

/** Source compatibility follows executable workflow inputs, not lineage media. */
export function generationRecipeSourceKindsForWorkflow(parameters: readonly WorkflowParameter[]) {
  const sourceKinds = new Set<GenerationRecipeSourceKind>();
  if (generationWorkflowPromptParameters([...parameters]).length) sourceKinds.add("prompt");
  for (const parameter of parameters) {
    if (parameter.kind === "media" && parameter.mediaKind) sourceKinds.add(parameter.mediaKind);
  }
  return [...sourceKinds];
}

export function generationRecipeSupportsSources(
  recipe: { sourceKinds: readonly GenerationRecipeSourceKind[] },
  sourceKinds: readonly GenerationRecipeSourceKind[],
) {
  const supported = new Set(recipe.sourceKinds);
  return sourceKinds.length > 0 && sourceKinds.every((kind) => supported.has(kind));
}

export function summarizeRecipeEvidence(evidence: RecipeEvidence[]): RecipeEvidenceSummary {
  const durations = evidence
    .map((item) => item.durationMs)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  const accepted = evidence.filter((item) => item.acceptance === "accepted").length;
  const rejected = evidence.filter((item) => item.acceptance === "rejected").length;
  const decided = accepted + rejected;
  const middle = Math.floor(durations.length / 2);
  const medianDurationMs = !durations.length
    ? null
    : durations.length % 2
      ? durations[middle]
      : Math.round((durations[middle - 1] + durations[middle]) / 2);
  return {
    runs: evidence.length,
    completed: evidence.filter((item) => item.outcome === "completed").length,
    failed: evidence.filter((item) => item.outcome === "failed").length,
    cancelled: evidence.filter((item) => item.outcome === "cancelled").length,
    accepted,
    rejected,
    acceptanceRate: decided ? accepted / decided : null,
    medianDurationMs,
    fastestDurationMs: durations[0] ?? null,
    slowestDurationMs: durations.at(-1) ?? null,
  };
}
