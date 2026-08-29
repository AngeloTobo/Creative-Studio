import type { Job, WorkflowDefinition, WorkflowParameter, WorkflowScalar } from "../../../shared/contracts";

export type CreateIntent = "image" | "video" | "music" | "train";
export type QuickSourceKind = "image" | "audio" | "video";

export function workflowCreateIntent(value: string): Exclude<CreateIntent, "train"> {
  if (value === "audio" || value === "music") return "music";
  return value === "video" ? "video" : "image";
}

function workflowScore(workflow: WorkflowDefinition, sourceKind: QuickSourceKind | null) {
  const media = workflow.currentRevision.parameters.filter((parameter) => parameter.kind === "media");
  if (!sourceKind) return media.length ? 0 : 4;
  const compatible = media.filter((parameter) => !parameter.mediaKind || parameter.mediaKind === sourceKind);
  if (compatible.length) return 12 - Math.max(0, media.length - 1) * 4;
  return media.length ? -4 : 2;
}

export type PreferredQuickWorkflowOptions = {
  failedRecipeSignatures?: ReadonlySet<string>;
  recipeSignatureByWorkflowId?: Readonly<Record<string, string>>;
};

type QuickWorkflowAttempt = Pick<Job, "status" | "createdAt" | "updatedAt" | "completedAt" | "error" | "settingsStamp">;

export type QuickWorkflowRecipe = Readonly<{
  workflowId: string;
  revisionId: string | null;
  durationSeconds: number | null;
  megapixels: number | null;
}>;

const TERMINAL_JOB_STATUSES = new Set<Job["status"]>(["completed", "failed", "cancelled"]);

function attemptTime(attempt: QuickWorkflowAttempt) {
  const value = attempt.completedAt ?? attempt.updatedAt ?? attempt.createdAt;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizedRecipeNumber(value: number | null) {
  return value === null || !Number.isFinite(value) ? "auto" : String(Math.round(value * 1_000) / 1_000);
}

export function quickWorkflowRecipeSignature(recipe: QuickWorkflowRecipe) {
  return [
    recipe.workflowId,
    recipe.revisionId ?? "current",
    normalizedRecipeNumber(recipe.durationSeconds),
    normalizedRecipeNumber(recipe.megapixels),
  ].join("::");
}

function attemptRecipeSignature(attempt: QuickWorkflowAttempt) {
  const workflow = attempt.settingsStamp.workflow;
  if (!workflow) return null;
  return quickWorkflowRecipeSignature({
    workflowId: workflow.workflowId,
    revisionId: workflow.revisionId,
    durationSeconds: attempt.settingsStamp.videoDurationSeconds
      ?? attempt.settingsStamp.videoPerformance?.workload.durationSeconds
      ?? null,
    megapixels: attempt.settingsStamp.videoPerformance?.workload.megapixels ?? null,
  });
}

/** Runner/queue timeouts say nothing about whether a model recipe is valid. */
function isTransientQuickWorkflowFailure(error: string | null) {
  return /time(?:d)?[ _-]?out|deadline|comfyui.*(?:unreachable|unresponsive)|prompt[_ -]drain|runner.*(?:offline|unavailable|heartbeat)/i.test(error ?? "");
}

/**
 * Suppresses only an exact recipe after two consecutive non-transient failures.
 * A timeout never condemns the workflow, and changing duration or megapixels
 * produces a different recipe signature. Explicit owner choices remain valid.
 */
export function failedQuickWorkflowRecipeSignatures(attempts: QuickWorkflowAttempt[]) {
  const attemptsByRecipe = new Map<string, QuickWorkflowAttempt[]>();
  for (const attempt of attempts) {
    if (!TERMINAL_JOB_STATUSES.has(attempt.status)) continue;
    const signature = attemptRecipeSignature(attempt);
    if (!signature) continue;
    const current = attemptsByRecipe.get(signature) ?? [];
    current.push(attempt);
    attemptsByRecipe.set(signature, current);
  }

  const failedRecipes = new Set<string>();
  for (const [signature, recipeAttempts] of attemptsByRecipe) {
    const newest = recipeAttempts.sort((left, right) => attemptTime(right) - attemptTime(left)).slice(0, 2);
    if (newest.length === 2 && newest.every((attempt) => attempt.status === "failed" && !isTransientQuickWorkflowFailure(attempt.error))) {
      failedRecipes.add(signature);
    }
  }
  return failedRecipes;
}

export function preferredQuickWorkflow(
  workflows: WorkflowDefinition[],
  intent: Exclude<CreateIntent, "train">,
  sourceKind: QuickSourceKind | null,
  runtimeMsByWorkflowId: Record<string, number | null> = {},
  options: PreferredQuickWorkflowOptions = {},
) {
  return workflows
    .filter((workflow) => {
      if (workflowCreateIntent(workflow.modality) !== intent) return false;
      const signature = options.recipeSignatureByWorkflowId?.[workflow.id];
      return !signature || !options.failedRecipeSignatures?.has(signature);
    })
    .map((workflow, index) => ({
      workflow,
      index,
      score: workflowScore(workflow, sourceKind),
      runtime: runtimeMsByWorkflowId[workflow.id] ?? null,
    }))
    .sort((a, b) => {
      const runtimeOrder = a.runtime === null && b.runtime === null ? 0
        : a.runtime === null ? 1
          : b.runtime === null ? -1 : a.runtime - b.runtime;
      return b.score - a.score || runtimeOrder || a.index - b.index;
    })[0]?.workflow ?? null;
}

/** Music references shape the authored prompt; they are not implicit renderer inputs. */
export function quickGenerationSourceUsage<T>(
  intent: Exclude<CreateIntent, "train">,
  source: T | null,
) {
  return {
    rendererSource: intent === "music" ? null : source,
    promptOnly: intent === "music" && source !== null,
  };
}

export function quickAnimationDirection(sourceEvidence: string | null | undefined) {
  const evidence = String(sourceEvidence ?? "").replace(/\s+/g, " ").trim().slice(0, 760);
  const source = evidence ? `${evidence} ` : "";
  return `${source}Use the provided image as the exact first frame. Preserve every visible subject, identity, composition, material, color, and light relationship. Add coherent natural motion, subtle environmental movement, and one controlled camera move while maintaining temporal continuity. No text, captions, logos, black frames, scene replacement, or abrupt cuts.`.slice(0, 1_200);
}

export function quickInputBindings(
  parameters: WorkflowParameter[],
  current: Record<string, string>,
  source: { id: string; kind: QuickSourceKind } | null,
) {
  const bindings = { ...current };
  if (!source || Object.values(bindings).includes(source.id)) return bindings;
  const parameter = parameters.find((item) => item.kind === "media" && !bindings[item.id]
    && (!item.mediaKind || item.mediaKind === source.kind));
  if (parameter) bindings[parameter.id] = source.id;
  return bindings;
}

export function quickParameterValue(
  parameter: WorkflowParameter,
  promptParameterId: string | null,
  direction: string,
  effectiveValues: Record<string, WorkflowScalar>,
) {
  if (parameter.id === promptParameterId) return direction.trim();
  if (Object.prototype.hasOwnProperty.call(effectiveValues, parameter.id)) return effectiveValues[parameter.id];
  return parameter.value;
}
