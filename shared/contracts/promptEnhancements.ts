import type { IsoDateString } from "./domain";
import type { VideoDurationSeconds } from "./videoDuration";
import type { WorkflowDefinition, WorkflowParameter } from "./workflows";

export const GEMMA_VIDEO_PROMPT_MODEL = "gemma4_e4b_it_fp8_scaled.safetensors" as const;
export const VIDEO_PROMPT_SOURCE_MAX_LENGTH = 4_000;
export const VIDEO_PROMPT_ENHANCED_MAX_LENGTH = 4_000;
export const MINIMAX_PICTURE_ALIGNMENT_INSTRUCTION = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";

export type VideoPromptProfileId =
  | "minimax-h3-i2v-motion/1.0"
  | "ltx-2.5-motion/1.0"
  | "generic-video-motion/1.0";

export type VideoPromptOutputFormat = "minimax-h3-timeline" | "natural-language";

export type VideoSpeechMode = "no-speech" | "short-natural-line" | "exact-script";

export type VideoSpeechInput = {
  mode?: VideoSpeechMode;
  text?: string | null;
};

export type VideoSpeechStamp = {
  schemaVersion: "creative-studio-video-speech/1.0";
  mode: VideoSpeechMode;
  authoredText: string | null;
  spokenText: string | null;
  directive: string;
};

export type VideoPromptProfile = {
  id: VideoPromptProfileId;
  label: string;
  targetModel: string;
  outputFormat: VideoPromptOutputFormat;
  minimumWords: number;
  maximumWords: number;
};

export const VIDEO_SOUND_DESIGN_DIRECTIVE = "Keep sound active with scene-specific ambience and effects, bright arpeggiated synths, sparkling electronic layers, buoyant programmed percussion, wistful melodic hooks, and a dreamy nocturnal-city texture when appropriate.";
export const VIDEO_EXTENSION_SOUND_DIRECTIVE = "Generate a new synchronized soundtrack for this continuation with fresh ambience, effects, and music shaped by the new action; do not loop the source track or leave the new segment silent.";
export const VIDEO_NO_DIALOGUE_DIRECTIVE = "No dialogue or intelligible human speech. Do not invent words, lyrics, or human vocal patterns.";
const NO_SPEECH_DIRECTIVE = `${VIDEO_NO_DIALOGUE_DIRECTIVE} ${VIDEO_SOUND_DESIGN_DIRECTIVE}`;
export const VIDEO_SPEECH_TEXT_MAX_LENGTH = 1_200;
const VIDEO_SPEECH_NATURAL_LINE_MAX_WORDS = 14;

function speechText(value: unknown) {
  return String(value ?? "").trim().slice(0, VIDEO_SPEECH_TEXT_MAX_LENGTH + 1);
}

