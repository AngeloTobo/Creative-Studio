import type { Job, WorkflowDefinition, WorkflowParameter, WorkflowScalar } from "../../../shared/contracts";

export type CreateIntent = "image" | "video" | "music" | "3d" | "train";
export type QuickSourceKind = "image" | "audio" | "video" | "3d";

export function workflowCreateIntent(value: string): Exclude<CreateIntent, "train"> {
  if (value === "audio" || value === "music") return "music";
  return value === "3d" ? "3d" : value === "video" ? "video" : "image";
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

function quickAnimationBeats(evidence: string) {
  const biological = /\b(?:embryos?|cells?|membranes?|organs?|biological|organic tissues?)\b/i.test(evidence);
  const character = /\b(?:person|portrait|alien|woman|man|character|performer)\b/i.test(evidence)
    || (!biological && /\b(?:figure|human|face|body)\b/i.test(evidence));
  if (character) {
    if (/\bhand[ -]?mirror\b/i.test(evidence)) return [
      /\b(?:laugh|laughing|amused|smile|smiling|grin|grinning)\b/i.test(evidence)
        ? "the figure checks the hand mirror and breaks into a brief, natural laugh"
        : "the figure studies the hand mirror as one small reaction crosses their face",
      "the mirror tilts in one hand while the free hand relaxes and nearby reflective details catch a passing glint",
      "the camera makes a slow, level push-in and holds on the changed expression",
    ];
    return [
      "the figure makes one small, motivated gesture as their expression changes naturally",
      "one nearby detail answers the movement with a subtle shift",
      "the camera eases to a clean three-quarter view and holds as the reaction settles",
    ];
  }
  if (biological) return [
    "a fine light pulse crosses the central form and makes its surface flex once",
    "nearby particles curl into a slow spiral as a stronger pulse answers",
    "the spiral clears during a slow push toward one newly lit internal detail",
  ];
  if (/\b(?:bird|animal|creature|insect|fish|dog|cat|horse)\b/i.test(evidence)) return [
    "the creature turns toward an off-frame cue and begins one purposeful movement",
    "the nearby environment ripples in response",
    "the camera tracks alongside and holds when the creature stops at a new point of interest",
  ];
  if (/\b(?:car|vehicle|ship|aircraft|train|motorcycle|machine|robot)\b/i.test(evidence)) return [
    "the machine powers on through one clear sequence of light and movement",
    "it advances or pivots once as reflections sweep across its path",
    "the camera tracks low and holds when the machine reaches its final position",
  ];
  if (/\b(?:city|building|architecture|room|interior|tower|street|rooftop)\b/i.test(evidence)) return [
    "practical lights wake across the visible structure in one directional cascade",
    "movement carries that energy into the deeper space",
    "the camera passes one foreground layer and holds on a newly revealed spatial relationship",
  ];
  if (/\b(?:flower|plant|tree|forest|garden|landscape|water|ocean|cloud|mountain)\b/i.test(evidence)) return [
    "a focused gust or current bends the nearest natural forms in one direction",
    "light follows the movement into the deeper layers",
    "the camera advances through the response and holds on one transformed detail",
  ];
  if (/\b(?:sculpture|object|form|artifact|mask|vessel|sphere|structure)\b/i.test(evidence)) return [
    "the focal object makes one deliberate turn as a reflection or inner light crosses its surface",
    "one nearby element shifts and changes the surrounding shadow",
    "the camera completes a restrained orbit and holds on the final silhouette",
  ];
  return [
    "the focal subject turns or tilts toward the strongest visible light",
    "one nearby detail shifts as the light changes in response",
    "the camera passes a foreground detail and holds after the motion resolves",
  ];
}

/**
 * One-click Animate must contribute a real motion idea, not merely restate the
 * source caption. The source description selects grounded motion internally;
 * the visible prompt lets the retained pixels carry appearance and styling.
 */
export function quickAnimationDirection(sourceEvidence: string | null | undefined) {
  const evidence = String(sourceEvidence ?? "").replace(/\s+/g, " ").trim().slice(0, 900);
  const [opening, escalation, resolve] = quickAnimationBeats(evidence);
  const sentence = (value: string) => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  return `${sentence(opening)}. ${sentence(escalation)}. ${sentence(resolve)}. Use this image as the exact first frame; preserve identity, anatomy, materials, palette, and light. Keep the camera level with coherent ambient sound and original nonverbal music. No dialogue, narration, lyrics, added text, captions, logos, black frames, replacement shots, abrupt cuts, or camera roll.`.slice(0, 1_200);
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
