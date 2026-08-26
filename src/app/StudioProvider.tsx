/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { primaryWorkflowPromptParameter } from "../../shared/contracts";
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
  VideoGenerationVariant,
  VideoDurationSeconds,
  EvolutionJobContext,
  ReviewArtifactResponse,
  CreateModelTrainingJobRequest,
  ModelTrainingJob,
  ModelAdapterReviewDecision,
  ReviewModelTrainingDatasetRequest,
  ReviewModelAdapterResponse,
} from "../../shared/contracts";
import { createStudioAdapter, type StudioAdapter } from "../adapters";

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
  submitAfdfwJob: (modality: Exclude<GenerationModality, "video">, dnaArtifactId?: string) => Promise<void>;
  submitDevelopmentPreviewJob: (modality: Exclude<GenerationModality, "video">, dnaArtifactId?: string) => Promise<void>;
  submitWorkflowJob: (workflow: WorkflowDefinition, inputBindings: Record<string, string>, expectedPrompt: string, dnaArtifactId?: string, videoOperation?: VideoGenerationOperation, performanceMode?: ImagePerformanceMode, videoVariant?: VideoGenerationVariant, evolution?: EvolutionJobContext, videoDurationSeconds?: VideoDurationSeconds) => Promise<void>;
  retryJob: (jobId: string) => Promise<Job>;
  reuseJob: (jobId: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  reviewArtifact: (artifactId: string, decision: AcceptanceDecision, note: string) => Promise<ReviewArtifactResponse>;
  uploadMedia: (file: File, trainingEligible: boolean) => Promise<MediaAsset>;
  uploadWorkflow: (file: File, name?: string, description?: string) => Promise<WorkflowDefinition>;
  saveWorkflowRevision: (workflowId: string, baseRevisionId: string, values: Record<string, WorkflowScalar>) => Promise<WorkflowDefinition>;
  startDnaTraining: (input: Omit<CreateCreativeDnaTrainingJobRequest, "projectId" | "idempotencyKey">) => Promise<CreativeDnaTrainingJob>;
  cancelDnaTraining: (jobId: string) => Promise<void>;
  reviewDnaTraining: (jobId: string, decision: CreativeDnaTrainingReviewDecision, note: string) => Promise<void>;
  startModelTraining: (input: Omit<CreateModelTrainingJobRequest, "projectId" | "idempotencyKey">) => Promise<ModelTrainingJob>;
  cancelModelTraining: (jobId: string) => Promise<void>;
  reviewModelTrainingDataset: (jobId: string, input: ReviewModelTrainingDatasetRequest) => Promise<ModelTrainingJob>;
  reviewModelAdapter: (adapterId: string, decision: ModelAdapterReviewDecision, note: string) => Promise<ReviewModelAdapterResponse>;
  enrollLocalRunner: (name: string) => Promise<EnrollLocalRunnerResponse>;
  revokeLocalRunner: (runnerId: string) => Promise<LocalRunner>;
  refresh: () => Promise<void>;
};

const StudioContext = createContext<StudioContextValue | null>(null);

