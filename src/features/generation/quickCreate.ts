import type { WorkflowDefinition, WorkflowParameter, WorkflowScalar } from "../../../shared/contracts";

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

export function preferredQuickWorkflow(
  workflows: WorkflowDefinition[],
  intent: Exclude<CreateIntent, "train">,
  sourceKind: QuickSourceKind | null,
  runtimeMsByWorkflowId: Record<string, number | null> = {},
) {
  return workflows
    .filter((workflow) => workflowCreateIntent(workflow.modality) === intent)
    .map((workflow, index) => ({ workflow, index, score: workflowScore(workflow, sourceKind), runtime: runtimeMsByWorkflowId[workflow.id] ?? null }))
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