function simplifyNaturalSpeechLine(value: unknown) {
  let line = speechText(value);
  if (!line || line.length > VIDEO_SPEECH_TEXT_MAX_LENGTH) throw new Error("video_speech_text_invalid");
  line = line
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/^\s*(?:(?:please\s+)?(?:have|make|let)\s+(?:the\s+)?(?:subject|person|character|speaker|them|him|her)\s+(?:say|speak)|(?:the\s+)?(?:subject|person|character|speaker)\s+says?|dialogue)\s*[:,.-]?\s*/i, "")
    .replace(/^\s*["'\u201c\u201d]+|["'\u201c\u201d]+\s*$/g, "")
    .replace(/\b(?:um+|uh+|you know|kind of|sort of|basically|literally)\b\s*[,;:-]?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence = line.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? line;
  const tokens = firstSentence.replace(/[.!?]+$/, "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error("video_speech_text_invalid");
  const bounded = tokens.slice(0, VIDEO_SPEECH_NATURAL_LINE_MAX_WORDS).join(" ").replace(/[,;:-]+$/, "").trim();
  if (!bounded) throw new Error("video_speech_text_invalid");
  const capitalized = `${bounded.charAt(0).toUpperCase()}${bounded.slice(1)}`;
  const punctuation = /\?$/.test(firstSentence) ? "?" : /!$/.test(firstSentence) ? "!" : ".";
  return `${capitalized}${punctuation}`;
}

function exactSpeechText(value: unknown) {
  const line = speechText(value);
  if (!line || line.length > VIDEO_SPEECH_TEXT_MAX_LENGTH || /<\/?d(?:\s|>)/i.test(line)) {
    throw new Error("video_speech_text_invalid");
  }
  return line;
}

function h3SpeechDirective(mode: Exclude<VideoSpeechMode, "no-speech">, spokenText: string, soundDesign = true) {
  const delivery = mode === "exact-script" ? "says exactly once without paraphrase" : "says once, clearly and naturally";
  return `(S1) is the visible subject. At the intended beat, (S1) ${delivery}: <d>[English] ${spokenText}</d>. Do not add, repeat, or improvise any other words. No other dialogue or human vocalization.${soundDesign ? ` ${VIDEO_SOUND_DESIGN_DIRECTIVE}` : ""}`;
}

function naturalLanguageSpeechDirective(mode: Exclude<VideoSpeechMode, "no-speech">, spokenText: string, soundDesign = true) {
  const delivery = mode === "exact-script" ? "says exactly once, verbatim" : "says once, clearly and naturally";
  return `The visible subject ${delivery}: "${spokenText}" Do not add, repeat, paraphrase, or improvise any other words. No other dialogue or human vocalization.${soundDesign ? ` ${VIDEO_SOUND_DESIGN_DIRECTIVE}` : ""}`;
}

function speechDirective(mode: VideoSpeechMode, spokenText: string | null, outputFormat: VideoPromptOutputFormat, soundDesign = true) {
  if (mode === "no-speech") return soundDesign ? NO_SPEECH_DIRECTIVE : VIDEO_NO_DIALOGUE_DIRECTIVE;
  if (!spokenText) throw new Error("video_speech_text_invalid");
  return outputFormat === "minimax-h3-timeline"
    ? h3SpeechDirective(mode, spokenText, soundDesign)
    : naturalLanguageSpeechDirective(mode, spokenText, soundDesign);
}

function compileSpeechStamp(input: VideoSpeechInput | undefined, outputFormat: VideoPromptOutputFormat, soundDesign = true): VideoSpeechStamp {
  const mode = input?.mode ?? "no-speech";
  if (mode !== "no-speech" && mode !== "short-natural-line" && mode !== "exact-script") throw new Error("video_speech_mode_invalid");
  if (mode === "no-speech") {
    if (speechText(input?.text)) throw new Error("video_speech_text_unexpected");
    return { schemaVersion: "creative-studio-video-speech/1.0", mode, authoredText: null, spokenText: null, directive: speechDirective(mode, null, outputFormat, soundDesign) };
  }
  const authoredText = speechText(input?.text);
  if (!authoredText || authoredText.length > VIDEO_SPEECH_TEXT_MAX_LENGTH) throw new Error("video_speech_text_invalid");
  const spokenText = mode === "exact-script" ? exactSpeechText(authoredText) : simplifyNaturalSpeechLine(authoredText);
  return {
    schemaVersion: "creative-studio-video-speech/1.0",
    mode,
    authoredText,
    spokenText,
    directive: speechDirective(mode, spokenText, outputFormat, soundDesign),
  };
}

/** Validates a browser-provided speech stamp without trusting its description. */
export function normalizeVideoSpeechStamp(value: unknown): VideoSpeechStamp {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_video_speech_stamp");
  const input = value as Record<string, unknown>;
  const mode = input.mode;
  if (input.schemaVersion !== "creative-studio-video-speech/1.0"
    || (mode !== "no-speech" && mode !== "short-natural-line" && mode !== "exact-script")) {
    throw new Error("invalid_video_speech_stamp");
  }
  const authoredText = input.authoredText === null ? null : String(input.authoredText ?? "");
  const spokenText = input.spokenText === null ? null : String(input.spokenText ?? "");
  const directive = String(input.directive ?? "");
  try {
    if (mode === "no-speech") {
      if (authoredText !== null || spokenText !== null || ![NO_SPEECH_DIRECTIVE, VIDEO_NO_DIALOGUE_DIRECTIVE].includes(directive)) throw new Error("invalid");
    } else {
      if (authoredText === null || spokenText === null) throw new Error("invalid");
      const expectedSpokenText = mode === "exact-script" ? exactSpeechText(authoredText) : simplifyNaturalSpeechLine(authoredText);
      if (spokenText !== expectedSpokenText) throw new Error("invalid");
      const validDirectives = [
        speechDirective(mode, spokenText, "minimax-h3-timeline"),
        speechDirective(mode, spokenText, "natural-language"),
        speechDirective(mode, spokenText, "minimax-h3-timeline", false),
        speechDirective(mode, spokenText, "natural-language", false),
      ];
      if (!validDirectives.includes(directive)) throw new Error("invalid");
    }
  } catch {
    throw new Error("invalid_video_speech_stamp");
  }
  return { schemaVersion: "creative-studio-video-speech/1.0", mode, authoredText, spokenText, directive };
}

/**
 * Applies an explicit speech policy after visual prompt enhancement. H3 speech
 * follows its timeline dialogue syntax; no-speech modifies only the Audio line
 * and intentionally creates no speaker identity. Natural-language profiles get
 * one literal chronological sentence.
 */
export function compileVideoPromptWithSpeech(
  value: unknown,
  input: VideoSpeechInput | undefined,
  profile: Pick<VideoPromptProfile, "outputFormat">,
  options: { continuationSound?: boolean; soundDesign?: boolean } = {},
) {
  let basePrompt = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (basePrompt.length < 4) throw new Error("directive_required");
  const soundDesign = options.continuationSound || options.soundDesign !== false;
  if (options.continuationSound && !basePrompt.includes(VIDEO_EXTENSION_SOUND_DIRECTIVE)) {
    if (profile.outputFormat === "minimax-h3-timeline" && /(Audio\s*:\s*[^\n]*)/i.test(basePrompt)) {
      basePrompt = basePrompt.replace(/(Audio\s*:\s*[^\n]*)/i, `$1 ${VIDEO_EXTENSION_SOUND_DIRECTIVE}`);
    } else {
      basePrompt = `${basePrompt}${profile.outputFormat === "minimax-h3-timeline" ? "\nAudio:" : ""} ${VIDEO_EXTENSION_SOUND_DIRECTIVE}`;
    }
  }
  const speech = compileSpeechStamp(input, profile.outputFormat, soundDesign);
  let prompt: string;
  if (profile.outputFormat === "minimax-h3-timeline") {
    const audioPattern = /(Audio\s*:\s*[^\n]*)/i;
    if (speech.mode === "no-speech") {
      prompt = audioPattern.test(basePrompt)
        ? basePrompt.replace(audioPattern, `$1 ${speech.directive}`)
        : `${basePrompt}\nAudio: ${speech.directive}`;
    } else {
      prompt = audioPattern.test(basePrompt)
        ? basePrompt.replace(audioPattern, `${speech.directive}\n$1`)
        : `${basePrompt}\n${speech.directive}\nAudio: Soundscape follows the visible action.`;
    }
  } else {
    prompt = `${basePrompt.replace(/\s+/g, " ").trim()} ${speech.directive}`.trim();
  }
  if (prompt.length > VIDEO_PROMPT_ENHANCED_MAX_LENGTH) throw new Error("video_speech_prompt_too_long");
  return { prompt, speech };
}

export function videoPromptProfileForIdentity(input: {
  name?: string | null;
  description?: string | null;
  sourceFileName?: string | null;
  models?: string[];
  parameters?: Array<Pick<WorkflowParameter, "id" | "label">>;
  inputMode?: VideoPromptInputMode;
}): VideoPromptProfile {
  const identity = [
    input.name,
    input.description,
    input.sourceFileName,
    ...(input.models ?? []),
    ...(input.parameters ?? []).flatMap((parameter) => [parameter.id, parameter.label]),
  ].filter(Boolean).join(" ").toLowerCase();
  if (/minimax[^\n]*h3|h3[^\n]*minimax/.test(identity)) {
    return {
      id: "minimax-h3-i2v-motion/1.0",
      label: "MiniMax H3 I2VA motion direction",
      targetModel: "MiniMax H3",
      outputFormat: "minimax-h3-timeline",
      minimumWords: 60,
      maximumWords: 180,
    };
  }
  if (/(?:^|[^a-z0-9])ltx(?:[_ .-]*2(?:[_ .-]*5)?)?(?:[^a-z0-9]|$)/.test(identity)) {
    return {
      id: "ltx-2.5-motion/1.0",
      label: "LTX 2.5 chronological motion direction",
      targetModel: "LTX 2.5",
      outputFormat: "natural-language",
      minimumWords: 35,
      maximumWords: 200,
    };
  }
  return {
    id: "generic-video-motion/1.0",
    label: "Model-ready video motion direction",
    targetModel: "Selected video model",
    outputFormat: "natural-language",
    minimumWords: 35,
    maximumWords: 160,
  };
}

export function videoWorkflowPromptProfile(
  workflow: Pick<WorkflowDefinition, "name" | "description" | "sourceFileName" | "currentRevision">,
  inputMode: VideoPromptInputMode = "text-to-video",
) {
  return videoPromptProfileForIdentity({
    name: workflow.name,
    description: workflow.description,
    sourceFileName: workflow.sourceFileName,
    models: workflow.currentRevision.models,
    parameters: workflow.currentRevision.parameters,
    inputMode,
  });
}

function words(value: string) {
  return value.split(/\s+/).filter(Boolean);
}

function cleanModelOutput(value: unknown) {
  return String(value ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/```(?:text|markdown)?/gi, " ")
    .replace(/```/g, " ")
    .replace(/^\s*(?:enhanced\s+)?(?:video|motion)?\s*prompt\s*:\s*/i, "")
    .replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "")
    .trim();
}

function boundedWords(value: string, maximum: number) {
  const tokens = words(value);
  return tokens.length <= maximum ? value : tokens.slice(0, maximum).join(" ").replace(/[,:;-]+$/, "").trim();
}

function minimaxShotRanges(timeline: string, duration: VideoDurationSeconds) {
  const markers = [...timeline.matchAll(/\bSHOT\s+(\d+)\b/gi)];
  if (!markers.length || markers.some((marker, index) => Number(marker[1]) !== index + 1)) return [];
  const timings = markers.map((marker, index) => {
    const markerEnd = (marker.index ?? 0) + marker[0].length;
    const nextMarker = markers[index + 1];
    const audioIndex = timeline.slice(markerEnd).search(/\bAudio\s*:/i);
    const sectionEnd = nextMarker?.index ?? (audioIndex >= 0 ? markerEnd + audioIndex : timeline.length);
    const headingAndBody = timeline.slice(markerEnd, sectionEnd);
    const range = headingAndBody.match(/(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds?)?)?\s*)?(?:[-\u2013\u2014]|to\b|through\b)\s*(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds?)?)?)?/i);
    if (range) return { start: Number(range[1]), explicitEnd: Number(range[2]) };
    const point = headingAndBody.match(/\d+(?:\.\d+)?/);
    return point ? { start: Number(point[0]), explicitEnd: null } : null;
  });
  if (timings.some((timing) => timing === null)) return [];
  return timings.map((timing, index) => ({
    start: timing!.start,
    end: timing!.explicitEnd ?? timings[index + 1]?.start ?? duration,
  }));
}

