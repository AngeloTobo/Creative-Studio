import {
  assessImagePerformance,
  musicWorkflowPromptProfile,
  normalizeVideoDurationSeconds,
  overnightPlanSlots,
  primaryWorkflowPromptParameter,
  videoWorkflowDurationParameters,
  videoWorkflowPromptProfile,
  type Acceptance,
  type GenerationModality,
  type GenerationRecipe,
  type OvernightSession,
  type OvernightWorkflowSelection,
  type StudioSnapshot,
  type WorkflowDefinition,
} from "../../../shared/contracts";

export const OVERNIGHT_MODALITIES = ["image", "video", "music"] as const satisfies readonly GenerationModality[];

const ACTIVE_OVERNIGHT_STATUSES = new Set<OvernightSession["status"]>([
  "armed",
  "planning",
  "running",
  "paused",
  "needs-attention",
]);

export function isActiveOvernightSession(session: OvernightSession) {
  return ACTIVE_OVERNIGHT_STATUSES.has(session.status);
}

export function overnightWorkflowModality(workflow: WorkflowDefinition): GenerationModality | null {
  if (workflow.modality === "audio" || workflow.modality === "music") return "music";
  if (workflow.modality === "image" || workflow.modality === "video") return workflow.modality;
  return null;
}

/** Overnight v1 deliberately uses workflows that can execute without a source upload. */
export function isEligibleOvernightWorkflow(workflow: WorkflowDefinition, projectId: string, modality: GenerationModality) {
  return workflow.projectId === projectId
    && workflow.executionState === "ready"
    && workflow.currentRevision.format === "comfyui-api"
    && overnightWorkflowModality(workflow) === modality
    && Boolean(primaryWorkflowPromptParameter(workflow.currentRevision.parameters, modality))
    && !workflow.currentRevision.parameters.some((parameter) => parameter.kind === "media");
}

function recipeTierScore(recipe: GenerationRecipe) {
  if (recipe.intentTier === "master") return 30;
  if (recipe.intentTier === "explore") return 18;
  return 8;
}

function recipeScore(recipe: GenerationRecipe, projectId: string) {
  const summary = recipe.evidenceSummary;
  return (recipe.projectId === projectId ? 100 : 40)
    + recipeTierScore(recipe)
    + summary.completed * 3
    - summary.failed * 5
    - summary.cancelled * 2
    + (summary.acceptanceRate ?? 0) * 40
    + (summary.medianDurationMs === null ? 0 : Math.max(0, 10 - summary.medianDurationMs / 120_000));
}

