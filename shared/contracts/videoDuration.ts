import type { WorkflowDefinition, WorkflowParameter } from "./workflows";

export const VIDEO_DURATION_OPTIONS = [5, 10, 15, 30, 60] as const;
export type VideoDurationSeconds = (typeof VIDEO_DURATION_OPTIONS)[number];

export type VideoDurationProfile = {
  family: "minimax-h3" | "ltx" | "other";
  label: string;
  maxSeconds: VideoDurationSeconds;
};

function parameterIdentity(parameter: WorkflowParameter) {
  const inputName = parameter.binding.format === "comfyui-api" ? parameter.binding.inputName : "";
  return `${parameter.id} ${parameter.label} ${inputName}`.replace(/[._-]+/g, " ").toLowerCase();
}

/** Finds the user-facing output duration control, including Comfy primitive nodes whose bound input is only named `value`. */
export function videoWorkflowDurationParameters(parameters: WorkflowParameter[]) {
  return parameters.filter((parameter) => {
    if (parameter.kind !== "number") return false;
    const identity = parameterIdentity(parameter);
    if (/transition|crossfade|audio|source duration|input duration|start time|end time/.test(identity)) return false;
    return /\b(?:max\s+)?duration\b|\b(?:video\s+)?(?:seconds?|length)\b/.test(identity);
  });
}

function workflowIdentity(workflow: Pick<WorkflowDefinition, "name" | "description" | "sourceFileName" | "currentRevision">) {
  return [
    workflow.name,
    workflow.description,
    workflow.sourceFileName,
    ...workflow.currentRevision.models,
  ].join(" ").toLowerCase();
}

export function videoWorkflowDurationProfile(workflow: Pick<WorkflowDefinition, "name" | "description" | "sourceFileName" | "currentRevision">): VideoDurationProfile {
  const identity = workflowIdentity(workflow);
  if (/minimax[^\n]*h3|h3[^\n]*minimax/.test(identity)) {
    return { family: "minimax-h3", label: "MiniMax H3", maxSeconds: 15 };
  }
  if (/(?:^|\W)ltx(?:\W|$)/.test(identity)) {
    return { family: "ltx", label: "LTX", maxSeconds: 60 };
  }
  return { family: "other", label: "This model", maxSeconds: 15 };
}

export function workflowSupportsVideoDuration(workflow: Pick<WorkflowDefinition, "name" | "description" | "sourceFileName" | "currentRevision">, seconds: VideoDurationSeconds) {
  return videoWorkflowDurationParameters(workflow.currentRevision.parameters).length > 0
    && seconds <= videoWorkflowDurationProfile(workflow).maxSeconds;
}

export function normalizeVideoDurationSeconds(value: unknown): VideoDurationSeconds | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return VIDEO_DURATION_OPTIONS.includes(number as VideoDurationSeconds) ? number as VideoDurationSeconds : null;
}

export function videoDurationLabel(seconds: VideoDurationSeconds) {
  return seconds === 60 ? "1m" : `${seconds}s`;
}
