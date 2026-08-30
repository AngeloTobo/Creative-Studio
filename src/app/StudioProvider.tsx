/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { deriveEvolutionStudies, primaryWorkflowPromptParameter } from "../../shared/contracts";
import type {
  AcceptanceDecision,
  CreateProjectRequest,
  CreateCreativeDnaRequest,
  CreativeDnaArtifact,
  GenerationModality,
  Job,
  MediaAsset,
  Project,
  StudioSnapshot,
  UpdateProjectRequest,
  SaveWorkflowRevisionRequest,
  WorkflowDefinition,
  WorkflowScalar,
  CreateCreativeDnaTrainingJobRequest,
  CreativeDnaTrainingJob,
  CreativeDnaTrainingReviewDecision,
  EnrollLocalRunnerResponse,
  LocalRunner,
  VideoGenerationOperation,
  ImagePerformanceMode,
  VideoPerformanceMode,
  TrustedVideoPresetId,
  VideoGenerationVariant,
  VideoDurationSeconds,
  EvolutionJobContext,
  GenerationOutputBatch,
  GenerationPromptReferenceSelection,
  VideoSpeechStamp,
  ReviewArtifactResponse,
  CreateModelTrainingJobRequest,
  ModelTrainingJob,
  ModelAdapterReviewDecision,
  ReviewModelTrainingDatasetRequest,
  ReviewModelAdapterResponse,
  CreateGenerationRecipeRequest,
  UpdateGenerationRecipeRequest,
  GenerationRecipe,
  RecipeEvidenceResponse,
  ArtifactHistoryPage,
  ArtifactHistoryQuery,
  CanonReference,
  ContinuityRule,
  CreateCanonReferenceRequest,
  CreateContinuityRuleRequest,
  CreateWorldEntityRequest,
  CreateWorldRequest,
  GenerationContinuitySelection,
  PromoteArtifactToCanonRequest,
  PromoteArtifactToCanonResult,
  PromoteToCanonRequest,
  PromoteToCanonResult,
  UpdateCanonReferenceRequest,
  UpdateContinuityRuleRequest,
  UpdateWorldEntityRequest,
  UpdateWorldRequest,
  World,
  WorldEntity,
  CreateVideoPromptEnhancementRequest,
  VideoPromptEnhancement,
  CreateVideoScriptDraftRequest,
  UpdateVideoScriptDraftRequest,
  VideoScriptDraft,
  VideoScriptUse,
  CreateOvernightSessionRequest,
  OvernightSession,
  ConfigureLoveLoopRequest,
  LoveLoop,
  StoryBankRefresh,
  StoryRecommendationSelection,
  StoryThread,
  SubmitJobBatchResponse,
  SubmitJobRequest,
  UpdateStoryThreadRequest,
} from "../../shared/contracts";
import { createStudioAdapter, type StudioAdapter } from "../adapters";

type WithoutOwnerRequest<T> = T extends unknown ? Omit<T, "projectId" | "idempotencyKey"> : never;
type CreateVideoScriptDraftInput = WithoutOwnerRequest<CreateVideoScriptDraftRequest>;

