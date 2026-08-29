import {
  FAST_VIDEO_MAX_DURATION_SECONDS,
  FAST_VIDEO_MAX_MEGAPIXELS,
  assessVideoPerformance,
  type VideoDurationSeconds,
  type VideoPerformanceAssessment,
  type VideoPerformanceMode,
} from "../../../shared/contracts";

export type VideoCreateEntryMode = "standard" | "four-way";

export const ONE_CLICK_VIDEO_DURATION_SECONDS: VideoDurationSeconds = FAST_VIDEO_MAX_DURATION_SECONDS;
export const ONE_CLICK_VIDEO_MEGAPIXELS = FAST_VIDEO_MAX_MEGAPIXELS;

export function videoRenderConsentSignature(input: {
  workflowRevisionId: string | null;
  workload: VideoPerformanceAssessment["workload"] | null;
  outputCount: number;
}) {
  return JSON.stringify(input);
}

export function videoPerformanceModeForArmedConsent(input: {
  requiresExplicitHeavy: boolean;
  currentSignature: string;
  armedSignature: string;
}): VideoPerformanceMode | null {
  if (!input.requiresExplicitHeavy) return "fast-default";
  return input.armedSignature === input.currentSignature ? "explicit-heavy" : null;
}

export function oneClickVideoSettings(mode: VideoCreateEntryMode) {
  return {
    durationSeconds: ONE_CLICK_VIDEO_DURATION_SECONDS,
    megapixels: ONE_CLICK_VIDEO_MEGAPIXELS,
    outputCount: mode === "four-way" ? 4 as const : 2 as const,
  };
}

export function videoRenderNeedsConfirmation(input: {
  durationSeconds: VideoDurationSeconds;
  megapixels: number | null;
  fps?: number | null;
  exposedFrames?: number | null;
}) {
  return assessVideoPerformance({
    parameters: {
      ...(input.megapixels === null ? {} : { megapixels: input.megapixels }),
      ...(input.fps === null || input.fps === undefined ? {} : { fps: input.fps }),
      ...(input.exposedFrames === null || input.exposedFrames === undefined ? {} : { frames: input.exposedFrames }),
    },
    models: [],
    inputAssetIds: [],
    inputArtifactIds: [],
    prompt: "",
    videoDurationSeconds: input.durationSeconds,
  }).requiresExplicitHeavy;
}

/** Comfy video workflows commonly retain the starting frame in addition to duration * fps. */
export function videoRenderFrameCount(input: {
  durationSeconds: VideoDurationSeconds;
  fps: number | null;
  exposedFrames: number | null;
}) {
  if (input.exposedFrames !== null && Number.isFinite(input.exposedFrames) && input.exposedFrames > 0) {
    return Math.round(input.exposedFrames);
  }
  if (input.fps !== null && Number.isFinite(input.fps) && input.fps > 0) {
    return Math.round(input.durationSeconds * input.fps) + 1;
  }
  return null;
}
