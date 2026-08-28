export const CREATIVE_SESSION_STORAGE_KEY = "creative-studio:create-sessions";
export const CREATIVE_SESSION_SCHEMA_VERSION = 2 as const;

const MAX_STORED_SESSIONS = 32;
const MAX_SOURCE_ASSETS = 32;
const MAX_SETTING_ENTRIES = 64;
const MAX_STORAGE_BYTES = 512_000;
const MAX_SETTING_STRING_CHARACTERS = 2_000;
const MAX_VIDEO_PROMPT_SETTING_CHARACTERS = 4_000;
const MAX_LYRICS_SETTING_CHARACTERS = 8_000;

export type CreativeSessionMediaKind = "image" | "video" | "music";
export type CreativeSessionIntentTier = "scout" | "explore" | "master";
export type CreativeSessionSettingValue = string | number | boolean | null;
export type CreativeSessionGraphicalSettings = Record<string, CreativeSessionSettingValue>;

export type CreativeSession = {
  schemaVersion: typeof CREATIVE_SESSION_SCHEMA_VERSION;
  id: string;
  projectId: string;
  sourceAssetIds: string[];
  retainedArtifactId: string | null;
  direction: string;
  mediaKind: CreativeSessionMediaKind;
  workflowId: string | null;
  graphicalSettings: CreativeSessionGraphicalSettings;
  intentTier: CreativeSessionIntentTier;
  updatedAt: string;
};

export type SaveCreativeSessionInput = Omit<CreativeSession, "schemaVersion" | "id" | "updatedAt"> & {
  id?: string;
};

export type CreativeSessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CreativeSessionStoreOptions = {
  storage?: CreativeSessionStorage | null;
  now?: () => Date | string;
  createId?: () => string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function optionalId(value: unknown) {
  const id = boundedString(value, 256);
  return id || null;
}

function canonicalTimestamp(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function currentTimestamp(options: CreativeSessionStoreOptions) {
  const value = options.now?.() ?? new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function mediaKind(value: unknown): CreativeSessionMediaKind | null {
  if (value === "image" || value === "video" || value === "music") return value;
  if (value === "audio" || value === "song") return "music";
  return null;
}

function intentTier(value: unknown): CreativeSessionIntentTier {
  if (value === "scout" || value === "explore" || value === "master") return value;
  if (value === "draft" || value === "quick") return "scout";
  if (value === "final" || value === "quality") return "master";
  return "explore";
}

function sourceAssetIds(value: unknown, singular: unknown) {
  const candidates = Array.isArray(value) ? value : singular ? [singular] : [];
  return [...new Set(candidates
    .map((item) => boundedString(item, 256))
    .filter(Boolean))]
    .slice(0, MAX_SOURCE_ASSETS);
}

function graphicalSettings(value: unknown): CreativeSessionGraphicalSettings {
  if (!isRecord(value)) return {};
  const normalized: CreativeSessionGraphicalSettings = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, MAX_SETTING_ENTRIES)) {
    const key = boundedString(rawKey, 128);
    if (!key) continue;
    if (rawValue === null || typeof rawValue === "boolean") {
      normalized[key] = rawValue;
      continue;
    }
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      normalized[key] = rawValue;
      continue;
    }
    if (typeof rawValue === "string") {
      const maximum = key === "lyrics"
        ? MAX_LYRICS_SETTING_CHARACTERS
        : key === "originalVideoDirection" || key === "videoScriptProposal"
          ? MAX_VIDEO_PROMPT_SETTING_CHARACTERS
          : MAX_SETTING_STRING_CHARACTERS;
      normalized[key] = rawValue.slice(0, maximum);
    }
  }
  return normalized;
}