function message(error: unknown) {
  if (!(error instanceof Error)) return "Creative Studio request failed";
  if (error.message === "image_custom_mode_required") {
    return "This image setup exceeds the fast limits. Open Create and choose Custom · can be slow only when you want that longer render.";
  }
  if (error.message === "video_duration_not_supported_by_model") return "That model cannot create the selected length. Choose a shorter length or an available LTX model.";
  if (error.message === "video_duration_control_missing") return "This workflow does not expose a duration control. Update its model workflow before generating.";
  if (error.message === "video_duration_revision_mismatch") return "The saved workflow duration does not match your selected length. Choose the length again and retry.";
  if (error.message === "model_training_provider_unavailable") return "ACE-Step 1.5 training is not ready on the paired machine yet. Install its runtime and Base checkpoints, then restart the Local Runner.";
  if (error.message === "ace_step_requires_3_audio_files") return "Select at least three consented audio uploads before preparing the LoRA dataset.";
  if (error.message === "model_training_audio_consent_required") return "Every selected song must have CreativeDNA training consent enabled.";
  if (error.message === "ace_step_dataset_review_required") return "Review every caption and lyric field before starting LoRA training.";
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
    setSnapshot(next);
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

  const hasActiveWork = Boolean(snapshot?.jobs.some((job) => job.status === "queued" || job.status === "running")
    || snapshot?.trainingJobs.some((job) => job.status === "waiting-for-runner" || job.status === "running")
    || snapshot?.modelTrainingJobs.some((job) => job.status === "waiting-for-runner" || job.status === "running"));

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

  const submitWorkflowJob = useCallback(async (workflow: WorkflowDefinition, inputBindings: Record<string, string>, expectedPromptValue: string, dnaArtifactId?: string, videoOperation?: VideoGenerationOperation, performanceMode?: ImagePerformanceMode, videoVariant?: VideoGenerationVariant, evolution?: EvolutionJobContext, videoDurationSeconds?: VideoDurationSeconds) => {
    if (!activeProjectId) throw new Error("project_required");
    const dnaId = dnaArtifactId ?? activeDna?.artifactId;
    if (!dnaId) throw new Error("creative_dna_required");
    const modality: GenerationModality = workflow.modality === "audio" || workflow.modality === "music" ? "music" : workflow.modality === "video" ? "video" : "image";
    if (workflow.modality === "3d") throw new Error("workflow_modality_not_supported");
    const promptParameter = primaryWorkflowPromptParameter(workflow.currentRevision.parameters, workflow.modality);
    const workflowPrompt = String(promptParameter?.value ?? "").trim();
    const expectedPrompt = expectedPromptValue.trim();
    if (!workflowPrompt || !expectedPrompt) throw new Error("workflow_positive_prompt_missing");
    if (workflowPrompt !== expectedPrompt) throw new Error("workflow_prompt_confirmation_mismatch");
    await transact(() => adapter.submitJob({
      projectId: activeProjectId,
      dnaArtifactId: dnaId,
      modality,
      idempotencyKey: operationKey("workflow"),
      workflow: { workflowId: workflow.id, revisionId: workflow.currentRevision.id, inputBindings, expectedPrompt },
      performanceMode,
      videoDurationSeconds,
      videoVariant,
      videoOperation,
      evolution,
    }));
  }, [activeDna?.artifactId, activeProjectId, adapter, transact]);

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
    return transact(() => adapter.reviewArtifact(artifactId, decision, note));
  }, [adapter, transact]);

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
    submitAfdfwJob,
    submitDevelopmentPreviewJob,
    submitWorkflowJob,
    retryJob,
    reuseJob,
    cancelJob,
    reviewArtifact,
    uploadMedia,
    uploadWorkflow,
    saveWorkflowRevision,
    startDnaTraining,
    cancelDnaTraining,
    reviewDnaTraining,
    startModelTraining,
    cancelModelTraining,
    reviewModelTrainingDataset,
    reviewModelAdapter,
    enrollLocalRunner,
    revokeLocalRunner,
    refresh,
  }), [snapshot, loading, busy, error, activeProjectId, activeDna, selectProject, selectDna, createProject, updateProject, archiveProject, saveDna, submitAfdfwJob, submitDevelopmentPreviewJob, submitWorkflowJob, retryJob, reuseJob, cancelJob, reviewArtifact, uploadMedia, uploadWorkflow, saveWorkflowRevision, startDnaTraining, cancelDnaTraining, reviewDnaTraining, startModelTraining, cancelModelTraining, reviewModelTrainingDataset, reviewModelAdapter, enrollLocalRunner, revokeLocalRunner, refresh]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio must be used inside StudioProvider");
  return value;
}
