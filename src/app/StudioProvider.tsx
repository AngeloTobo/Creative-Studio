/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AcceptanceDecision,
  CreateCreativeDnaRequest,
  CreativeDnaArtifact,
  GenerationModality,
  StudioSnapshot,
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
  saveDna: (input: Omit<CreateCreativeDnaRequest, "projectId">) => Promise<CreativeDnaArtifact>;
  submitJob: (modality: GenerationModality, dnaArtifactId?: string) => Promise<void>;
  reviewArtifact: (artifactId: string, decision: AcceptanceDecision, note?: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const StudioContext = createContext<StudioContextValue | null>(null);

function message(error: unknown) {
  return error instanceof Error ? error.message.replaceAll("_", " ") : "Creative Studio request failed";
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [adapter] = useState<StudioAdapter>(() => createStudioAdapter());
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeProjectId, setActiveProjectId] = useState("rebecca");
  const [activeDna, setActiveDna] = useState<CreativeDnaArtifact | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await adapter.refresh();
      setSnapshot(next);
      setError("");
    } catch (nextError) {
      setError(message(nextError));
    }
  }, [adapter]);

  useEffect(() => {
    let live = true;
    adapter.load()
      .then((next) => {
        if (!live) return;
        setSnapshot(next);
        setActiveProjectId((current) => next.projects.some((project) => project.id === current) ? current : next.projects[0]?.id ?? "");
        setActiveDna(next.dnaArtifacts[0] ?? null);
      })
      .catch((nextError) => live && setError(message(nextError)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [adapter]);

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
    const artifact = await adapter.saveCreativeDna({ ...input, projectId: activeProjectId });
    setActiveDna(artifact);
    return artifact;
  }), [activeProjectId, adapter, transact]);

  const submitJob = useCallback(async (modality: GenerationModality, dnaArtifactId?: string) => {
    const dnaId = dnaArtifactId ?? activeDna?.artifactId;
    if (!dnaId) throw new Error("creative_dna_required");
    await transact(() => adapter.submitJob({ projectId: activeProjectId, dnaArtifactId: dnaId, modality }));
  }, [activeDna?.artifactId, activeProjectId, adapter, transact]);

  const reviewArtifact = useCallback(async (artifactId: string, decision: AcceptanceDecision, note?: string) => {
    await transact(() => adapter.reviewArtifact(artifactId, decision, note));
  }, [adapter, transact]);

  const value = useMemo<StudioContextValue>(() => ({
    snapshot,
    loading,
    busy,
    error,
    activeProjectId,
    activeDna,
    setActiveProjectId,
    selectDna: setActiveDna,
    saveDna,
    submitJob,
    reviewArtifact,
    refresh,
  }), [snapshot, loading, busy, error, activeProjectId, activeDna, saveDna, submitJob, reviewArtifact, refresh]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio must be used inside StudioProvider");
  return value;
}
