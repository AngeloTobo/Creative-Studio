import type { IsoDateString } from "./domain";
import type { VideoDurationSeconds } from "./videoDuration";

export const GEMMA_VIDEO_SCRIPT_MODEL = "gemma4_e4b_it_fp8_scaled.safetensors" as const;
export const VIDEO_SCRIPT_SOURCE_MAX_LENGTH = 2_000;
export const VIDEO_SCRIPT_SCENE_MAX_LENGTH = 4_000;
export const VIDEO_SCRIPT_RESULT_MAX_LENGTH = 1_200;
export const VIDEO_SCRIPT_SEED_PHRASE_MAX_LENGTH = 180;
export const VIDEO_SCRIPT_SEED_PHRASE_MAX_COUNT = 20;

export type VideoScriptDraftMode = "build" | "tighten";
export type VideoScriptDraftStatus = "waiting-for-runner" | "running" | "completed" | "failed";

export type VideoScriptDraft = {
  id: string;
  projectId: string;
  status: VideoScriptDraftStatus;
  progress: number;
  mode: VideoScriptDraftMode;
  seedPhrases: string[];
  sourceScript: string | null;
  sceneDirection: string;
  videoDurationSeconds: VideoDurationSeconds;
  generatedScript: string | null;
  currentScript: string | null;
  editRevision: number;
  provider: "local-comfyui";
  model: typeof GEMMA_VIDEO_SCRIPT_MODEL | null;
  comfyPromptId: string | null;
  runnerId: string | null;
  error: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  startedAt: IsoDateString | null;
  completedAt: IsoDateString | null;
};

type CreateVideoScriptDraftBase = {
  projectId: string;
  sceneDirection?: string | null;
  videoDurationSeconds: VideoDurationSeconds;
  idempotencyKey: string;
};

export type CreateVideoScriptDraftRequest = CreateVideoScriptDraftBase & (
  | { mode: "build"; seedPhrases: string[]; sourceScript?: never }
  | { mode: "tighten"; sourceScript: string; seedPhrases?: never }
);

export type UpdateVideoScriptDraftRequest = {
  currentScript: string;
  expectedRevision: number;
};

export type VideoScriptDraftResponse = { videoScriptDraft: VideoScriptDraft };
export type RunnerVideoScriptDraftBundle = { videoScriptDraft: VideoScriptDraft };
export type RunnerVideoScriptDraftHeartbeatRequest = { progress: number };
export type RunnerCompleteVideoScriptDraftRequest = { output: string; comfyPromptId: string };
export type RunnerFailVideoScriptDraftRequest = { error: string };

export type VideoScriptUse = { requestId: string; appliedScript: string; editRevision: number };

export type VideoScriptStamp = {
  schemaVersion: "creative-studio-video-script/1.0";
  requestId: string;
  mode: VideoScriptDraftMode;
  seedPhrases: string[];
  sourceScript: string | null;
  sceneDirection: string;
  generatedScript: string;
  appliedScript: string;
  editRevision: number;
  editedAfterGeneration: boolean;
  videoDurationSeconds: VideoDurationSeconds;
  provider: "local-comfyui";
  workflowId: "gemma4-video-script-builder";
  workflowVersion: 1;
  model: typeof GEMMA_VIDEO_SCRIPT_MODEL;
  comfyPromptId: string;
  createdAt: IsoDateString;
};

export function videoScriptWordRange(duration: VideoDurationSeconds) {
  switch (duration) {
    case 5: return { minimum: 3, maximum: 8 } as const;
    case 10: return { minimum: 6, maximum: 16 } as const;
    case 15: return { minimum: 10, maximum: 24 } as const;
    case 30: return { minimum: 20, maximum: 48 } as const;
    case 60: return { minimum: 40, maximum: 96 } as const;
  }
}

export function normalizeVideoScriptSeedPhrases(value: unknown) {
  if (!Array.isArray(value)) throw new Error("video_script_seed_phrases_invalid");
  const phrases = value.map((item) => String(item ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim());
  if (!phrases.length || phrases.length > VIDEO_SCRIPT_SEED_PHRASE_MAX_COUNT
    || phrases.some((phrase) => phrase.length < 2 || phrase.length > VIDEO_SCRIPT_SEED_PHRASE_MAX_LENGTH)) {
    throw new Error("video_script_seed_phrases_invalid");
  }
  return phrases;
}

export function normalizeOwnerVideoScript(value: unknown, duration: VideoDurationSeconds) {
  const script = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (script.length < 2 || script.length > VIDEO_SCRIPT_RESULT_MAX_LENGTH) throw new Error("video_script_text_invalid");
  if (/\[[^\]]*\]|\([^)]*\)|<[^>]*>|(?:^|\n)\s*(?:speaker|subject|character|s1)\s*:/i.test(script)
    || /\r|\n/.test(script)) throw new Error("video_script_stage_direction_invalid");
  const maximum = videoScriptWordRange(duration).maximum;
  if (script.split(/\s+/).filter(Boolean).length > maximum) throw new Error("video_script_word_budget_exceeded");
  return script;
}

/** Validates Gemma's exact dialogue-only JSON without silently rewriting it. */
export function normalizeGeneratedVideoScript(value: unknown, duration: VideoDurationSeconds) {
  const output = String(value ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/```(?:json)?/gi, " ")
    .replace(/```/g, " ")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("video_script_output_invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("video_script_output_invalid");
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== "creative-studio-video-script-output/1.0"
    || typeof record.spokenText !== "string"
    || Object.keys(record).some((key) => key !== "schemaVersion" && key !== "spokenText")) {
    throw new Error("video_script_output_invalid");
  }
  const script = record.spokenText.replace(/\r\n?/g, "\n").trim();
  if (/\b(?:as an ai|language model|here(?:'s| is) (?:the|your) (?:dialogue|script))\b/i.test(script)) {
    throw new Error("video_script_metadata_leak");
  }
  if (/\[[^\]]*\]|\([^)]*\)|<[^>]*>|(?:^|\n)\s*(?:speaker|subject|character|s1)\s*:/i.test(script)) {
    throw new Error("video_script_stage_direction_invalid");
  }
  if (/\r|\n/.test(script)) throw new Error("video_script_line_break_invalid");
  const words = script.split(/\s+/).filter(Boolean);
  if (words.length < 2) throw new Error("video_script_too_short");
  const { minimum, maximum } = videoScriptWordRange(duration);
  if (words.length < minimum) throw new Error("video_script_word_budget_too_short");
  if (words.length > maximum) throw new Error("video_script_word_budget_exceeded");
  if (script.length > VIDEO_SCRIPT_RESULT_MAX_LENGTH) throw new Error("video_script_too_long");
  return script;
}
