import type { EvolutionRole, IsoDateString } from "./domain";
import type {
  VideoPromptInputMode,
  VideoPromptOutputFormat,
  VideoPromptProfile,
  VideoPromptProfileId,
} from "./promptEnhancements";
import type { VideoDurationSeconds } from "./videoDuration";

export const GEMMA_VIDEO_SCRIPT_MODEL = "gemma4_e4b_it_fp8_scaled.safetensors" as const;
export const VIDEO_SCRIPT_SOURCE_MAX_LENGTH = 4_000;
export const VIDEO_SCRIPT_SCENE_MAX_LENGTH = 4_000;
export const VIDEO_SCRIPT_RESULT_MAX_LENGTH = 1_200;
export const VIDEO_FULL_SCRIPT_MAX_LENGTH = 4_000;
export const VIDEO_SCRIPT_SEED_PHRASE_MAX_LENGTH = 180;
export const VIDEO_SCRIPT_SEED_PHRASE_MAX_COUNT = 20;

export type VideoScriptDraftMode = "build" | "tighten";
export type VideoScriptDraftStatus = "waiting-for-runner" | "running" | "completed" | "failed";
export type VideoScriptFormat = "dialogue-v1" | "full-script-v2";

export type VideoScriptPromptProfile = VideoPromptProfile;

export type VideoScriptSourceProvenance = {
  id: string;
  source: "upload" | "artifact";
  kind: "image" | "video";
  name: string;
};

export type RunnerVideoScriptSource = VideoScriptSourceProvenance & {
  projectId: string;
  originalFileName: string;
  mimeType: string;
  size: number;
};

