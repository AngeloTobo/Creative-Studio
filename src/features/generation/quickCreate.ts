import type { WorkflowDefinition, WorkflowParameter } from "../../../shared/contracts";

export type CreateIntent = "image" | "video" | "music" | "train";
export type QuickSourceKind = "image" | "audio" | "video";

export function workflowCreateIntent(value: string): Exclude<CreateIntent, "train"> {
  if (value === "audio" || value === "music") return "music";
  return value === "video" ? "video" : "image";
}

function workflowScore(workflow: WorkflowDefinition, sourceKind: QuickSourceKind | null) {
  const media = workflow.currentRevision.parameters.filter((parameter) => parameter.kind === "media");
  if (!sourceKind) return media.length ? 0 : 4;
  if (media.some((parameter) => !parameter.mediaKind || parameter.mediaKind === sourceKind)) return 8;
  return media.length ? -4 : 2;
}

export function preferredQuickWorkflow(
  workflows: WorkflowDefinition[],
  intent: Exclude<CreateIntent, "train">,
  sourceKind: QuickSourceKind | null,
) {
  return workflows
    .filter((workflow) => workflowCreateIntent(workflow.modality) === intent)
    .map((workflow, index) => ({ workflow, index, score: workflowScore(workflow, sourceKind) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.workflow ?? null;
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
