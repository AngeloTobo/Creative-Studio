/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AcceptanceDecision,
  CreateProjectRequest,
  CreateCreativeDnaRequest,
  CreativeDnaArtifact,
  GenerationModality,
  Project,
  StudioSnapshot,
  UpdateProjectRequest,
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
  submitJob: (modality: GenerationModality, dnaArtifactId?: string) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  reviewArtifact: (artifactId: string, decision: AcceptanceDecision, note?: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const StudioContext = createContext<StudioContextValue | null>(null);

function message(error: unknown) {
  return error instanceof Error ? error.message.replaceAll("_", " ") : "Creative Studio request failed";
}

function firstAvailableProject(snapshot: StudioSnapshot) {
  return snapshot.projects.find((project) => project.status !== "archived")?.id ?? "";
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
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeDna, setActiveDna] = useState<CreativeDnaArtifact | null>(null);

  const applySnapshot = useCallback((next: StudioSnapshot) => {
    setSnapshot(next);
    setActiveProjectId((currentProjectId) => {
      const projectId = next.projects.some((project) => project.id === currentProjectId && project.status !== "archived")
        ? currentProjectId
        : firstAvailableProject(next);
      setActiveDna((currentDna) => {
        if (currentDna?.projectId === projectId && next.dnaArtifacts.some((artifact) => artifact.artifactId === currentDna.artifactId)) return currentDna;
        return next.dnaArtifacts.find((artifact) => artifact.projectId === projectId) ?? null;
      });
      return projectId;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await adapter.refresh();
      applySnapshot(next);
      setError("");
    } catch (nextError) {
      setError(message(nextError));
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

  useEffect(() => {
    if (!snapshot?.jobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(timer);
  }, [refresh, snapshot?.jobs]);

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

  const submitJob = useCallback(async (modality: GenerationModality, dnaArtifactId?: string) => {
    if (!activeProjectId) throw new Error("project_required");
    const dnaId = dnaArtifactId ?? activeDna?.artifactId;
    if (!dnaId) throw new Error("creative_dna_required");
    await transact(() => adapter.submitJob({ projectId: activeProjectId, dnaArtifactId: dnaId, modality, idempotencyKey: operationKey("submit") }));
  }, [activeDna?.artifactId, activeProjectId, adapter, transact]);

  const retryJob = useCallback(async (jobId: string) => {
    await transact(() => adapter.retryJob(jobId, operationKey("retry")));
  }, [adapter, transact]);

  const cancelJob = useCallback(async (jobId: string) => {
    await transact(() => adapter.cancelJob(jobId));
  }, [adapter, transact]);

  const reviewArtifact = useCallback(async (artifactId: string, decision: AcceptanceDecision, note?: string) => {
    await transact(() => adapter.reviewArtifact(artifactId, decision, note));
  }, [adapter, transact]);

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
    setActiveDna(snapshot?.dnaArtifacts.find((artifact) => artifact.projectId === projectId) ?? null);
  }, [snapshot?.dnaArtifacts]);

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
    submitJob,
    retryJob,
    cancelJob,
    reviewArtifact,
    refresh,
  }), [snapshot, loading, busy, error, activeProjectId, activeDna, selectProject, selectDna, createProject, updateProject, archiveProject, saveDna, submitJob, retryJob, cancelJob, reviewArtifact, refresh]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio must be used inside StudioProvider");
  return value;
}
