import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CREATIVE_SESSION_STORAGE_KEY,
  clearCreativeSession,
  clearCreativeSessions,
  listCreativeSessions,
  saveCreativeSession,
  type CreativeSessionStoreOptions,
  type SaveCreativeSessionInput,
} from "./creativeSessions";

export type UseCreativeSessionsOptions = CreativeSessionStoreOptions & {
  listenForStorageEvents?: boolean;
};

/**
 * Small project-scoped adapter for a Create surface. Integration owns debounce
 * timing and decides when a submitted session is complete enough to clear.
 */
export function useCreativeSessions(projectId: string, options: UseCreativeSessionsOptions = {}) {
  const { storage, now, createId, listenForStorageEvents = true } = options;
  const storeOptions = useMemo<CreativeSessionStoreOptions>(() => ({ storage, now, createId }), [createId, now, storage]);
  const [cache, setCache] = useState(() => ({
    projectId,
    storeOptions,
    sessions: listCreativeSessions(projectId, storeOptions),
  }));
  const sessions = useMemo(
    () => cache.projectId === projectId && cache.storeOptions === storeOptions
      ? cache.sessions
      : listCreativeSessions(projectId, storeOptions),
    [cache, projectId, storeOptions],
  );

  const refresh = useCallback(() => {
    const next = listCreativeSessions(projectId, storeOptions);
    setCache({ projectId, storeOptions, sessions: next });
    return next;
  }, [projectId, storeOptions]);

  useEffect(() => {
    if (!listenForStorageEvents || storage !== undefined || typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === CREATIVE_SESSION_STORAGE_KEY || event.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [listenForStorageEvents, refresh, storage]);

  const save = useCallback((input: Omit<SaveCreativeSessionInput, "projectId">) => {
    if (!projectId) return null;
    const saved = saveCreativeSession({ ...input, projectId }, storeOptions);
    if (saved) refresh();
    return saved;
  }, [projectId, refresh, storeOptions]);

  const clear = useCallback((sessionId: string) => {
    const cleared = clearCreativeSession(sessionId, storeOptions);
    if (cleared) refresh();
    return cleared;
  }, [refresh, storeOptions]);

  const clearProject = useCallback(() => {
    if (!projectId) return 0;
    const cleared = clearCreativeSessions(projectId, storeOptions);
    if (cleared) refresh();
    return cleared;
  }, [projectId, refresh, storeOptions]);

  return {
    sessions,
    latest: sessions[0] ?? null,
    save,
    clear,
    clearProject,
    refresh,
  };
}
