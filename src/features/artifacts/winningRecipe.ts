import {
  generationRecipePromptProfileForSettingsStamp,
  generationRecipeSourceKindsForWorkflow,
  type Artifact,
  type CreateGenerationRecipeRequest,
  type GenerationRecipe,
  type GenerationRecipeSourceKind,
  type Job,
  type WorkflowDefinition,
} from "../../../shared/contracts";

function sameScalarRecord(left: Record<string, string | number | boolean>, right: Record<string, string | number | boolean>) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function sameSourceKinds(left: readonly GenerationRecipeSourceKind[], right: readonly GenerationRecipeSourceKind[]) {
  return [...left].sort().join("|") === [...right].sort().join("|");
}

function workflowMediaKind(workflow: WorkflowDefinition) {
  if (workflow.modality === "audio" || workflow.modality === "music") return "music";
  if (workflow.modality === "image" || workflow.modality === "video") return workflow.modality;
  return null;
}

function exactWorkflowForArtifact(artifact: Artifact, workflow?: WorkflowDefinition) {
  const stampedWorkflow = artifact.settingsStamp.workflow;
  return workflow
    && stampedWorkflow
    && workflow.id === stampedWorkflow.workflowId
    && workflow.currentRevision.id === stampedWorkflow.revisionId
    && workflowMediaKind(workflow) === artifact.kind
    ? workflow
    : null;
}

/** Builds only from the retained artifact stamp; workflow metadata supplies compatibility labels, never replacement values. */
export function winningRecipeForArtifact(artifact: Artifact, workflow: WorkflowDefinition): CreateGenerationRecipeRequest {
  const stamp = artifact.settingsStamp;
  const stampedWorkflow = stamp.workflow;
  const exactWorkflow = exactWorkflowForArtifact(artifact, workflow);
  if (!exactWorkflow) throw new Error("winning_recipe_workflow_metadata_unavailable");
  const promptProfile = generationRecipePromptProfileForSettingsStamp(stamp, artifact.kind);
  if (!promptProfile) throw new Error("winning_recipe_prompt_profile_unavailable");
  const sourceKinds = generationRecipeSourceKindsForWorkflow(exactWorkflow.currentRevision.parameters);
  const modelIdentifier = stamp.models[0] ?? null;
  const cleanName = artifact.name.replace(/\s+/g, " ").trim();
  return {
    name: `${cleanName || "Retained artifact"} - winning recipe`.slice(0, 100),
    description: `Master recipe promoted from retained artifact ${artifact.id}.`,
    projectId: artifact.projectId,
    worldId: null,
    mediaKind: artifact.kind,
    workflowId: stampedWorkflow?.workflowId ?? "",
    workflowRevisionId: stampedWorkflow?.revisionId ?? "",
    modelIdentifier,
    promptProfile,
    parameters: { ...stamp.parameters },
    sourceKinds,
    intentTier: "master",
  };
}

export function generationRecipeMatchesArtifact(recipe: GenerationRecipe, artifactRecipe: CreateGenerationRecipeRequest) {
  return !recipe.archivedAt
    && recipe.projectId === (artifactRecipe.projectId ?? null)
    && recipe.worldId === (artifactRecipe.worldId ?? null)
    && recipe.mediaKind === artifactRecipe.mediaKind
    && recipe.workflowId === artifactRecipe.workflowId
    && recipe.workflowRevisionId === artifactRecipe.workflowRevisionId
    && recipe.modelIdentifier === (artifactRecipe.modelIdentifier ?? null)
    && recipe.intentTier === artifactRecipe.intentTier
    && recipe.promptProfile.id === artifactRecipe.promptProfile.id
    && recipe.promptProfile.version === artifactRecipe.promptProfile.version
    && recipe.promptProfile.targetModel === artifactRecipe.promptProfile.targetModel
    && sameScalarRecord(recipe.parameters, artifactRecipe.parameters)
    && sameSourceKinds(recipe.sourceKinds, artifactRecipe.sourceKinds);
}

export function artifactCanSaveWinningRecipe(artifact: Artifact, job: Job | undefined, development: boolean, workflow?: WorkflowDefinition) {
  return !development
    && artifact.retention.state === "retained"
    && artifact.status !== "retaining"
    && artifact.settingsStamp.source === "comfyui-workflow"
    && artifact.settingsStamp.workflow?.format === "comfyui-api"
    && Boolean(exactWorkflowForArtifact(artifact, workflow))
    && Boolean(generationRecipePromptProfileForSettingsStamp(artifact.settingsStamp, artifact.kind))
    && job?.id === artifact.jobId
    && job.status === "completed";
}
