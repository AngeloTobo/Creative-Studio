import { describe, expect, it } from "vitest";
import {
  CREATIVE_SESSION_SCHEMA_VERSION,
  CREATIVE_SESSION_STORAGE_KEY,
  clearCreativeSession,
  clearCreativeSessions,
  listCreativeSessions,
  loadCreativeSession,
  loadLatestCreativeSession,
  parseCreativeSessionStorage,
  saveCreativeSession,
  type CreativeSessionStorage,
} from "../../src/features/sessions";

function memoryStorage(initial?: string): CreativeSessionStorage & { value: string | null } {
  let value = initial ?? null;
  return {
    get value() { return value; },
    getItem: (key) => key === CREATIVE_SESSION_STORAGE_KEY ? value : null,
    setItem: (key, next) => { if (key === CREATIVE_SESSION_STORAGE_KEY) value = next; },
    removeItem: (key) => { if (key === CREATIVE_SESSION_STORAGE_KEY) value = null; },
  };
}

const base = {
  projectId: "project_rebecca",
  sourceAssetIds: ["media_embryo"],
  retainedArtifactId: "artifact_reference",
  direction: "Rebecca turns toward a river of light while the camera holds her profile.",
  mediaKind: "video" as const,
  workflowId: "workflow_ltx_i2v",
  graphicalSettings: {
    aspectRatio: "9:16",
    durationSeconds: 10,
    megapixels: 0.4,
    seed: 42,
    preserveAudio: false,
  },
  intentTier: "scout" as const,
};

describe("Creative Sessions browser persistence", () => {
  it("saves, updates, loads, and lists project sessions newest first", () => {
    const storage = memoryStorage();
    const first = saveCreativeSession(base, {
      storage,
      now: () => "2026-08-26T12:00:00.000Z",
      createId: () => "session_first",
    });
    const second = saveCreativeSession({ ...base, id: "session_second", mediaKind: "image", retainedArtifactId: null }, {
      storage,
      now: () => "2026-08-26T12:01:00.000Z",
    });

    expect(first).toMatchObject({ schemaVersion: 2, id: "session_first", ...base });
    expect(second?.id).toBe("session_second");
    expect(listCreativeSessions("project_rebecca", { storage }).map((session) => session.id)).toEqual(["session_second", "session_first"]);
    expect(loadCreativeSession("session_first", { storage })).toEqual(first);
    expect(loadLatestCreativeSession("project_rebecca", { storage })?.id).toBe("session_second");

    const updated = saveCreativeSession({ ...base, id: "session_first", direction: "A revised direction." }, {
      storage,
      now: () => "2026-08-26T12:02:00.000Z",
    });
    expect(loadLatestCreativeSession("project_rebecca", { storage })).toEqual(updated);
    expect(listCreativeSessions(undefined, { storage })).toHaveLength(2);
  });

  it("migrates v1 and unversioned prompt aliases into the current schema", () => {
    const legacy = JSON.stringify({
      schemaVersion: 1,
      drafts: [{
        id: "legacy_song",
        projectId: "project_album",
        sourceAssetId: "media_cover",
        artifactId: "artifact_cover",
        prompt: "Measured drums and tactile bass with one suspended beat.",
        modality: "audio",
        workflowId: "workflow_stable_audio",
        settings: { steps: 24, sampler: "euler", unsafe: { nested: true } },
        qualityTier: "final",
        updatedAt: "2026-08-25T10:30:00-05:00",
      }],
    });

    expect(parseCreativeSessionStorage(legacy)).toEqual([{
      schemaVersion: CREATIVE_SESSION_SCHEMA_VERSION,
      id: "legacy_song",
      projectId: "project_album",
      sourceAssetIds: ["media_cover"],
      retainedArtifactId: "artifact_cover",
      direction: "Measured drums and tactile bass with one suspended beat.",
      mediaKind: "music",
      workflowId: "workflow_stable_audio",
      graphicalSettings: { steps: 24, sampler: "euler" },
      intentTier: "master",
      updatedAt: "2026-08-25T15:30:00.000Z",
    }]);
  });

  it("preserves long lyrics while retaining the tighter bound for other setting strings", () => {
    const storage = memoryStorage();
    const saved = saveCreativeSession({
      ...base,
      graphicalSettings: {
        lyrics: "L".repeat(9_000),
        modelNote: "N".repeat(3_000),
      },
    }, {
      storage,
      now: () => "2026-08-26T12:00:00.000Z",
      createId: () => "session_long_lyrics",
    });

    expect(saved?.graphicalSettings.lyrics).toBe("L".repeat(8_000));
    expect(saved?.graphicalSettings.modelNote).toBe("N".repeat(2_000));
    expect(loadCreativeSession("session_long_lyrics", { storage })?.graphicalSettings).toEqual(saved?.graphicalSettings);
  });

  it("ignores corrupt records and heals corrupt storage on the next save", () => {
    const storage = memoryStorage("{definitely-not-json");
    expect(listCreativeSessions(undefined, { storage })).toEqual([]);

    const saved = saveCreativeSession(base, {
      storage,
      now: () => "2026-08-26T12:00:00.000Z",
      createId: () => "session_healed",
    });
    expect(saved?.id).toBe("session_healed");
    expect(() => JSON.parse(storage.value!)).not.toThrow();
    expect(JSON.parse(storage.value!)).toMatchObject({ schemaVersion: 2 });

    const mixed = JSON.stringify({ schemaVersion: 2, sessions: [null, {}, { projectId: "project", mediaKind: "3d" }, saved] });
    expect(parseCreativeSessionStorage(mixed)).toEqual([saved]);
    expect(parseCreativeSessionStorage(JSON.stringify({ schemaVersion: 99, sessions: [saved] }))).toEqual([]);
    expect(parseCreativeSessionStorage("x".repeat(512_001))).toEqual([]);
  });

  it("clears one session, one project, or all sessions without touching other storage keys", () => {
    const storage = memoryStorage();
    const at = (value: string) => ({ storage, now: () => value });
    saveCreativeSession({ ...base, id: "a" }, at("2026-08-26T12:00:00.000Z"));
    saveCreativeSession({ ...base, id: "b" }, at("2026-08-26T12:01:00.000Z"));
    saveCreativeSession({ ...base, id: "c", projectId: "project_other" }, at("2026-08-26T12:02:00.000Z"));

    expect(clearCreativeSession("b", { storage })).toBe(true);
    expect(clearCreativeSession("missing", { storage })).toBe(false);
    expect(listCreativeSessions(undefined, { storage }).map((session) => session.id)).toEqual(["c", "a"]);
    expect(clearCreativeSessions("project_rebecca", { storage })).toBe(1);
    expect(listCreativeSessions(undefined, { storage }).map((session) => session.id)).toEqual(["c"]);
    expect(clearCreativeSessions(undefined, { storage })).toBe(1);
    expect(storage.value).toBeNull();
  });

  it("fails closed when browser storage is unavailable or rejects writes", () => {
    const broken: CreativeSessionStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(listCreativeSessions(undefined, { storage: null })).toEqual([]);
    expect(saveCreativeSession(base, { storage: null })).toBeNull();
    expect(saveCreativeSession(base, { storage: broken })).toBeNull();
    expect(clearCreativeSession("session", { storage: broken })).toBe(false);
    expect(clearCreativeSessions(undefined, { storage: broken })).toBe(0);
  });
});
