import {
  FAST_VIDEO_MAX_MEGAPIXELS,
  assessVideoPerformance,
  canonicalGenerationPerformanceParameters,
  loveLoopLocalDate,
  type LoveLoop,
  type LoveLoopDrop,
  type StudioSnapshot,
  type WorkflowParameter,
} from "../../../shared/contracts";
import { overnightWorkflowCandidates } from "../overnight";

export const LOVE_LOOP_WINDOWS = [
  { ordinal: 1 as const, label: "Morning", shortLabel: "AM", fallback: "8:15-10:45" },
  { ordinal: 2 as const, label: "Afternoon", shortLabel: "PM", fallback: "1:00-4:30" },
  { ordinal: 3 as const, label: "Evening", shortLabel: "EVE", fallback: "7:00-10:00" },
] as const;

type WorkflowCandidate = ReturnType<typeof overnightWorkflowCandidates>[number];

function effectiveParameters(candidate: WorkflowCandidate): WorkflowParameter[] {
  return candidate.workflow.currentRevision.parameters.map((parameter) => ({
    ...parameter,
    value: candidate.recipe && Object.prototype.hasOwnProperty.call(candidate.recipe.parameters, parameter.id)
      ? candidate.recipe.parameters[parameter.id]
      : parameter.value,
  }));
}

export function bestLoveLoopWorkflows(snapshot: StudioSnapshot, projectId: string) {
  const image = overnightWorkflowCandidates(snapshot, projectId, "image")[0] ?? null;
  const video = overnightWorkflowCandidates(snapshot, projectId, "video").find((candidate) => {
    if (candidate.selection.videoDurationSeconds !== 5) return false;
    const parameters = effectiveParameters(candidate);
    const assessment = assessVideoPerformance({
      parameters: canonicalGenerationPerformanceParameters(parameters),
      models: candidate.workflow.currentRevision.models,
      inputAssetIds: [],
      inputArtifactIds: [],
      prompt: "",
      videoDurationSeconds: 5,
    });
    return !assessment.requiresExplicitHeavy
      && assessment.workload.megapixels !== null
      && assessment.workload.megapixels <= FAST_VIDEO_MAX_MEGAPIXELS + Number.EPSILON;
  }) ?? null;
  return { image, video };
}

export function loveLoopToday(loop: LoveLoop, now = new Date()) {
  try {
    const localDate = loveLoopLocalDate(now, loop.timezone);
    return loop.drops
      .filter((drop) => drop.localDate === localDate)
      .sort((left, right) => left.ordinal - right.ordinal);
  } catch {
    return [];
  }
}

export function loveLoopDropForWindow(drops: readonly LoveLoopDrop[], ordinal: 1 | 2 | 3) {
  return drops.find((drop) => drop.ordinal === ordinal) ?? null;
}

export function loveLoopDropTime(drop: LoveLoopDrop | null, timezone: string | null) {
  if (!drop) return null;
  try {
    return new Intl.DateTimeFormat([], {
      timeZone: timezone ?? undefined,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(drop.scheduledFor));
  } catch {
    return new Date(drop.scheduledFor).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

export function loveLoopStatusLabel(status: LoveLoop["status"]) {
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  if (status === "needs-attention") return "Needs attention";
  return "Off";
}

export function loveLoopErrorDetail(error: string | null) {
  if (!error) return null;
  if (error === "love_loop_failure_limit_reached") return "Three recent renders failed - inspect their errors, then repair and resume";
  if (error === "love_loop_recipe_changed" || error === "love_loop_workflow_changed") return "The saved model changed - repair with the current fast workflows";
  if (error === "love_loop_fast_image_required" || error === "love_loop_fast_video_required") return "A selected workflow is no longer inside the fast limit - choose a current fast model";
  if (error === "creative_dna_not_found" || error === "training_review_required") return "The selected CreativeDNA is unavailable - approve a current DNA, then repair";
  return `Setup stopped: ${error.replaceAll("_", " ")}`;
}

export function nextLoveLoopDrop(drops: readonly LoveLoopDrop[], now = new Date()) {
  const nowMs = now.getTime();
  return drops.find((drop) => drop.status === "running" || drop.status === "queued")
    ?? drops.find((drop) => drop.status === "planned" && Date.parse(drop.scheduledFor) >= nowMs)
    ?? null;
}