export function normalizeEnhancedVideoPrompt(
  value: unknown,
  profile: VideoPromptProfile,
  options: { videoDurationSeconds?: VideoDurationSeconds; inputMode?: VideoPromptInputMode } = {},
) {
  let prompt = cleanModelOutput(value);
  if (profile.outputFormat === "minimax-h3-timeline") {
    const hasFrame = options.inputMode === "image-to-video" || options.inputMode === "video-extension";
    const shotOneIndex = prompt.search(/\bSHOT\s+1\b(?=\s*(?:\(|:|\[|[-\u2013\u2014]))/i);
    if (shotOneIndex < 0) throw new Error("video_prompt_enhancement_invalid_minimax_timeline");
    const timeline = prompt.slice(shotOneIndex).trim();
    if (/<?Picture\s+1>?/i.test(timeline)) {
      if (hasFrame) throw new Error("video_prompt_enhancement_minimax_picture_alignment_duplicate");
      throw new Error("video_prompt_enhancement_minimax_picture_alignment_unexpected");
    }
    if (!/\bAudio\s*:/i.test(timeline)) {
      throw new Error("video_prompt_enhancement_invalid_minimax_timeline");
    }
    const duration = options.videoDurationSeconds;
    if (duration !== undefined) {
      const shotRanges = minimaxShotRanges(timeline, duration);
      const invalidRange = shotRanges.some((range, index) => !Number.isFinite(range.start)
        || !Number.isFinite(range.end)
        || range.start < 0
        || range.end <= range.start
        || range.end > duration
        || (index > 0 && range.start < shotRanges[index - 1].end));
      const reachesSelectedDuration = shotRanges.length > 0
        && Math.abs(shotRanges[shotRanges.length - 1].end - duration) <= 0.01;
      if (!shotRanges.length || shotRanges[0].start !== 0 || invalidRange || !reachesSelectedDuration) {
        throw new Error("video_prompt_enhancement_minimax_timing_invalid");
      }
    }
    const normalizedTimeline = timeline.replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    prompt = hasFrame
      ? `${MINIMAX_PICTURE_ALIGNMENT_INSTRUCTION}\n${normalizedTimeline}`
      : normalizedTimeline;
  } else {
    prompt = prompt
      .replace(/^\s*(?:#{1,6}\s*)?(?:description|action|camera|lighting|sound|ending)\s*:\s*/gim, "")
      .replace(/\s+/g, " ")
      .trim();
    prompt = boundedWords(prompt, profile.maximumWords);
  }
  const count = words(prompt).length;
  if (count < profile.minimumWords || count > profile.maximumWords) throw new Error("video_prompt_enhancement_length_invalid");
  if (/\b(?:as an ai|this prompt|prompt enhancement|target model|ltx[ -]?2\.5 model|minimax h3 model)\b/i.test(prompt)) {
    throw new Error("video_prompt_enhancement_metadata_leak");
  }
  return prompt.slice(0, 4_000);
}

export type PromptEnhancementStatus = "waiting-for-runner" | "running" | "completed" | "failed";
export type VideoPromptInputMode = "image-to-video" | "text-to-video" | "video-extension";

export type VideoPromptEnhancement = {
  id: string;
  projectId: string;
  workflowId: string;
  workflowRevisionId: string;
  workflowName: string;
  status: PromptEnhancementStatus;
  progress: number;
  sourcePrompt: string;
  enhancedPrompt: string | null;
  provider: "local-comfyui";
  promptProfileId: VideoPromptProfileId;
  targetModel: string;
  outputFormat: VideoPromptOutputFormat;
  inputMode: VideoPromptInputMode;
  sourceId: string | null;
  videoDurationSeconds: VideoDurationSeconds;
  model: typeof GEMMA_VIDEO_PROMPT_MODEL | null;
  comfyPromptId: string | null;
  runnerId: string | null;
  error: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  startedAt: IsoDateString | null;
  completedAt: IsoDateString | null;
};

export type CreateVideoPromptEnhancementRequest = {
  projectId: string;
  workflowId: string;
  workflowRevisionId: string;
  sourcePrompt: string;
  inputMode: VideoPromptInputMode;
  sourceId?: string | null;
  videoDurationSeconds: VideoDurationSeconds;
  idempotencyKey: string;
};

export type VideoPromptEnhancementResponse = { promptEnhancement: VideoPromptEnhancement };

export type VideoPromptEnhancementStamp = {
  schemaVersion: "creative-studio-video-prompt-enhancement/1.0";
  requestId: string;
  generationWorkflowId: string;
  generationWorkflowRevisionId: string;
  enhancementWorkflowRevisionId: string;
  sourcePrompt: string;
  enhancedPrompt: string;
  basePrompt: string;
  appliedPrompt: string;
  editedAfterEnhancement: boolean;
  provider: "local-comfyui";
  workflowId: "gemma4-video-prompt-enhancer";
  workflowVersion: 1;
  model: typeof GEMMA_VIDEO_PROMPT_MODEL;
  comfyPromptId: string;
  sourceWordCount: number;
  enhancedWordCount: number;
  createdAt: IsoDateString;
  promptProfileId: VideoPromptProfileId;
  targetModel: string;
  outputFormat: VideoPromptOutputFormat;
};

export type RunnerPromptEnhancementSource = {
  id: string;
  projectId: string;
  kind: "image" | "video";
  name: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  source: "upload" | "artifact";
};
export type RunnerPromptEnhancementBundle = { promptEnhancement: VideoPromptEnhancement; source: RunnerPromptEnhancementSource | null };
export type RunnerPromptEnhancementHeartbeatRequest = { progress: number };
export type RunnerCompletePromptEnhancementRequest = { enhancedPrompt: string; comfyPromptId: string };
export type RunnerFailPromptEnhancementRequest = { error: string };