function legacyId(projectId: string, kind: CreativeSessionMediaKind, updatedAt: string, index: number) {
  return `session_${projectId}_${kind}_${Date.parse(updatedAt)}_${index}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 256);
}

function normalizeSession(value: unknown, fallbackTimestamp: string, index: number): CreativeSession | null {
  if (!isRecord(value)) return null;
  const projectId = boundedString(value.projectId, 256);
  const kind = mediaKind(value.mediaKind ?? value.modality ?? value.kind);
  if (!projectId || !kind) return null;

  const updatedAt = canonicalTimestamp(value.updatedAt, fallbackTimestamp);
  const id = optionalId(value.id) ?? legacyId(projectId, kind, updatedAt, index);
  return {
    schemaVersion: CREATIVE_SESSION_SCHEMA_VERSION,
    id,
    projectId,
    sourceAssetIds: sourceAssetIds(value.sourceAssetIds, value.sourceAssetId),
    retainedArtifactId: optionalId(value.retainedArtifactId ?? value.artifactId),
    direction: boundedString(value.direction ?? value.prompt, 12_000),
    mediaKind: kind,
    workflowId: optionalId(value.workflowId),
    graphicalSettings: graphicalSettings(value.graphicalSettings ?? value.settings),
    intentTier: intentTier(value.intentTier ?? value.tier ?? value.qualityTier),
    updatedAt,
  };
}

function sessionCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (typeof value.schemaVersion === "number" && value.schemaVersion > CREATIVE_SESSION_SCHEMA_VERSION) return [];
  if (Array.isArray(value.sessions)) return value.sessions;
  if (Array.isArray(value.drafts)) return value.drafts;
  return value.projectId ? [value] : [];
}

/**
 * Reads current, v1, or unversioned session payloads without trusting stored data.
 * Invalid records are ignored so a corrupt browser value can never prevent Create
 * from opening. The next successful save writes the current v2 envelope.
 */
export function parseCreativeSessionStorage(raw: string | null | undefined, now = new Date().toISOString()): CreativeSession[] {
  if (!raw || raw.length > MAX_STORAGE_BYTES) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const fallbackTimestamp = canonicalTimestamp(now, new Date().toISOString());
  const byId = new Map<string, CreativeSession>();
  sessionCandidates(parsed).forEach((candidate, index) => {
    const session = normalizeSession(candidate, fallbackTimestamp, index);
    if (!session) return;
    const previous = byId.get(session.id);
    if (!previous || previous.updatedAt < session.updatedAt) byId.set(session.id, session);
  });
  return [...byId.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, MAX_STORED_SESSIONS);
}

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(options: CreativeSessionStoreOptions) {
  return options.storage === undefined ? browserStorage() : options.storage;
}

function readSessions(storage: CreativeSessionStorage, now: string) {
  try {
    return parseCreativeSessionStorage(storage.getItem(CREATIVE_SESSION_STORAGE_KEY), now);
  } catch {
    return [];
  }
}

function writeSessions(storage: CreativeSessionStorage, sessions: CreativeSession[]) {
  try {
    storage.setItem(CREATIVE_SESSION_STORAGE_KEY, JSON.stringify({
      schemaVersion: CREATIVE_SESSION_SCHEMA_VERSION,
      sessions: sessions.slice(0, MAX_STORED_SESSIONS),
    }));
    return true;
  } catch {
    return false;
  }
}

function generatedId(options: CreativeSessionStoreOptions) {
  const supplied = boundedString(options.createId?.(), 256);
  if (supplied) return supplied;
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return `session_${globalThis.crypto.randomUUID()}`;
  } catch {
    // Fall through to a non-security-sensitive draft identifier.
  }
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function listCreativeSessions(projectId?: string, options: CreativeSessionStoreOptions = {}) {
  const storage = resolveStorage(options);
  if (!storage) return [];
  const sessions = readSessions(storage, currentTimestamp(options));
  const project = projectId?.trim();
  return project ? sessions.filter((session) => session.projectId === project) : sessions;
}

export function loadCreativeSession(sessionId: string, options: CreativeSessionStoreOptions = {}) {
  const id = sessionId.trim();
  if (!id) return null;
  return listCreativeSessions(undefined, options).find((session) => session.id === id) ?? null;
}

export function loadLatestCreativeSession(projectId: string, options: CreativeSessionStoreOptions = {}) {
  return listCreativeSessions(projectId, options)[0] ?? null;
}

export function saveCreativeSession(input: SaveCreativeSessionInput, options: CreativeSessionStoreOptions = {}) {
  const storage = resolveStorage(options);
  if (!storage) return null;
  const updatedAt = currentTimestamp(options);
  const normalized = normalizeSession({
    ...input,
    id: optionalId(input.id) ?? generatedId(options),
    updatedAt,
  }, updatedAt, 0);
  if (!normalized) return null;

  const existing = readSessions(storage, updatedAt).filter((session) => session.id !== normalized.id);
  const sessions = [normalized, ...existing]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, MAX_STORED_SESSIONS);
  return writeSessions(storage, sessions) ? normalized : null;
}

export function clearCreativeSession(sessionId: string, options: CreativeSessionStoreOptions = {}) {
  const storage = resolveStorage(options);
  const id = sessionId.trim();
  if (!storage || !id) return false;
  const now = currentTimestamp(options);
  const sessions = readSessions(storage, now);
  const remaining = sessions.filter((session) => session.id !== id);
  if (remaining.length === sessions.length) return false;
  if (!remaining.length) {
    try {
      storage.removeItem(CREATIVE_SESSION_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }
  return writeSessions(storage, remaining);
}

/** Clears one project's sessions, or every saved session when projectId is omitted. */
export function clearCreativeSessions(projectId?: string, options: CreativeSessionStoreOptions = {}) {
  const storage = resolveStorage(options);
  if (!storage) return 0;
  const now = currentTimestamp(options);
  const sessions = readSessions(storage, now);
  const project = projectId?.trim();
  const removed = project ? sessions.filter((session) => session.projectId === project).length : sessions.length;
  if (!removed) return 0;
  try {
    if (!project) storage.removeItem(CREATIVE_SESSION_STORAGE_KEY);
    else if (!writeSessions(storage, sessions.filter((session) => session.projectId !== project))) return 0;
    return removed;
  } catch {
    return 0;
  }
}
