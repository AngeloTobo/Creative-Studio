import type { VideoSpeechMode, VideoSpeechStamp } from "../../../shared/contracts";

const VIDEO_SPEECH_LABELS: Record<VideoSpeechMode, string> = {
  "no-speech": "No dialogue",
  "short-natural-line": "Simple line",
  "exact-script": "Exact script",
};

export function videoSpeechLabel(speech: Pick<VideoSpeechStamp, "mode">) {
  return VIDEO_SPEECH_LABELS[speech.mode];
}

export function videoSpeechSummary(speech: Pick<VideoSpeechStamp, "mode" | "spokenText">) {
  const label = videoSpeechLabel(speech);
  if (speech.mode === "no-speech") return `${label} · designed sound remains`;
  const spokenText = speech.spokenText?.trim();
  return spokenText ? `${label} · “${spokenText}”` : label;
}
