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

function quickAnimationBeats(evidence: string) {
  if (/\b(?:embryo|anatomy|cell|membrane|organ|biological|organic tissue)\b/i.test(evidence)) return [
    "a fine pulse of light travels across the central organic form and makes its surface flex once",
    "the surrounding fluid and suspended particles curl into a slow spiral as the form answers with a second, stronger pulse",
    "the spiral clears and the camera settles closer on one newly illuminated internal detail",
  ];
  if (/\b(?:person|portrait|figure|human|alien|woman|man|face|body|character|performer)\b/i.test(evidence)) return [
    "the central figure turns toward the strongest visible light and fixes their attention on it",
    "their posture shifts with one deliberate movement while nearby fabric, hair, smoke, or loose material responds to a passing gust",
    "the camera arcs past a foreground detail and settles on a decisive profile or three-quarter view as the environment finishes reacting",
  ];
  if (/\b(?:bird|animal|creature|insect|fish|dog|cat|horse)\b/i.test(evidence)) return [
    "the creature snaps its attention toward an off-frame sound and begins one purposeful movement",
    "the ground, water, foliage, fur, feathers, or nearby particles answer that movement with a visible wake",
    "the camera tracks alongside and resolves as the creature stops at a newly revealed point of interest",
  ];
  if (/\b(?:car|vehicle|ship|aircraft|train|motorcycle|machine|robot)\b/i.test(evidence)) return [
    "the machine powers on in a clear sequence of lights, joints, or moving surfaces",
    "it advances or pivots once while reflections and loose environmental material sweep across its path",
    "the camera tracks the movement and settles low as the machine reaches a precise final position",
  ];
  if (/\b(?:city|building|architecture|room|interior|tower|street|rooftop)\b/i.test(evidence)) return [
    "one bank of practical light ignites across the visible structure in a directional cascade",
    "wind, traffic, curtains, signs, mist, or loose debris carries that energy through the depth of the scene",
    "the camera pushes through one foreground layer and resolves on a newly revealed architectural relationship",
  ];
  if (/\b(?:flower|plant|tree|forest|garden|landscape|water|ocean|cloud|mountain)\b/i.test(evidence)) return [
    "a focused gust or current crosses the scene and bends the nearest natural forms in one readable direction",
    "light follows the movement through the deeper layers while particles, leaves, water, or cloud mass build a visible response",
    "the camera rises or advances through that response and settles on one transformed pocket of the landscape",
  ];
  if (/\b(?:sculpture|object|form|artifact|mask|vessel|sphere|structure)\b/i.test(evidence)) return [
    "the focal object rotates a deliberate quarter turn as a seam, reflection, or inner light wakes across its surface",
    "one nearby material element lifts, unfolds, or circles it and briefly changes the surrounding shadows",
    "the camera completes a restrained orbit and settles as every moving element locks into a stronger final silhouette",
  ];
  return [
    "the focal subject turns or tilts toward the strongest visible light in one clear initiating move",
    "the nearest loose element lifts and travels through the frame while the environment answers with a visible change in light and depth",
    "the camera advances past one foreground detail and settles on a stronger final silhouette after the motion resolves",
  ];
}

/**
 * One-click Animate must contribute a real motion idea, not merely restate the
 * source caption. The source description selects grounded physical material,
 * while each output still receives a concrete three-beat action and reveal.
 */
export function quickAnimationDirection(sourceEvidence: string | null | undefined) {
  const evidence = String(sourceEvidence ?? "").replace(/\s+/g, " ").trim().slice(0, 900);
  const [opening, escalation, resolve] = quickAnimationBeats(evidence);
  const source = evidence ? `Opening-frame evidence: ${evidence} ` : "";
  return `${source}Use the provided image as the exact first frame and keep every visible identity, anatomy, material, palette, and light relationship continuous. Beat 1: ${opening}. Beat 2: ${escalation}. Beat 3: ${resolve}. Keep the horizon upright and the camera physically stable with no sideways roll. Preserve coherent ambient sound and original nonverbal music; no dialogue, narration, lyrics, text, captions, logos, black frames, scene replacement, or abrupt cuts.`.slice(0, 2_400);
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