function recipesForWorkflow(
  recipes: readonly GenerationRecipe[],
  workflow: WorkflowDefinition,
  projectId: string,
  modality: GenerationModality,
) {
  return recipes
    .filter((recipe) => !recipe.archivedAt
      && (recipe.projectId === projectId || recipe.projectId === null)
      && recipe.mediaKind === modality
      && recipe.workflowId === workflow.id
      && recipe.workflowRevisionId === workflow.currentRevision.id
      && recipe.sourceKinds.length === 1
      && recipe.sourceKinds[0] === "prompt")
    .sort((left, right) => recipeScore(right, projectId) - recipeScore(left, projectId)
      || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function overnightWorkflowCandidates(snapshot: StudioSnapshot, projectId: string, modality: GenerationModality) {
  return snapshot.workflows
    .filter((workflow) => isEligibleOvernightWorkflow(workflow, projectId, modality))
    .map((workflow) => {
      const recipe = recipesForWorkflow(snapshot.recipes, workflow, projectId, modality)[0] ?? null;
      const effectiveParameters = workflow.currentRevision.parameters.map((parameter) => ({
        ...parameter,
        value: recipe && Object.prototype.hasOwnProperty.call(recipe.parameters, parameter.id)
          ? recipe.parameters[parameter.id]
          : parameter.value,
      }));
      const promptProfile = modality === "video"
        ? videoWorkflowPromptProfile({ ...workflow, currentRevision: { ...workflow.currentRevision, parameters: effectiveParameters } }, "text-to-video")
        : modality === "music"
          ? musicWorkflowPromptProfile({ ...workflow, currentRevision: { ...workflow.currentRevision, parameters: effectiveParameters } })
          : null;
      const durationParameters = modality === "video" ? videoWorkflowDurationParameters(effectiveParameters) : [];
      const videoDuration = normalizeVideoDurationSeconds(durationParameters[0]?.value);
      const videoDurationSeconds = durationParameters.length > 0
        && videoDuration !== null
        && durationParameters.every((parameter) => Number(parameter.value) === videoDuration)
        ? videoDuration
        : null;
      const selection: OvernightWorkflowSelection = {
        modality,
        recipeId: recipe?.id ?? null,
        recipeUpdatedAt: recipe?.updatedAt ?? null,
        workflowId: workflow.id,
        workflowRevisionId: workflow.currentRevision.id,
        workflowName: workflow.name,
        workflowVersion: workflow.currentRevision.version,
        targetModel: recipe?.modelIdentifier
          ?? recipe?.promptProfile.targetModel
          ?? promptProfile?.targetModel
          ?? workflow.currentRevision.models.find((model) => model.trim())
          ?? null,
        promptProfileId: recipe
          ? `${recipe.promptProfile.id}/${recipe.promptProfile.version}`
          : promptProfile?.id ?? "creative-studio-image-direct-prompt/1.0",
        promptOutputFormat: promptProfile?.outputFormat ?? "natural-language",
        videoDurationSeconds,
        estimatedDurationMs: recipe?.evidenceSummary.medianDurationMs ?? null,
      };
      return { workflow, recipe, selection, score: recipe ? recipeScore(recipe, projectId) : 0 };
    })
    .filter(({ workflow, recipe, selection }) => (modality !== "image" || !assessImagePerformance(Object.fromEntries(
      workflow.currentRevision.parameters.map((parameter) => [parameter.id, recipe?.parameters[parameter.id] ?? parameter.value]),
    )).requiresExplicitCustom) && (modality !== "video" || selection.videoDurationSeconds !== null))
    .sort((left, right) => right.score - left.score
      || (right.recipe ? 1 : 0) - (left.recipe ? 1 : 0)
      || Date.parse(right.workflow.updatedAt) - Date.parse(left.workflow.updatedAt));
}

export function bestOvernightWorkflow(snapshot: StudioSnapshot, projectId: string, modality: GenerationModality) {
  return overnightWorkflowCandidates(snapshot, projectId, modality)[0] ?? null;
}

export function compactDuration(milliseconds: number | null) {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds <= 0) return "Speed learning";
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `~${hours}h ${remainder}m` : `~${hours}h`;
}

export function estimatedOvernightDuration(selections: readonly OvernightWorkflowSelection[], outputCount: number, storyCount = 1) {
  if (!selections.length) return null;
  const slots = overnightPlanSlots(selections.map((selection) => selection.modality), outputCount, storyCount);
  let total = 0;
  for (const slot of slots) {
    const duration = selections.find((selection) => selection.modality === slot.modality)?.estimatedDurationMs;
    if (duration === null || duration === undefined || !Number.isFinite(duration) || duration <= 0) return null;
    total += duration;
  }
  return Math.round(total);
}

export function overnightStatusLabel(status: OvernightSession["status"]) {
  const labels: Record<OvernightSession["status"], string> = {
    armed: "Armed",
    planning: "Writing stories",
    running: "Creating",
    paused: "Paused",
    completed: "Morning review",
    "needs-attention": "Needs attention",
    failed: "Stopped",
    cancelled: "Cancelled",
  };
  return labels[status];
}

export function overnightStatusDetail(session: OvernightSession) {
  if (session.progress.readyForReview > 0) {
    const remaining = session.progress.readyForReview;
    return `${remaining} ${remaining === 1 ? "result" : "results"} to review`;
  }
  if (session.status === "armed") return `Starts ${new Date(session.scheduledFor).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
  if (session.status === "planning") return "Local Gemma is building the story plan";
  if (session.status === "running") return `${session.progress.completed} of ${session.progress.planned || session.outputCount} finished`;
  if (session.status === "paused") return "Your place is saved";
  if (session.error === "overnight_failure_limit_reached") return "The failure limit stopped new work. Review the errors, then stop and re-plan.";
  if (session.error === "overnight_storage_limit_reached") return "The storage ceiling stopped new work. Keep the retained results, then stop and re-plan.";
  if (session.error === "overnight_window_ended" || session.error === "overnight_window_ended_before_start") return "The hard cutoff ended this run; retained results are still safe.";
  if (session.error) return session.error;
  return `${session.progress.completed} completed`;
}

export function newestOvernightSessions(sessions: readonly OvernightSession[], projectId: string) {
  return sessions
    .filter((session) => session.projectId === projectId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function latestAcceptance(acceptances: readonly Acceptance[], artifactId: string) {
  return acceptances
    .filter((acceptance) => acceptance.artifactId === artifactId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null;
}

export function bytesLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