type VideoScriptDraftBase = {
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

export type DialogueVideoScriptDraft = VideoScriptDraftBase & {
  scriptFormat: "dialogue-v1";
};

export type FullVideoScriptDraft = VideoScriptDraftBase & {
  scriptFormat: "full-script-v2";
  workflowId: string;
  workflowRevisionId: string;
  workflowName: string;
  workflowVersion: number;
  promptProfile: VideoScriptPromptProfile;
  inputMode: VideoPromptInputMode;
  source: VideoScriptSourceProvenance | null;
  generatedSpokenText: string | null;
  currentSpokenText: string | null;
};

export type VideoScriptDraft = DialogueVideoScriptDraft | FullVideoScriptDraft;

type CreateVideoScriptDraftBase = {
  scriptFormat: "full-script-v2";
  projectId: string;
  workflowId: string;
  workflowRevisionId: string;
  inputMode: VideoPromptInputMode;
  sourceId: string | null;
  sceneDirection?: string | null;
  videoDurationSeconds: VideoDurationSeconds;
  idempotencyKey: string;
};

export type CreateVideoScriptDraftRequest = CreateVideoScriptDraftBase & (
  | { mode: "build"; seedPhrases: string[]; sourceScript?: never }
  | { mode: "tighten"; sourceScript: string; seedPhrases?: never }
);

export type UpdateVideoScriptDraftRequest =
  | { scriptFormat: "dialogue-v1"; currentScript: string; expectedRevision: number }
  | {
    scriptFormat: "full-script-v2";
    currentScript: string;
    currentSpokenText: string | null;
    expectedRevision: number;
  };

export type VideoScriptDraftResponse = { videoScriptDraft: VideoScriptDraft };
export type RunnerVideoScriptDraftBundle = {
  videoScriptDraft: VideoScriptDraft;
  /** Exact owner-scoped media materialized for Gemma; null only for text-to-video or legacy dialogue drafts. */
  source: RunnerVideoScriptSource | null;
};
export type RunnerVideoScriptDraftHeartbeatRequest = { progress: number };
export type RunnerCompleteVideoScriptDraftRequest = { output: string; comfyPromptId: string };
export type RunnerFailVideoScriptDraftRequest = { error: string };

export type VideoScriptUse =
  | { scriptFormat: "dialogue-v1"; requestId: string; appliedScript: string; editRevision: number }
  | {
    scriptFormat: "full-script-v2";
    requestId: string;
    /** Owner-reviewed full visual/action/sound direction before deterministic speech compilation. */
    appliedPrompt: string;
    appliedSpokenText: string | null;
    editRevision: number;
  };

export type DialogueVideoScriptStamp = {
  schemaVersion: "creative-studio-video-script/1.0";
  scriptFormat: "dialogue-v1";
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

export type FullVideoScriptStamp = {
  schemaVersion: "creative-studio-video-script/2.0";
  scriptFormat: "full-script-v2";
  requestId: string;
  mode: VideoScriptDraftMode;
  seedPhrases: string[];
  sourceScript: string | null;
  sceneDirection: string;
  generatedScript: string;
  generatedSpokenText: string | null;
  appliedPrompt: string;
  appliedSpokenText: string | null;
  /** Exact prompt bound into the generation workflow, including deterministic speech policy. */
  jobPrompt: string;
  editRevision: number;
  editedAfterGeneration: boolean;
  videoDurationSeconds: VideoDurationSeconds;
  provider: "local-comfyui";
  workflow: {
    id: string;
    name: string;
    builderRevisionId: string;
    builderVersion: number;
    generationRevisionId: string;
  };
  promptProfile: VideoScriptPromptProfile;
  inputMode: VideoPromptInputMode;
  source: VideoScriptSourceProvenance | null;
  sourceMaterialization: "none" | "source-image" | "video-final-frame";
  promptDerivation: VideoScriptPromptDerivation;
  builderWorkflowId: "gemma4-video-script-builder";
  builderWorkflowVersion: 2;
  model: typeof GEMMA_VIDEO_SCRIPT_MODEL;
  comfyPromptId: string;
  createdAt: IsoDateString;
};

export type VideoScriptPromptDerivation = {
  schemaVersion: "creative-studio-video-script-prompt-derivation/1.0";
  kind: "reviewed-script" | "video-variant" | "prompt-enhancement" | "evolution-branch";
  relation: "substantial-reviewed-overlap" | "deterministic-creative-variant" | "typed-prompt-enhancement" | "typed-evolution-branch";
  reviewedTokenCoverage: number;
  reviewedPromptSha256: string;
  jobPromptSha256: string;
  videoVariant: {
    schemaVersion: "creative-studio-video-variant/1.0" | "creative-studio-video-variant/1.1";
    pairId: string;
    role: "aligned" | "discovery" | "exact" | "enhanced" | "left-field" | "awe";
  } | null;
  promptEnhancementRequestId: string | null;
  evolution: { studyId: string; role: EvolutionRole } | null;
};

export type VideoScriptStamp = DialogueVideoScriptStamp | FullVideoScriptStamp;

export function videoScriptWordRange(duration: VideoDurationSeconds) {
  switch (duration) {
    case 5: return { minimum: 3, maximum: 8 } as const;
    case 10: return { minimum: 6, maximum: 16 } as const;
    case 15: return { minimum: 10, maximum: 24 } as const;
    case 30: return { minimum: 20, maximum: 48 } as const;
    case 60: return { minimum: 40, maximum: 96 } as const;
  }
}

export function videoFullScriptWordRange(duration: VideoDurationSeconds, profile: Pick<VideoPromptProfile, "minimumWords" | "maximumWords">) {
  const durationMinimum = ({ 5: 35, 10: 45, 15: 55, 30: 75, 60: 100 } as const)[duration];
  const durationMaximum = ({ 5: 100, 10: 130, 15: 160, 30: 190, 60: 220 } as const)[duration];
  return {
    minimum: Math.min(profile.maximumWords, Math.max(profile.minimumWords, durationMinimum)),
    maximum: Math.min(profile.maximumWords, durationMaximum),
  };
}

export function normalizeVideoScriptSeedPhrases(value: unknown) {
  if (!Array.isArray(value)) throw new Error("video_script_seed_phrases_invalid");
  const phrases = value.map((item) => String(item ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim());
  if (!phrases.length || phrases.length > VIDEO_SCRIPT_SEED_PHRASE_MAX_COUNT
    || phrases.some((phrase) => phrase.length < 2 || phrase.length > VIDEO_SCRIPT_SEED_PHRASE_MAX_LENGTH)) {
    throw new Error("video_script_seed_phrases_invalid");
  }
  return phrases;
}

export function videoScriptInputRequestsSpeech(input: { seedPhrases: string[]; sourceScript: string | null; sceneDirection?: string | null }) {
  const authored = `${input.seedPhrases.join("\n")}\n${input.sourceScript ?? ""}\n${input.sceneDirection ?? ""}`
    .replace(/\b(?:no|without|avoid|exclude|omit)\s+(?:any\s+)?(?:dialogue|spoken words?|speech|voice[ -]?over|narration|lyrics?|singing)\b/gi, " ")
    .replace(/\b(?:do(?:es)?\s+not|don['’]?t|never)\s+(?:(?:add|include|use|generate|invent|allow)\s+(?:any\s+)?)?(?:dialogue|spoken words?|speech|voice[ -]?over|narration|lyrics?|singing|speak|say|whisper|shout|narrate|sing)\b/gi, " ")
    .replace(/\bno\s+(?:one|character|subject|person|human)\s+(?:speaks?|says?|whispers?|shouts?|narrates?|sings?)\b/gi, " ");
  return /<d(?:\s|>)|["\u201c][^"\u201d]{2,}["\u201d]|\b(?:dialogue|spoken words?|speech|speaks?|says?|whispers?|shouts?|voice[ -]?over|narrat(?:e|es|ion)|lyrics?|sings?|line to say|exact words?)\b/i.test(authored);
}

export function normalizeOwnerVideoScript(value: unknown, duration: VideoDurationSeconds) {
  const script = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (script.length < 2 || script.length > VIDEO_SCRIPT_RESULT_MAX_LENGTH) throw new Error("video_script_text_invalid");
  if (/\[[^\]]*\]|\([^)]*\)|<[^>]*>|(?:^|\n)\s*(?:speaker|subject|character|s1)\s*:/i.test(script)
    || /\r|\n/.test(script)) throw new Error("video_script_stage_direction_invalid");
  if (script.split(/\s+/).filter(Boolean).length > videoScriptWordRange(duration).maximum) {
    throw new Error("video_script_word_budget_exceeded");
  }
  return script;
}

function parseExactJson(value: unknown) {
  const output = String(value ?? "").replace(/<think>[\s\S]*?<\/think>/gi, " ").replace(/```(?:json)?/gi, " ").replace(/```/g, " ").trim();
  try { return JSON.parse(output) as unknown; } catch { throw new Error("video_script_output_invalid_json"); }
}

function parseStrictJson(value: unknown) {
  try { return JSON.parse(String(value ?? "").trim()) as unknown; } catch { throw new Error("video_script_output_invalid_json"); }
}

function validateSpokenText(value: unknown, duration: VideoDurationSeconds) {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("video_script_spoken_text_invalid");
  const script = value.replace(/\r\n?/g, "\n").trim();
  if (!script || script.length > VIDEO_SCRIPT_RESULT_MAX_LENGTH || /\r|\n/.test(script)
    || /\[[^\]]*\]|\([^)]*\)|<[^>]*>|(?:^|\n)\s*(?:speaker|subject|character|s1)\s*:/i.test(script)) {
    throw new Error("video_script_spoken_text_invalid");
  }
  if (script.split(/\s+/).filter(Boolean).length > videoScriptWordRange(duration).maximum) {
    throw new Error("video_script_word_budget_exceeded");
  }
  return script;
}

function validateFullScriptCoverage(script: string) {
  const requirements = [
    /\b(?:action|moves?|turns?|walks?|runs?|reaches?|opens?|closes?|rises?|falls?|crosses?|holds?|drifts?|gestures?|looks?|enters?|exits?)\b/i,
    /\b(?:camera|shot|lens|framing|close[ -]?up|wide|pan(?:s|ning)?|tilt(?:s|ing)?|dolly|tracking|handheld|rack focus|push(?:es)? in|pull(?:s)? back)\b/i,
    /\b(?:environment|setting|background|foreground|surroundings?|interior|exterior|room|street|rooftop|city|forest|shore|sky|ground|landscape|location|studio|stage|set)\b/i,
    /\b(?:light|lighting|lit|glow|shadow|sunlight|moonlight|neon|illumination|backlit|reflection)\b/i,
    /\b(?:sound|audio|ambience|ambient|room tone|hum|footsteps|music|wind|silence|quiet|resonance|echo)\b/i,
  ];
  if (requirements.some((pattern) => !pattern.test(script))) throw new Error("video_full_script_incomplete");
  if (!/\b(?:end|ending|final|finally|settles?|holds?|rests?|resolves?|finishes?|fades?|comes to rest|last beat|closing)\b/i.test(script)) {
    throw new Error("video_script_ending_missing");
  }
}

function validateDialogueFreeFullScript(script: string, spokenText: string | null) {
  const dialogueFreeScript = script
    .replace(/\b(?:no|without|avoid|exclude|omit)\s+(?:any\s+)?(?:dialogue|spoken words?|speech|voice[ -]?over|narration|lyrics?|singing)\b/gi, " ")
    .replace(/\b(?:do(?:es)?\s+not|don['\u2019]?t|never)\s+(?:(?:add|include|use|generate|invent|allow)\s+(?:any\s+)?)?(?:dialogue|spoken words?|speech|voice[ -]?over|narration|lyrics?|singing|speak|say|whisper|shout|narrate|sing)\b/gi, " ")
    .replace(/\bno\s+(?:one|character|subject|person|human)\s+(?:speaks?|says?|whispers?|shouts?|narrates?|sings?)\b/gi, " ");
  const containsEmbeddedDialogue = /<d(?:\s|>)|["\u201c][^"\u201d\r\n]{1,400}["\u201d]|(?:^|\s)'[^'\n]{1,200}'(?:\s|$)|\b(?:dialogue|spoken words?|speech|speaks?|says?|whispers?|shouts?|voice[ -]?over|narrat(?:e|es|ion)|lyrics?|sings?)\b/i.test(dialogueFreeScript);
  const repeatsSpokenText = spokenText !== null && script.toLocaleLowerCase().includes(spokenText.toLocaleLowerCase());
  if (containsEmbeddedDialogue || repeatsSpokenText) throw new Error("video_script_dialogue_embedded");
}

function validateProfiledFullScript(value: unknown, duration: VideoDurationSeconds, profile: VideoPromptProfile, inputMode: VideoPromptInputMode) {
  if (typeof value !== "string") throw new Error("video_full_script_invalid");
  const script = value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (script.length < 20 || script.length > VIDEO_FULL_SCRIPT_MAX_LENGTH) throw new Error("video_full_script_length_invalid");
  if (/\b(?:as an ai|language model|here(?:'s| is) (?:the|your) (?:video )?script|creative-studio-video-script-output|ltx[ -]?2\.5|minimax h3|target model|prompt enhancement)\b/i.test(script)
    || /(?:^|\n)\s*(?:title|model|schema|explanation|reasoning|prompt|full video script|target model)\s*:/im.test(script)
    || /```|#{1,6}\s/.test(script)) {
    throw new Error("video_script_metadata_leak");
  }
  const wordCount = script.split(/\s+/).filter(Boolean).length;
  const range = videoFullScriptWordRange(duration, profile);
  if (wordCount < range.minimum || wordCount > range.maximum) throw new Error("video_full_script_word_budget_invalid");
  validateFullScriptCoverage(script);
  if (profile.outputFormat === "minimax-h3-timeline") {
    const pictureInstruction = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
    const requiresPicture = inputMode === "image-to-video" || inputMode === "video-extension";
    const pictureCount = (script.match(/<Picture 1>/g) || []).length;
    if (requiresPicture && (!script.startsWith(pictureInstruction) || pictureCount !== 1)) {
      throw new Error("video_full_script_picture_alignment_missing");
    }
    if (!requiresPicture && /Picture 1|source image|reference image|referenced shot/i.test(script)) {
      throw new Error("video_full_script_picture_alignment_unexpected");
    }
    const audioLineCount = (script.match(/(?:^|\n)Audio:\s*\S/gi) || []).length;
    if (!/(?:^|\n)SHOT\s+1\b/i.test(script) || audioLineCount !== 1) throw new Error("video_full_script_timeline_invalid");
    const timestamps = [...script.matchAll(/(?:^|[\s[(\u2013\u2014-])(\d+(?:\.\d+)?)\s*(?=(?:s(?:ec(?:onds?)?)?\b|[\u2013\u2014-]|to\b|through\b))/gim)].map((match) => Number(match[1]));
    const chronological = timestamps.every((timestamp, index) => index === 0 || timestamp >= timestamps[index - 1]);
    if (timestamps.length < 3 || timestamps.some((timestamp) => timestamp < 0 || timestamp > duration)
      || !chronological || Math.min(...timestamps) !== 0 || Math.max(...timestamps) !== duration) {
      throw new Error("video_full_script_timing_invalid");
    }
  } else {
    if (/\r|\n|(?:^|\s)(?:SHOT\s+\d+|Audio:)\s*/i.test(script)) throw new Error("video_script_natural_format_invalid");
    const sentenceCount = (script.match(/[.!?](?:\s|$)/g) || []).length;
    if (sentenceCount < 3) throw new Error("video_script_progression_missing");
  }
  return script;
}

function normalizeFullVideoScriptParts(
  fullScriptValue: unknown,
  spokenTextValue: unknown,
  duration: VideoDurationSeconds,
  profile: VideoPromptProfile,
  inputMode: VideoPromptInputMode,
  speechRequested: boolean,
) {
  const fullScript = validateProfiledFullScript(fullScriptValue, duration, profile, inputMode);
  const spokenText = validateSpokenText(spokenTextValue, duration);
  validateDialogueFreeFullScript(fullScript, spokenText);
  if (!speechRequested && spokenText !== null) throw new Error("video_script_unrequested_dialogue");
  return { fullScript, spokenText };
}

/** Validates Gemma's exact full-script v2 JSON without accepting hidden fields. */
export function normalizeGeneratedFullVideoScript(
  value: unknown,
  duration: VideoDurationSeconds,
  profile: VideoPromptProfile,
  inputMode: VideoPromptInputMode,
  speechRequested: boolean,
) {
  const parsed = parseStrictJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("video_script_output_invalid");
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (record.schemaVersion !== "creative-studio-video-script-output/2.0"
    || keys.length !== 3 || keys[0] !== "fullScript" || keys[1] !== "schemaVersion" || keys[2] !== "spokenText") {
    throw new Error("video_script_output_invalid");
  }
  return normalizeFullVideoScriptParts(record.fullScript, record.spokenText, duration, profile, inputMode, speechRequested);
}

export function normalizeOwnerFullVideoScript(
  fullScript: unknown,
  spokenText: unknown,
  duration: VideoDurationSeconds,
  profile: VideoPromptProfile,
  inputMode: VideoPromptInputMode,
  speechRequested: boolean,
) {
  // A non-null owner edit is itself explicit permission to add dialogue. Gemma output
  // remains constrained by the original request in normalizeGeneratedFullVideoScript.
  return normalizeFullVideoScriptParts(fullScript, spokenText, duration, profile, inputMode,
    speechRequested || spokenText !== null);
}

/** Validates Gemma's exact legacy dialogue-only JSON without silently rewriting it. */
export function normalizeGeneratedVideoScript(value: unknown, duration: VideoDurationSeconds) {
  const parsed = parseExactJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("video_script_output_invalid");
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== "creative-studio-video-script-output/1.0" || typeof record.spokenText !== "string"
    || Object.keys(record).some((key) => key !== "schemaVersion" && key !== "spokenText")) {
    throw new Error("video_script_output_invalid");
  }
  const script = record.spokenText.replace(/\r\n?/g, "\n").trim();
  if (/\b(?:as an ai|language model|here(?:'s| is) (?:the|your) (?:dialogue|script))\b/i.test(script)) throw new Error("video_script_metadata_leak");
  if (/\[[^\]]*\]|\([^)]*\)|<[^>]*>|(?:^|\n)\s*(?:speaker|subject|character|s1)\s*:/i.test(script)) throw new Error("video_script_stage_direction_invalid");
  if (/\r|\n/.test(script)) throw new Error("video_script_line_break_invalid");
  const words = script.split(/\s+/).filter(Boolean);
  if (words.length < 2) throw new Error("video_script_too_short");
  const { minimum, maximum } = videoScriptWordRange(duration);
  if (words.length < minimum) throw new Error("video_script_word_budget_too_short");
  if (words.length > maximum) throw new Error("video_script_word_budget_exceeded");
  if (script.length > VIDEO_SCRIPT_RESULT_MAX_LENGTH) throw new Error("video_script_too_long");
  return script;
}

export function isVideoScriptPromptProfile(value: { id: string | null; label: string | null; targetModel: string | null; outputFormat: string | null }): value is {
  id: VideoPromptProfileId; label: string; targetModel: string; outputFormat: VideoPromptOutputFormat;
} {
  return (value.id === "minimax-h3-i2v-motion/1.0" || value.id === "ltx-2.5-motion/1.0" || value.id === "generic-video-motion/1.0")
    && Boolean(value.label && value.targetModel)
    && (value.outputFormat === "minimax-h3-timeline" || value.outputFormat === "natural-language");
}