type StudioContextValue = {
  snapshot: StudioSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string;
  activeProjectId: string;
  activeDna: CreativeDnaArtifact | null;
  setActiveProjectId: (id: string) => void;
  selectDna: (artifact: CreativeDnaArtifact | null) => void;
  createProject: (input: CreateProjectRequest) => Promise<Project>;
  updateProject: (projectId: string, input: UpdateProjectRequest) => Promise<Project>;
  archiveProject: (projectId: string) => Promise<Project>;
  saveDna: (input: Omit<CreateCreativeDnaRequest, "projectId">) => Promise<CreativeDnaArtifact>;
  enhanceVideoPrompt: (input: Omit<CreateVideoPromptEnhancementRequest, "projectId" | "idempotencyKey">) => Promise<VideoPromptEnhancement>;
  getVideoPromptEnhancement: (promptEnhancementId: string) => Promise<VideoPromptEnhancement>;
  createVideoScriptDraft: (input: CreateVideoScriptDraftInput) => Promise<VideoScriptDraft>;
  getVideoScriptDraft: (videoScriptDraftId: string) => Promise<VideoScriptDraft>;
  updateVideoScriptDraft: (videoScriptDraftId: string, input: UpdateVideoScriptDraftRequest) => Promise<VideoScriptDraft>;
  submitAfdfwJob: (modality: Exclude<GenerationModality, "video">, dnaArtifactId?: string) => Promise<void>;
  submitDevelopmentPreviewJob: (modality: Exclude<GenerationModality, "video">, dnaArtifactId?: string) => Promise<void>;
  submitWorkflowJob: (input: SubmitWorkflowJobInput) => Promise<Job>;
  submitWorkflowBatch: (input: SubmitWorkflowBatchInput) => Promise<SubmitJobBatchResponse>;
  retryJob: (jobId: string) => Promise<Job>;
  reuseJob: (jobId: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  reviewArtifact: (artifactId: string, decision: AcceptanceDecision, note: string) => Promise<ReviewArtifactResponse>;
  loadArtifactHistory: (query: ArtifactHistoryQuery) => Promise<ArtifactHistoryPage>;
  createWorld: (input: CreateWorldRequest) => Promise<World>;
  updateWorld: (worldId: string, input: UpdateWorldRequest) => Promise<World>;
  archiveWorld: (worldId: string, expectedVersion: number) => Promise<World>;
  createWorldEntity: (worldId: string, input: CreateWorldEntityRequest) => Promise<WorldEntity>;
  updateWorldEntity: (worldId: string, entityId: string, input: UpdateWorldEntityRequest) => Promise<WorldEntity>;
  createContinuityRule: (worldId: string, input: CreateContinuityRuleRequest) => Promise<ContinuityRule>;
  updateContinuityRule: (worldId: string, ruleId: string, input: UpdateContinuityRuleRequest) => Promise<ContinuityRule>;
  createCanonReference: (worldId: string, input: CreateCanonReferenceRequest) => Promise<CanonReference>;
  updateCanonReference: (worldId: string, referenceId: string, input: UpdateCanonReferenceRequest) => Promise<CanonReference>;
  promoteCanonReference: (worldId: string, referenceId: string, input: PromoteToCanonRequest) => Promise<PromoteToCanonResult>;
  promoteArtifactToCanon: (worldId: string, input: PromoteArtifactToCanonRequest) => Promise<PromoteArtifactToCanonResult>;
  uploadMedia: (file: File, trainingEligible: boolean) => Promise<MediaAsset>;
  uploadWorkflow: (file: File, name?: string, description?: string) => Promise<WorkflowDefinition>;
  saveWorkflowRevision: (workflowId: string, baseRevisionId: string, values: Record<string, WorkflowScalar>) => Promise<WorkflowDefinition>;
  createGenerationRecipe: (input: CreateGenerationRecipeRequest) => Promise<GenerationRecipe>;
  updateGenerationRecipe: (recipeId: string, input: UpdateGenerationRecipeRequest) => Promise<GenerationRecipe>;
  archiveGenerationRecipe: (recipeId: string) => Promise<GenerationRecipe>;
  recordGenerationRecipeEvidence: (recipeId: string, jobId: string) => Promise<RecipeEvidenceResponse>;
  startDnaTraining: (input: Omit<CreateCreativeDnaTrainingJobRequest, "projectId" | "idempotencyKey">) => Promise<CreativeDnaTrainingJob>;
  cancelDnaTraining: (jobId: string) => Promise<void>;
  reviewDnaTraining: (jobId: string, decision: CreativeDnaTrainingReviewDecision, note: string) => Promise<void>;
  startModelTraining: (input: Omit<CreateModelTrainingJobRequest, "projectId" | "idempotencyKey">) => Promise<ModelTrainingJob>;
  cancelModelTraining: (jobId: string) => Promise<void>;
  reviewModelTrainingDataset: (jobId: string, input: ReviewModelTrainingDatasetRequest) => Promise<ModelTrainingJob>;
  reviewModelAdapter: (adapterId: string, decision: ModelAdapterReviewDecision, note: string) => Promise<ReviewModelAdapterResponse>;
  enrollLocalRunner: (name: string) => Promise<EnrollLocalRunnerResponse>;
  revokeLocalRunner: (runnerId: string) => Promise<LocalRunner>;
  createOvernightSession: (input: Omit<CreateOvernightSessionRequest, "projectId" | "dnaArtifactId" | "idempotencyKey">) => Promise<OvernightSession>;
  pauseOvernightSession: (sessionId: string) => Promise<OvernightSession>;
  resumeOvernightSession: (sessionId: string) => Promise<OvernightSession>;
  cancelOvernightSession: (sessionId: string) => Promise<OvernightSession>;
  configureLoveLoop: (input: Omit<ConfigureLoveLoopRequest, "projectId" | "dnaArtifactId">) => Promise<LoveLoop>;
  pauseLoveLoop: () => Promise<LoveLoop>;
  resumeLoveLoop: () => Promise<LoveLoop>;
  disableLoveLoop: () => Promise<LoveLoop>;
  refreshStoryBank: () => Promise<StoryBankRefresh>;
  updateStoryThread: (storyId: string, input: UpdateStoryThreadRequest) => Promise<StoryThread>;
  refresh: () => Promise<void>;
};

export type SubmitWorkflowJobInput = {
  workflow: WorkflowDefinition;
  inputBindings: Record<string, string>;
  expectedPrompt: string;
  dnaArtifactId?: string;
  videoOperation?: VideoGenerationOperation;
  performanceMode?: ImagePerformanceMode;
  videoPerformanceMode?: VideoPerformanceMode;
  trustedVideoPresetId?: TrustedVideoPresetId;
  videoVariant?: VideoGenerationVariant;
  videoSpeech?: VideoSpeechStamp;
  evolution?: EvolutionJobContext;
  outputBatch?: GenerationOutputBatch;
  promptReference?: GenerationPromptReferenceSelection;
  videoDurationSeconds?: VideoDurationSeconds;
  idempotencyKey?: string;
  continuity?: GenerationContinuitySelection;
  promptEnhancement?: { requestId: string; basePrompt: string; appliedPrompt: string };
  videoScript?: VideoScriptUse;
  storyRecommendation?: StoryRecommendationSelection;
};

export type SubmitWorkflowBatchInput = {
  batchId: string;
  jobs: SubmitWorkflowJobInput[];
};

function workflowJobRequest(
  projectId: string,
  activeDnaArtifactId: string | undefined,
  input: SubmitWorkflowJobInput,
): SubmitJobRequest {
  const { workflow, inputBindings, expectedPrompt: expectedPromptValue, dnaArtifactId, videoOperation, performanceMode, videoPerformanceMode, trustedVideoPresetId, videoVariant, videoSpeech, evolution, outputBatch, promptReference, videoDurationSeconds, idempotencyKey: stableIdempotencyKey, continuity, promptEnhancement, videoScript, storyRecommendation } = input;
  const dnaId = dnaArtifactId ?? activeDnaArtifactId;
  if (!dnaId) throw new Error("creative_dna_required");
  const modality: GenerationModality = workflow.modality === "audio" || workflow.modality === "music" ? "music" : workflow.modality === "video" ? "video" : "image";
  if (workflow.modality === "3d") throw new Error("workflow_modality_not_supported");
  const promptParameter = primaryWorkflowPromptParameter(workflow.currentRevision.parameters, workflow.modality);
  const workflowPrompt = String(promptParameter?.value ?? "").trim();
  const expectedPrompt = expectedPromptValue.trim();
  if (!workflowPrompt || !expectedPrompt) throw new Error("workflow_positive_prompt_missing");
  if (workflowPrompt !== expectedPrompt) throw new Error("workflow_prompt_confirmation_mismatch");
  return {
    projectId,
    dnaArtifactId: dnaId,
    modality,
    idempotencyKey: stableIdempotencyKey?.trim() || operationKey("workflow"),
    workflow: { workflowId: workflow.id, revisionId: workflow.currentRevision.id, inputBindings, expectedPrompt },
    performanceMode,
    videoPerformanceMode,
    trustedVideoPresetId,
    videoDurationSeconds,
    videoVariant,
    videoSpeech,
    videoOperation,
    evolution,
    outputBatch,
    promptReference,
    continuity,
    promptEnhancement,
    videoScript,
    storyRecommendation,
  };
}

const StudioContext = createContext<StudioContextValue | null>(null);

function message(error: unknown) {
  if (!(error instanceof Error)) return "Creative Studio request failed";
  if (error.message === "invalid_video_generation_variant") {
    return "Creative Studio could not prepare this video batch. No render started; refresh Create and try again.";
  }
  if (error.message === "generation_batch_terminal") {
    return "The set stopped before every version could be queued. Completed versions remain retained. Open Work to see the failed version and correction guidance.";
  }
  if (error.message === "image_custom_mode_required") {
    return "This image setup exceeds the fast limits. Open Create and choose Custom · can be slow only when you want that longer render.";
  }
  if (error.message === "video_heavy_mode_required") {
    return "This video exceeds the fast limits. Review its duration, frame size, and frame count, then explicitly confirm the heavier render.";
  }
  if (error.message === "video_heavy_mode_not_required" || error.message === "video_performance_revision_mismatch") {
    return "The video workload changed after confirmation. Review the current settings and queue it again.";
  }
  if (error.message === "invalid_trusted_video_preset") return "That trusted video recipe is no longer recognized. Refresh Creative Studio before generating.";
  if (error.message === "trusted_video_preset_mode_required" || error.message === "trusted_video_preset_mismatch") {
    return "The measured 30-second recipe changed before it could be queued. Apply Trusted 30s again so every verified setting is restored.";
  }
  if (error.message === "video_duration_not_supported_by_model") return "That model cannot create the selected length. Choose a shorter length or an available LTX model.";
  if (error.message === "video_duration_control_missing") return "This workflow does not expose a duration control. Update its model workflow before generating.";
  if (error.message === "video_duration_revision_mismatch") return "The saved workflow duration does not match your selected length. Choose the length again and retry.";
  if (error.message === "video_speech_policy_required") return "Choose No dialogue, Simple line, or Exact script before generating video.";
  if (error.message === "video_speech_prompt_mismatch" || error.message === "invalid_video_speech_stamp") return "The saved speech control no longer matches the exact video prompt. Choose the speech setting again and retry.";
  if (error.message === "prompt_enhancement_requires_local_runner" || error.message === "prompt_enhancement_runner_unavailable") return "Start the Local Runner and ComfyUI to enhance this prompt with Gemma 4. Your prompt is unchanged.";
  if (error.message === "prompt_enhancement_source_too_short") return "Add a little more motion direction before asking Gemma to enhance it.";
  if (error.message === "video_script_builder_requires_local_runner" || error.message === "video_script_runner_unavailable") return "Start Local Runner 1.12 and ComfyUI to write a full scene with Gemma 4. Your direction is unchanged.";
  if (error.message === "video_script_context_mismatch") return "This full script was made for a different model, source, project, or video length. Write it again for the current setup.";
  if (error.message === "video_script_word_budget_exceeded" || error.message === "video_speech_too_long_for_duration") return "The spoken words are too long for this video length. Shorten them or choose a longer video.";
  if (error.message === "video_full_script_incomplete" || error.message === "video_full_script_word_budget_invalid") return "Gemma returned a partial scene instead of a complete duration-matched script. Try again; your direction is unchanged.";
  if (error.message === "video_script_unrequested_dialogue") return "Gemma added dialogue you did not request, so the draft was rejected. Try again or supply the exact line you want.";
  if (error.message === "video_script_combined_prompt_too_long") return "The motion direction and spoken script are too long together. Shorten one before generating.";
  if (error.message === "video_script_stage_direction_invalid") return "Use spoken words only. Remove speaker labels, brackets, and stage directions.";
  if (error.message === "video_script_version_conflict") return "This script changed in another view. Review the latest draft and try again.";
  if (error.message === "model_training_provider_unavailable") return "ACE-Step 1.5 training is not ready on the paired machine yet. Install its runtime and Base checkpoints, then restart the Local Runner.";
  if (error.message === "ace_step_requires_3_audio_files") return "Select at least three consented audio uploads before preparing the LoRA dataset.";
  if (error.message === "model_training_audio_consent_required") return "Every selected song must have CreativeDNA training consent enabled.";
  if (error.message === "ace_step_dataset_review_required") return "Review every caption and lyric field before starting LoRA training.";
  if (/^(world|world_entity|continuity_rule|canon_reference)_version_conflict$/.test(error.message)) return "This continuity record changed in another view. Refresh, review the current version, and try again.";
  if (error.message === "workflow_continuity_prompt_mismatch") return "The saved model prompt no longer ends with the selected World continuity. Review the direction and generate again.";
  if (error.message === "continuity_directive_empty") return "Add a world premise, element detail, rule, or reviewed canon note before using continuity.";
  if (error.message === "continuity_directive_too_large") return "This World continuity is too large to apply exactly. Select fewer elements, then generate again.";
  if (error.message === "continuity_commercial_identity_in_prompt") return "Remove the named commercial source from the prompt. Only its reviewed abstract traits can be sent to the model.";
  if (error.message === "continuity_rule_modality_mismatch") return "One selected continuity rule does not apply to this media type. Refresh the World selection and try again.";
  if (error.message === "canon_promotion_prerequisite_changed") return "The World, element, project, or artifact review changed before canon could be saved. Review the current state and confirm again.";
  if (error.message === "canon_promotion_facet_guidance_required") return "Add reusable guidance for every facet you want to make canon.";
  if (error.message === "artifact_already_canonical") return "This retained result is already canon for that World element.";
  if (error.message.startsWith("ace_step_gpu_busy_free_")) {
    const freeMiB = Number(error.message.match(/^ace_step_gpu_busy_free_(\d+)_mib$/)?.[1] ?? 0);
    const freeGiB = freeMiB > 0 ? `${Math.round(freeMiB / 1024)} GB` : "too little memory";
    return `The RTX 3090 is still busy (${freeGiB} free). Stop or unload other GPU work, then retry ACE-Step training.`;
  }
  if (error.message.startsWith("ace_step_gpu_vram_unsupported_")) {
    const totalMiB = Number(error.message.match(/^ace_step_gpu_vram_unsupported_(\d+)_mib$/)?.[1] ?? 0);
    const totalGiB = totalMiB > 0 ? `${Math.round(totalMiB / 1024)} GB` : "less than 20 GB";
    return `ACE-Step LoRA training needs a larger GPU (${totalGiB} detected; 20 GB minimum).`;
  }
  if (error.message === "ace_step_runtime_missing") return "The official ACE-Step 1.5 runtime or Base checkpoints are missing. Run the local setup script, then restart the Local Runner.";
  if (error.message === "overnight_studio_requires_creative_studio_worker") return "Overnight Studio needs the real Creative Studio Worker and Local Runner. Development previews cannot create overnight work.";
  if (error.message === "overnight_session_already_active") return "This project already has an active overnight run. Open it to pause, continue, or stop it first.";
  if (error.message === "overnight_source_free_workflow_required") return "Overnight Studio needs a prompt-only workflow for each selected media type.";
  if (error.message === "overnight_image_fast_workflow_required") return "The selected image workflow is outside the fast overnight limits. Save a proven fast image recipe first.";
  if (error.message === "overnight_window_ended") return "That overnight window has ended. Create a new run with a later stop time.";
  if (error.message === "overnight_workflow_selection_required" || error.message === "overnight_recipe_mismatch") return "Choose an available proven workflow for every selected media type.";
  if (error.message === "love_loop_requires_creative_studio_worker") return "The Angelo love ritual needs the real Creative Studio Worker and Local Runner. Development previews cannot schedule real work.";
  if (error.message === "love_loop_workflows_required" || error.message === "love_loop_prompt_only_workflow_required") return "Love Loop needs one prompt-only image workflow and one prompt-only video workflow.";
  if (error.message === "love_loop_fast_image_required") return "Love Loop needs a fast image workflow at or below the proven image limits.";
  if (error.message === "love_loop_fast_video_required") return "Love Loop needs a fast five-second text-to-video workflow at or below 0.20 MP.";
  if (error.message === "love_loop_recipe_mismatch" || error.message === "love_loop_recipe_changed" || error.message === "love_loop_workflow_changed") return "A Love Loop workflow or recipe changed. Use Repair & resume to bind the current fast model.";
  if (error.message === "love_loop_failure_limit_reached") return "Three recent Love Loop renders failed. Inspect their errors, then use Repair & resume.";
  return error.message.replaceAll("_", " ");
}

function firstAvailableProject(snapshot: StudioSnapshot) {
  return snapshot.projects.find((project) => project.status !== "archived")?.id ?? "";
}

export function creativeDnaReviewDecision(snapshot: StudioSnapshot, artifact: CreativeDnaArtifact) {
  if (!artifact.training) return null;
  return snapshot.trainingReviews.find((review) => review.dnaArtifactId === artifact.artifactId)?.decision ?? "pending";
}

export function creativeDnaCanGenerate(snapshot: StudioSnapshot, artifact: CreativeDnaArtifact) {
  return !artifact.training || creativeDnaReviewDecision(snapshot, artifact) === "approved";
}

function preferredProjectDna(snapshot: StudioSnapshot, projectId: string) {
  const project = snapshot.projects.find((item) => item.id === projectId);
  const projectDna = snapshot.dnaArtifacts.filter((artifact) => artifact.projectId === projectId);
  const activated = project?.activeDnaArtifactId
    ? projectDna.find((artifact) => artifact.artifactId === project.activeDnaArtifactId && creativeDnaCanGenerate(snapshot, artifact))
    : null;
  return activated ?? projectDna.find((artifact) => creativeDnaCanGenerate(snapshot, artifact)) ?? null;
}

function operationKey(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function mergeById<T extends { id: string }>(older: readonly T[], newer: readonly T[]) {
  const records = new Map(older.map((item) => [item.id, item]));
  for (const item of newer) records.set(item.id, item);
  return [...records.values()];
}

function mergeSnapshotHistory(current: StudioSnapshot | null, next: StudioSnapshot) {
  if (!current) return next;
  const jobs = mergeById(current.jobs, next.jobs).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const artifacts = mergeById(current.artifacts, next.artifacts).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const acceptances = mergeById(current.acceptances, next.acceptances).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const trainingExamples = mergeById(current.trainingExamples, next.trainingExamples).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const promptEnhancements = mergeById(current.promptEnhancements, next.promptEnhancements)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const videoScriptDrafts = mergeById(current.videoScriptDrafts ?? [], next.videoScriptDrafts ?? [])
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  return { ...next, jobs, artifacts, acceptances, trainingExamples, promptEnhancements, videoScriptDrafts, evolutionStudies: deriveEvolutionStudies(jobs, artifacts) };
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [adapter] = useState<StudioAdapter>(() => createStudioAdapter());
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshFailures, setRefreshFailures] = useState(0);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeDna, setActiveDna] = useState<CreativeDnaArtifact | null>(null);

  const applySnapshot = useCallback((next: StudioSnapshot) => {
    setSnapshot((current) => mergeSnapshotHistory(current, next));
    setActiveProjectId((currentProjectId) => {
      const projectId = next.projects.some((project) => project.id === currentProjectId && project.status !== "archived")
        ? currentProjectId
        : firstAvailableProject(next);
      setActiveDna((currentDna) => {
        const current = currentDna?.projectId === projectId
          ? next.dnaArtifacts.find((artifact) => artifact.artifactId === currentDna.artifactId)
          : null;
        if (current) return current;
        return preferredProjectDna(next, projectId);
      });
      return projectId;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await adapter.refresh();
      applySnapshot(next);
      setError("");
      setRefreshFailures(0);
    } catch (nextError) {
      setError(message(nextError));
      setRefreshFailures((current) => Math.min(current + 1, 4));
    }
  }, [adapter, applySnapshot]);

  useEffect(() => {
    let live = true;
    adapter.load()
      .then((next) => {
        if (!live) return;
        applySnapshot(next);
      })
      .catch((nextError) => live && setError(message(nextError)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [adapter, applySnapshot]);

  const hasActiveWork = Boolean((snapshot?.jobs ?? []).some((job) => job.status === "queued" || job.status === "running")
    || (snapshot?.generationBatches ?? []).some((batch) => batch.status === "waiting" || batch.status === "running")
    || (snapshot?.trainingJobs ?? []).some((job) => job.status === "waiting-for-runner" || job.status === "running")
    || (snapshot?.modelTrainingJobs ?? []).some((job) => job.status === "waiting-for-runner" || job.status === "running")
    || (snapshot?.overnightSessions ?? []).some((session) => ["armed", "planning", "running"].includes(session.status)));

  useEffect(() => {
    if (!hasActiveWork) return;
    let timer = 0;
    let disposed = false;
    const interval = Math.min(5 * 60_000, adapter.activePollIntervalMs * (2 ** refreshFailures));
    const schedule = () => {
      if (disposed || document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => void poll(), interval);
    };
    const poll = async () => {
      if (disposed) return;
      if (document.visibilityState === "visible") await refresh();
      schedule();
    };
    const visibility = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") timer = window.setTimeout(() => void poll(), 0);
    };
    document.addEventListener("visibilitychange", visibility);
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [adapter.activePollIntervalMs, hasActiveWork, refresh, refreshFailures]);

  const transact = useCallback(async <T,>(action: () => Promise<T>) => {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      await refresh();
      return result;
    } catch (nextError) {
      setError(message(nextError));
      throw nextError;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const saveDna = useCallback((input: Omit<CreateCreativeDnaRequest, "projectId">) => transact(async () => {
    if (!activeProjectId) throw new Error("project_required");
    const artifact = await adapter.saveCreativeDna({ ...input, projectId: activeProjectId });
    setActiveDna(artifact);
    return artifact;
  }), [activeProjectId, adapter, transact]);

  const submitProviderJob = useCallback(async (provider: "afdfw" | "development-preview", modality: Exclude<GenerationModality, "video">, dnaArtifactId?: string) => {
    if (!activeProjectId) throw new Error("project_required");
    const dnaId = dnaArtifactId ?? activeDna?.artifactId;
    if (!dnaId) throw new Error("creative_dna_required");
    await transact(() => adapter.submitJob({ projectId: activeProjectId, dnaArtifactId: dnaId, modality, provider, idempotencyKey: operationKey(provider) }));
  }, [activeDna?.artifactId, activeProjectId, adapter, transact]);

  const submitAfdfwJob = useCallback((modality: Exclude<GenerationModality, "video">, dnaArtifactId?: string) => (
    submitProviderJob("afdfw", modality, dnaArtifactId)
  ), [submitProviderJob]);

  const submitDevelopmentPreviewJob = useCallback((modality: Exclude<GenerationModality, "video">, dnaArtifactId?: string) => (
    submitProviderJob("development-preview", modality, dnaArtifactId)
  ), [submitProviderJob]);

  const enhanceVideoPrompt = useCallback((input: Omit<CreateVideoPromptEnhancementRequest, "projectId" | "idempotencyKey">) => {
    if (!activeProjectId) throw new Error("project_required");
    return transact(() => adapter.createVideoPromptEnhancement({
      ...input,
      projectId: activeProjectId,
      idempotencyKey: operationKey("video_prompt_enhance"),
    }));
  }, [activeProjectId, adapter, transact]);

  const getVideoPromptEnhancement = useCallback(async (promptEnhancementId: string) => {
    try {
      const promptEnhancement = await adapter.getVideoPromptEnhancement(promptEnhancementId);
      setSnapshot((current) => current ? {
        ...current,
        promptEnhancements: mergeById(current.promptEnhancements, [promptEnhancement])
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)),
      } : current);
      setError("");
      return promptEnhancement;
    } catch (nextError) {
      setError(message(nextError));
      throw nextError;
    }
  }, [adapter]);

  const mergeVideoScriptDraft = useCallback((videoScriptDraft: VideoScriptDraft) => {
    setSnapshot((current) => current ? {
      ...current,
      videoScriptDrafts: mergeById(current.videoScriptDrafts ?? [], [videoScriptDraft])
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)),
    } : current);
  }, []);

  const createVideoScriptDraft = useCallback(async (input: CreateVideoScriptDraftInput) => {
    if (!activeProjectId) throw new Error("project_required");
    setBusy(true);
    setError("");
    try {
      const videoScriptDraft = await adapter.createVideoScriptDraft({
        ...input,
        projectId: activeProjectId,
        idempotencyKey: operationKey("video_script"),
      });
      mergeVideoScriptDraft(videoScriptDraft);
      return videoScriptDraft;
    } catch (nextError) {
      setError(message(nextError));
      throw nextError;
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, adapter, mergeVideoScriptDraft]);

  const getVideoScriptDraft = useCallback(async (videoScriptDraftId: string) => {
    try {
      const videoScriptDraft = await adapter.getVideoScriptDraft(videoScriptDraftId);
      mergeVideoScriptDraft(videoScriptDraft);
      setError("");
      return videoScriptDraft;
    } catch (nextError) {
      setError(message(nextError));
      throw nextError;
    }
  }, [adapter, mergeVideoScriptDraft]);

  const updateVideoScriptDraft = useCallback(async (videoScriptDraftId: string, input: UpdateVideoScriptDraftRequest) => {
    setBusy(true);
    setError("");
    try {
      const videoScriptDraft = await adapter.updateVideoScriptDraft(videoScriptDraftId, input);
      mergeVideoScriptDraft(videoScriptDraft);
      return videoScriptDraft;
    } catch (nextError) {
      setError(message(nextError));
      throw nextError;
    } finally {
      setBusy(false);
    }
  }, [adapter, mergeVideoScriptDraft]);

  const submitWorkflowJob = useCallback(async (input: SubmitWorkflowJobInput) => {
    if (!activeProjectId) throw new Error("project_required");
    return transact(() => adapter.submitJob(workflowJobRequest(activeProjectId, activeDna?.artifactId, input)));
  }, [activeDna?.artifactId, activeProjectId, adapter, transact]);

  const submitWorkflowBatch = useCallback(async (input: SubmitWorkflowBatchInput) => {
    if (!activeProjectId) throw new Error("project_required");
    const batchId = input.batchId.trim();
    if (!batchId || !input.jobs.length) throw new Error("invalid_generation_batch");
    const jobs = input.jobs.map((job) => workflowJobRequest(activeProjectId, activeDna?.artifactId, job));
    try {
      return await transact(() => adapter.submitJobBatch({
        schemaVersion: "creative-studio-job-batch/1.0",
        batchId,
        jobs,
      }));
    } catch (error) {
      await refresh();
      setError(message(error));
      throw error;
    }
  }, [activeDna?.artifactId, activeProjectId, adapter, refresh, transact]);

  const retryJob = useCallback((jobId: string) => (
    transact(() => adapter.retryJob(jobId, operationKey("retry")))
  ), [adapter, transact]);

  const reuseJob = useCallback(async (jobId: string) => {
    await transact(() => adapter.reuseJob(jobId, operationKey("reuse")));
  }, [adapter, transact]);

  const cancelJob = useCallback(async (jobId: string) => {
    await transact(() => adapter.cancelJob(jobId));
  }, [adapter, transact]);

  const reviewArtifact = useCallback(async (artifactId: string, decision: AcceptanceDecision, note: string) => {
    const result = await transact(() => adapter.reviewArtifact(artifactId, decision, note));
    setSnapshot((current) => {
      if (!current) return current;
      const artifacts = mergeById(current.artifacts, [result.artifact])
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
      const acceptances = mergeById(current.acceptances, [result.acceptance])
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
      const trainingExamples = current.trainingExamples.map((example) => example.artifactId === artifactId && decision !== "archived"
        ? { ...example, status: decision === "accepted" ? "training-ready" as const : "excluded" as const, updatedAt: result.acceptance.createdAt }
        : example);
      return { ...current, artifacts, acceptances, trainingExamples, evolutionStudies: deriveEvolutionStudies(current.jobs, artifacts) };
    });
    return result;
  }, [adapter, transact]);

  const loadArtifactHistory = useCallback(async (query: ArtifactHistoryQuery) => {
    setError("");
    try {
      const page = await adapter.listArtifactHistory({
        ...query,
        projectId: query.projectId === undefined ? activeProjectId || null : query.projectId,
      });
      setSnapshot((current) => {
        if (!current) return current;
        const jobs = mergeById(current.jobs, page.jobs)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
        const artifacts = mergeById(current.artifacts, page.artifacts)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
        const acceptances = mergeById(current.acceptances, page.acceptances)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
        const trainingExamples = mergeById(current.trainingExamples, page.trainingExamples)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
        return { ...current, jobs, artifacts, acceptances, trainingExamples, evolutionStudies: deriveEvolutionStudies(jobs, artifacts) };
      });
      return page;
    } catch (nextError) {
      setError(message(nextError));
      throw nextError;
    }
  }, [activeProjectId, adapter]);

  const createWorld = useCallback((input: CreateWorldRequest) => transact(() => adapter.createWorld(input)), [adapter, transact]);
  const updateWorld = useCallback((worldId: string, input: UpdateWorldRequest) => (
    transact(() => adapter.updateWorld(worldId, input))
  ), [adapter, transact]);
  const archiveWorld = useCallback((worldId: string, expectedVersion: number) => (
    transact(() => adapter.archiveWorld(worldId, expectedVersion))
  ), [adapter, transact]);
  const createWorldEntity = useCallback((worldId: string, input: CreateWorldEntityRequest) => (
    transact(() => adapter.createWorldEntity(worldId, input))
  ), [adapter, transact]);
  const updateWorldEntity = useCallback((worldId: string, entityId: string, input: UpdateWorldEntityRequest) => (
    transact(() => adapter.updateWorldEntity(worldId, entityId, input))
  ), [adapter, transact]);
  const createContinuityRule = useCallback((worldId: string, input: CreateContinuityRuleRequest) => (
    transact(() => adapter.createContinuityRule(worldId, input))
  ), [adapter, transact]);
  const updateContinuityRule = useCallback((worldId: string, ruleId: string, input: UpdateContinuityRuleRequest) => (
    transact(() => adapter.updateContinuityRule(worldId, ruleId, input))
  ), [adapter, transact]);
  const createCanonReference = useCallback((worldId: string, input: CreateCanonReferenceRequest) => (
    transact(() => adapter.createCanonReference(worldId, input))
  ), [adapter, transact]);
  const updateCanonReference = useCallback((worldId: string, referenceId: string, input: UpdateCanonReferenceRequest) => (
    transact(() => adapter.updateCanonReference(worldId, referenceId, input))
  ), [adapter, transact]);
  const promoteCanonReference = useCallback((worldId: string, referenceId: string, input: PromoteToCanonRequest) => (
    transact(() => adapter.promoteCanonReference(worldId, referenceId, input))
  ), [adapter, transact]);
  const promoteArtifactToCanon = useCallback((worldId: string, input: PromoteArtifactToCanonRequest) => (
    transact(() => adapter.promoteArtifactToCanon(worldId, input))
  ), [adapter, transact]);

  const uploadMedia = useCallback(async (file: File, trainingEligible: boolean) => {
    if (!activeProjectId) throw new Error("project_required");
    return transact(() => adapter.uploadMedia(activeProjectId, file, trainingEligible));
  }, [activeProjectId, adapter, transact]);

  const uploadWorkflow = useCallback(async (file: File, name = "", description = "") => {
    if (!activeProjectId) throw new Error("project_required");
    return transact(() => adapter.uploadWorkflow(activeProjectId, file, name, description));
  }, [activeProjectId, adapter, transact]);

  const saveWorkflowRevision = useCallback(async (workflowId: string, baseRevisionId: string, values: Record<string, WorkflowScalar>) => {
    const input: SaveWorkflowRevisionRequest = { baseRevisionId, values };
    return transact(() => adapter.saveWorkflowRevision(workflowId, input));
  }, [adapter, transact]);

  const createGenerationRecipe = useCallback((input: CreateGenerationRecipeRequest) => (
    transact(() => adapter.createGenerationRecipe(input))
  ), [adapter, transact]);

  const updateGenerationRecipe = useCallback((recipeId: string, input: UpdateGenerationRecipeRequest) => (
    transact(() => adapter.updateGenerationRecipe(recipeId, input))
  ), [adapter, transact]);

  const archiveGenerationRecipe = useCallback((recipeId: string) => (
    transact(() => adapter.deleteGenerationRecipe(recipeId))
  ), [adapter, transact]);

  const recordGenerationRecipeEvidence = useCallback((recipeId: string, jobId: string) => (
    transact(() => adapter.recordGenerationRecipeEvidence(recipeId, jobId))
  ), [adapter, transact]);

  const startDnaTraining = useCallback((input: Omit<CreateCreativeDnaTrainingJobRequest, "projectId" | "idempotencyKey">) => {
    if (!activeProjectId) throw new Error("project_required");
    return transact(() => adapter.startCreativeDnaTraining({
      ...input,
      projectId: activeProjectId,
      idempotencyKey: operationKey("train"),
    }));
  }, [activeProjectId, adapter, transact]);

  const cancelDnaTraining = useCallback(async (jobId: string) => {
    await transact(() => adapter.cancelCreativeDnaTraining(jobId));
  }, [adapter, transact]);

  const reviewDnaTraining = useCallback(async (jobId: string, decision: CreativeDnaTrainingReviewDecision, note: string) => {
    const result = await transact(() => adapter.reviewCreativeDnaTraining(jobId, decision, note));
    if (decision === "approved") {
      setActiveDna(result.artifact);
    } else {
      setActiveDna((current) => current?.artifactId === result.artifact.artifactId
        ? snapshot?.dnaArtifacts.find((artifact) => artifact.artifactId === result.trainingJob.baseDnaArtifactId) ?? null
        : current);
    }
  }, [adapter, snapshot?.dnaArtifacts, transact]);

  const startModelTraining = useCallback((input: Omit<CreateModelTrainingJobRequest, "projectId" | "idempotencyKey">) => {
    if (!activeProjectId) throw new Error("project_required");
    return transact(() => adapter.startModelTraining({
      ...input,
      projectId: activeProjectId,
      idempotencyKey: operationKey("ace_train"),
    }));
  }, [activeProjectId, adapter, transact]);

  const cancelModelTraining = useCallback(async (jobId: string) => {
    await transact(() => adapter.cancelModelTraining(jobId));
  }, [adapter, transact]);

  const reviewModelTrainingDataset = useCallback((jobId: string, input: ReviewModelTrainingDatasetRequest) => (
    transact(() => adapter.reviewModelTrainingDataset(jobId, input))
  ), [adapter, transact]);

  const reviewModelAdapter = useCallback((adapterId: string, decision: ModelAdapterReviewDecision, note: string) => (
    transact(() => adapter.reviewModelAdapter(adapterId, decision, note))
  ), [adapter, transact]);

  const enrollLocalRunner = useCallback((name: string) => transact(() => adapter.enrollLocalRunner(name)), [adapter, transact]);
  const revokeLocalRunner = useCallback((runnerId: string) => transact(() => adapter.revokeLocalRunner(runnerId)), [adapter, transact]);
  const activeDnaArtifactId = activeDna?.artifactId ?? "";

  const createOvernightSession = useCallback((input: Omit<CreateOvernightSessionRequest, "projectId" | "dnaArtifactId" | "idempotencyKey">) => {
    if (!activeProjectId) throw new Error("project_required");
    if (!activeDnaArtifactId) throw new Error("creative_dna_required");
    return transact(() => adapter.createOvernightSession({
      ...input,
      projectId: activeProjectId,
      dnaArtifactId: activeDnaArtifactId,
      idempotencyKey: operationKey("overnight"),
    }));
  }, [activeDnaArtifactId, activeProjectId, adapter, transact]);

  const pauseOvernightSession = useCallback((sessionId: string) => (
    transact(() => adapter.pauseOvernightSession(sessionId))
  ), [adapter, transact]);

  const resumeOvernightSession = useCallback((sessionId: string) => (
    transact(() => adapter.resumeOvernightSession(sessionId))
  ), [adapter, transact]);

  const cancelOvernightSession = useCallback((sessionId: string) => (
    transact(() => adapter.cancelOvernightSession(sessionId))
  ), [adapter, transact]);

  const configureLoveLoop = useCallback((input: Omit<ConfigureLoveLoopRequest, "projectId" | "dnaArtifactId">) => {
    if (!activeProjectId) throw new Error("project_required");
    if (!activeDnaArtifactId) throw new Error("creative_dna_required");
    return transact(() => adapter.configureLoveLoop({ ...input, projectId: activeProjectId, dnaArtifactId: activeDnaArtifactId }));
  }, [activeDnaArtifactId, activeProjectId, adapter, transact]);

  const pauseLoveLoop = useCallback(() => transact(() => adapter.pauseLoveLoop()), [adapter, transact]);
  const resumeLoveLoop = useCallback(() => transact(() => adapter.resumeLoveLoop()), [adapter, transact]);
  const disableLoveLoop = useCallback(() => transact(() => adapter.disableLoveLoop()), [adapter, transact]);

  const refreshStoryBank = useCallback(() => {
    if (!activeProjectId) throw new Error("project_required");
    return transact(() => adapter.refreshStoryBank({ projectId: activeProjectId, idempotencyKey: operationKey("story") }));
  }, [activeProjectId, adapter, transact]);

  const updateStoryThread = useCallback((storyId: string, input: UpdateStoryThreadRequest) => (
    transact(() => adapter.updateStoryThread(storyId, input))
  ), [adapter, transact]);

  const createProject = useCallback(async (input: CreateProjectRequest) => {
    const project = await transact(() => adapter.createProject(input));
    setActiveProjectId(project.id);
    setActiveDna(null);
    return project;
  }, [adapter, transact]);

  const updateProject = useCallback((projectId: string, input: UpdateProjectRequest) => (
    transact(() => adapter.updateProject(projectId, input))
  ), [adapter, transact]);

  const archiveProject = useCallback((projectId: string) => (
    transact(() => adapter.archiveProject(projectId))
  ), [adapter, transact]);

  const selectProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setActiveDna(snapshot ? preferredProjectDna(snapshot, projectId) : null);
  }, [snapshot]);

  const selectDna = useCallback((artifact: CreativeDnaArtifact | null) => {
    setActiveDna(artifact);
    if (artifact) setActiveProjectId(artifact.projectId);
  }, []);

  const value = useMemo<StudioContextValue>(() => ({
    snapshot,
    loading,
    busy,
    error,
    activeProjectId,
    activeDna,
    setActiveProjectId: selectProject,
    selectDna,
    createProject,
    updateProject,
    archiveProject,
    saveDna,
    enhanceVideoPrompt,
    getVideoPromptEnhancement,
    createVideoScriptDraft,
    getVideoScriptDraft,
    updateVideoScriptDraft,
    submitAfdfwJob,
    submitDevelopmentPreviewJob,
    submitWorkflowJob,
    submitWorkflowBatch,
    retryJob,
    reuseJob,
    cancelJob,
    reviewArtifact,
    loadArtifactHistory,
    createWorld,
    updateWorld,
    archiveWorld,
    createWorldEntity,
    updateWorldEntity,
    createContinuityRule,
    updateContinuityRule,
    createCanonReference,
    updateCanonReference,
    promoteCanonReference,
    promoteArtifactToCanon,
    uploadMedia,
    uploadWorkflow,
    saveWorkflowRevision,
    createGenerationRecipe,
    updateGenerationRecipe,
    archiveGenerationRecipe,
    recordGenerationRecipeEvidence,
    startDnaTraining,
    cancelDnaTraining,
    reviewDnaTraining,
    startModelTraining,
    cancelModelTraining,
    reviewModelTrainingDataset,
    reviewModelAdapter,
    enrollLocalRunner,
    revokeLocalRunner,
    createOvernightSession,
    pauseOvernightSession,
    resumeOvernightSession,
    cancelOvernightSession,
    configureLoveLoop,
    pauseLoveLoop,
    resumeLoveLoop,
    disableLoveLoop,
    refreshStoryBank,
    updateStoryThread,
    refresh,
  }), [snapshot, loading, busy, error, activeProjectId, activeDna, selectProject, selectDna, createProject, updateProject, archiveProject, saveDna, enhanceVideoPrompt, getVideoPromptEnhancement, createVideoScriptDraft, getVideoScriptDraft, updateVideoScriptDraft, submitAfdfwJob, submitDevelopmentPreviewJob, submitWorkflowJob, submitWorkflowBatch, retryJob, reuseJob, cancelJob, reviewArtifact, loadArtifactHistory, createWorld, updateWorld, archiveWorld, createWorldEntity, updateWorldEntity, createContinuityRule, updateContinuityRule, createCanonReference, updateCanonReference, promoteCanonReference, promoteArtifactToCanon, uploadMedia, uploadWorkflow, saveWorkflowRevision, createGenerationRecipe, updateGenerationRecipe, archiveGenerationRecipe, recordGenerationRecipeEvidence, startDnaTraining, cancelDnaTraining, reviewDnaTraining, startModelTraining, cancelModelTraining, reviewModelTrainingDataset, reviewModelAdapter, enrollLocalRunner, revokeLocalRunner, createOvernightSession, pauseOvernightSession, resumeOvernightSession, cancelOvernightSession, configureLoveLoop, pauseLoveLoop, resumeLoveLoop, disableLoveLoop, refreshStoryBank, updateStoryThread, refresh]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio must be used inside StudioProvider");
  return value;
}
