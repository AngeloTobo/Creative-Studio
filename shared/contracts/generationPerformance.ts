import type { GenerationExecutionStage, GenerationSettingsStamp, Job } from "./domain";
import type { WorkflowParameter, WorkflowScalar } from "./workflows";

export const GENERATION_LONG_RUN_THRESHOLD_MS = 20 * 60_000;
export const COMFY_OBSERVATION_STALE_THRESHOLD_MS = 45_000;
export const RUNNER_HEARTBEAT_FRESH_THRESHOLD_MS = 3 * 60_000;
export const FAST_IMAGE_MAX_PIXELS = 512 * 512;
export const FAST_IMAGE_MAX_STEPS = 8;
export const FAST_IMAGE_MAX_BATCH = 1;
export const FAST_VIDEO_MAX_DURATION_SECONDS = 5;
export const FAST_VIDEO_MAX_MEGAPIXELS = 0.2;
export const FAST_VIDEO_MEGAPIXEL_TOLERANCE = 0.035;
export const FAST_VIDEO_MAX_FPS = 30;

export type GenerationWorkload = {
  width: number | null;
  height: number | null;
  megapixels: number | null;
  steps: number | null;
  frames: number | null;
  durationSeconds: number | null;
  fps: number | null;
  batchSize: number | null;
  modelCount: number;
  inputCount: number;
  promptCharacters: number;
  facts: string[];
  likelyContributors: string[];
  promptAssessment: string;
};

export type GenerationProviderWorkloadProfile = {
  profileId: string;
  label: string;
  parameters: Record<string, string | number | boolean>;
  models: string[];
};

export type WorkflowRuntimeHistory = {
  count: number;
  medianMs: number | null;
  fastestMs: number | null;
};

export type GenerationTiming = {
  totalMs: number;
  queueMs: number | null;
  executionMs: number | null;
  isLongRunning: boolean;
  stage: GenerationExecutionStage;
  stageLabel: string;
  comfyObservationAgeMs: number | null;
  comfyApiUnresponsive: boolean;
};

export type ImagePerformanceAssessment = {
  requiresExplicitCustom: boolean;
  reasons: string[];
};

export type VideoPerformanceAssessment = {
  requiresExplicitHeavy: boolean;
  reasons: string[];
  workload: Pick<GenerationWorkload, "durationSeconds" | "width" | "height" | "megapixels" | "frames" | "fps">;
};

type WorkloadSource = Pick<GenerationSettingsStamp, "parameters" | "models" | "inputAssetIds" | "inputArtifactIds" | "prompt">
  & { videoDurationSeconds?: number };

const AFDFW_Z_IMAGE_PROFILE: GenerationProviderWorkloadProfile = {
  profileId: "afdfw-z-image-bridge-v1",
  label: "AFDFW Z-Image bridge profile v1",
  parameters: {
    medium: "Digital Art",
    size: "portrait",
    width: 768,
    height: 1216,
    steps: 32,
    frames: 1,
    batch_size: 1,
  },
  models: ["z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors", "ae.safetensors"],
};

export function generationProviderWorkloadProfile(provider: string, modality: string): GenerationProviderWorkloadProfile | null {
  if (provider !== "afdfw-z-image" || modality !== "image") return null;
  return {
    ...AFDFW_Z_IMAGE_PROFILE,
    parameters: { ...AFDFW_Z_IMAGE_PROFILE.parameters },
    models: [...AFDFW_Z_IMAGE_PROFILE.models],
  };
}

export function withGenerationProviderWorkload(stamp: GenerationSettingsStamp): GenerationSettingsStamp {
  const profile = generationProviderWorkloadProfile(stamp.provider, stamp.modality);
  if (!profile) return stamp;
  return {
    ...stamp,
    parameters: { ...profile.parameters, ...stamp.parameters },
    models: stamp.models.length ? stamp.models : profile.models,
    workloadEvidence: stamp.workloadEvidence ?? {
      source: "provider-profile",
      profileId: profile.profileId,
      label: profile.label,
    },
  };
}

const STAGE_LABELS: Record<GenerationExecutionStage, string> = {
  queued: "Waiting in Creative Studio",
  "provider-queued": "Waiting in provider queue",
  "preparing-inputs": "Preparing retained inputs",
  "enhancing-prompt": "Enhancing song prompt with Gemma 4",
  submitting: "Submitting workflow",
  rendering: "Rendering in ComfyUI",
  "downloading-output": "Downloading generated output",
  "post-processing": "Joining video extension",
  retaining: "Verifying retained result",
  completed: "Completed and retained",
  failed: "Failed",
  cancelled: "Tracking cancelled",
};

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parameterName(id: string) {
  return (id.split("::").at(-1) ?? id).replaceAll("-", "_").toLowerCase();
}

function parameterGroup(id: string) {
  const parts = id.split("::");
  return parts.length > 1 ? parts.slice(0, -1).join("::") : "root";
}

function maximumParameter(parameters: GenerationSettingsStamp["parameters"], names: string[]) {
  const values = Object.entries(parameters)
    .filter(([id]) => names.includes(parameterName(id)))
    .map(([, value]) => finiteNumber(value))
    .filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}

function compactNumber(value: number) {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function roundedDimension(value: number) {
  return Math.max(64, Math.floor(value / 8) * 8);
}

function workflowParameterIdentity(parameter: WorkflowParameter) {
  const inputName = parameter.binding.format === "comfyui-api" ? parameter.binding.inputName : "";
  return `${parameter.id} ${parameter.label} ${inputName}`.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

function semanticParameterMaximum(parameters: WorkflowParameter[], names: string[]) {
  const expressions = names.map((name) => new RegExp(`(?:^|\\s)${name.replaceAll("_", "[ _]")}(?:$|\\s)`, "i"));
  const values = parameters
    .filter((parameter) => expressions.some((expression) => expression.test(workflowParameterIdentity(parameter))))
    .map((parameter) => finiteNumber(parameter.value))
    .filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}

/** Projects semantically labelled Comfy primitive controls into stable aliases before workload analysis. */
export function canonicalGenerationPerformanceParameters(parameters: WorkflowParameter[]) {
  const values: GenerationSettingsStamp["parameters"] = Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter.value]));
  const aliases = {
    width: semanticParameterMaximum(parameters, ["width"]),
    height: semanticParameterMaximum(parameters, ["height"]),
    megapixels: semanticParameterMaximum(parameters, ["megapixels"]),
    fps: semanticParameterMaximum(parameters, ["fps", "frame_rate"]),
    frames: semanticParameterMaximum(parameters, ["frames", "frame_count", "num_frames"]),
    steps: semanticParameterMaximum(parameters, ["steps", "sampling_steps"]),
    batch_size: semanticParameterMaximum(parameters, ["batch", "batch_size"]),
  };
  for (const [name, value] of Object.entries(aliases)) {
    if (value !== null) values[`creative-studio::${name}`] = value;
  }
  return values;
}

/** Returns only safe workload overrides; creative controls such as prompt, seed, model, sampler, CFG, and denoise are unchanged. */
export function fastImageParameterOverrides(parameters: WorkflowParameter[]) {
  const overrides: Record<string, WorkflowScalar> = {};
  const dimensions = new Map<string, { width?: WorkflowParameter; height?: WorkflowParameter }>();
  for (const parameter of parameters) {
    const name = parameterName(parameter.id);
    const value = finiteNumber(parameter.value);
    if (value === null) continue;
    if (name === "width" || name === "height") {
      const group = parameterGroup(parameter.id);
      const pair = dimensions.get(group) ?? {};
      pair[name] = parameter;
      dimensions.set(group, pair);
      continue;
    }
    if (name === "megapixels" && value > FAST_IMAGE_MAX_PIXELS / 1_000_000) {
      overrides[parameter.id] = FAST_IMAGE_MAX_PIXELS / 1_000_000;
    } else if (["steps", "sampling_steps"].includes(name) && value > FAST_IMAGE_MAX_STEPS) {
      overrides[parameter.id] = FAST_IMAGE_MAX_STEPS;
    } else if (["batch", "batch_size", "image_count", "num_images", "frames", "frame_count", "num_frames"].includes(name) && value > FAST_IMAGE_MAX_BATCH) {
      overrides[parameter.id] = FAST_IMAGE_MAX_BATCH;
    }
  }

  for (const pair of dimensions.values()) {
    const width = pair.width ? finiteNumber(pair.width.value) : null;
    const height = pair.height ? finiteNumber(pair.height.value) : null;
    if (pair.width && pair.height && width && height && width * height > FAST_IMAGE_MAX_PIXELS) {
      const scale = Math.sqrt(FAST_IMAGE_MAX_PIXELS / (width * height));
      let nextWidth = roundedDimension(width * scale);
      let nextHeight = roundedDimension(height * scale);
      while (nextWidth * nextHeight > FAST_IMAGE_MAX_PIXELS && (nextWidth > 64 || nextHeight > 64)) {
        if (nextWidth >= nextHeight && nextWidth > 64) nextWidth -= 8;
        else if (nextHeight > 64) nextHeight -= 8;
      }
      overrides[pair.width.id] = nextWidth;
      overrides[pair.height.id] = nextHeight;
    } else {
      if (pair.width && width && width > 512) overrides[pair.width.id] = 512;
      if (pair.height && height && height > 512) overrides[pair.height.id] = 512;
    }
  }
  return overrides;
}

export function assessImagePerformance(parameters: GenerationSettingsStamp["parameters"]): ImagePerformanceAssessment {
  const workload = analyzeGenerationWorkload({ parameters, models: [], inputAssetIds: [], inputArtifactIds: [], prompt: "" });
  const hasResolutionEvidence = (workload.width !== null && workload.height !== null) || workload.megapixels !== null;
  const reasons: string[] = [];
  if (!hasResolutionEvidence) reasons.push("resolution is not exposed by this workflow");
  if (workload.steps === null) reasons.push("sampling steps are not exposed by this workflow");
  if (workload.megapixels !== null && workload.megapixels > FAST_IMAGE_MAX_PIXELS / 1_000_000 + 0.000001) {
    reasons.push(`${compactNumber(workload.megapixels)} MP exceeds the ${compactNumber(FAST_IMAGE_MAX_PIXELS / 1_000_000)} MP fast limit`);
  }
  if (workload.steps !== null && workload.steps > FAST_IMAGE_MAX_STEPS) reasons.push(`${compactNumber(workload.steps)} steps exceeds the ${FAST_IMAGE_MAX_STEPS}-step fast limit`);
  if (workload.batchSize !== null && workload.batchSize > FAST_IMAGE_MAX_BATCH) reasons.push(`batch size ${compactNumber(workload.batchSize)} exceeds the one-image fast limit`);
  if (workload.frames !== null && workload.frames > 1) reasons.push(`${compactNumber(workload.frames)} output frames exceeds the one-image fast limit`);
  return { requiresExplicitCustom: reasons.length > 0, reasons };
}

/**
 * The single authoritative fast-video boundary used by both browser and Worker.
 * It evaluates only immutable workflow-revision parameters plus the normalized
 * requested duration. A small megapixel tolerance covers rounded 0.2 MP
 * portrait/widescreen dimensions without admitting the 0.5 MP tier.
 */
export function assessVideoPerformance(source: WorkloadSource): VideoPerformanceAssessment {
  const analyzed = analyzeGenerationWorkload(source);
  const inferredDuration = analyzed.durationSeconds === null && analyzed.frames !== null && analyzed.fps !== null && analyzed.fps > 0
    ? Math.max(0, (analyzed.frames - 1) / analyzed.fps)
    : null;
  const durationSeconds = analyzed.durationSeconds ?? inferredDuration;
  const reasons: string[] = [];
  if (durationSeconds === null) reasons.push("duration is not exposed by this workflow");
  else if (durationSeconds > FAST_VIDEO_MAX_DURATION_SECONDS) {
    reasons.push(`${compactNumber(durationSeconds)}s exceeds the ${FAST_VIDEO_MAX_DURATION_SECONDS}s fast limit`);
  }
  if (analyzed.megapixels === null) reasons.push("resolution is not exposed by this workflow");
  else if (analyzed.megapixels
    && analyzed.megapixels > FAST_VIDEO_MAX_MEGAPIXELS + FAST_VIDEO_MEGAPIXEL_TOLERANCE) {
    reasons.push(`${compactNumber(analyzed.megapixels)} MP exceeds the ${compactNumber(FAST_VIDEO_MAX_MEGAPIXELS)} MP fast limit`);
  }
  if (analyzed.fps !== null && analyzed.fps > FAST_VIDEO_MAX_FPS) {
    reasons.push(`${compactNumber(analyzed.fps)} fps exceeds the ${FAST_VIDEO_MAX_FPS} fps fast limit`);
  }
  if (analyzed.frames !== null && durationSeconds !== null && analyzed.fps !== null && analyzed.fps > 0) {
    const expectedFrames = Math.round(durationSeconds * analyzed.fps) + 1;
    const tolerance = Math.max(2, Math.ceil(expectedFrames * 0.05));
    if (analyzed.frames > expectedFrames + tolerance) {
      reasons.push(`${compactNumber(analyzed.frames)} frames exceeds the ${compactNumber(durationSeconds)}s at ${compactNumber(analyzed.fps)} fps timeline`);
    }
  } else if (analyzed.frames !== null && durationSeconds !== null) {
    const safeFrames = Math.round(durationSeconds * FAST_VIDEO_MAX_FPS) + 1;
    const tolerance = Math.max(2, Math.ceil(safeFrames * 0.05));
    if (analyzed.frames > safeFrames + tolerance) {
      reasons.push(`${compactNumber(analyzed.frames)} frames exceeds the ${compactNumber(durationSeconds)}s fast timeline without exposed fps`);
    }
  }
  return {
    requiresExplicitHeavy: reasons.length > 0,
    reasons,
    workload: {
      durationSeconds,
      width: analyzed.width,
      height: analyzed.height,
      megapixels: analyzed.megapixels,
      frames: analyzed.frames,
      fps: analyzed.fps,
    },
  };
}

export function analyzeGenerationWorkload(source: WorkloadSource): GenerationWorkload {
  const width = maximumParameter(source.parameters, ["width"]);
  const height = maximumParameter(source.parameters, ["height"]);
  const declaredMegapixels = maximumParameter(source.parameters, ["megapixels"]);
  const computedMegapixels = width && height ? width * height / 1_000_000 : null;
  const megapixels = computedMegapixels !== null && declaredMegapixels !== null
    ? Math.max(computedMegapixels, declaredMegapixels)
    : computedMegapixels ?? declaredMegapixels;
  const steps = maximumParameter(source.parameters, ["steps", "sampling_steps"]);
  const frames = maximumParameter(source.parameters, ["frames", "frame_count", "num_frames"]);
  const durationSeconds = source.videoDurationSeconds ?? maximumParameter(source.parameters, ["seconds", "duration", "max_duration"]);
  const fps = maximumParameter(source.parameters, ["fps", "frame_rate"]);
  const batchSize = maximumParameter(source.parameters, ["batch_size", "batch"]);
  const modelCount = new Set(source.models.filter(Boolean)).size;
  const inputCount = new Set([...(source.inputAssetIds ?? []), ...(source.inputArtifactIds ?? [])]).size;
  const promptCharacters = source.prompt.trim().length;
  const facts: string[] = [];
  if (width && height) facts.push(`${Math.round(width)}×${Math.round(height)} · ${compactNumber(megapixels ?? 0)} MP`);
  else if (megapixels) facts.push(`${compactNumber(megapixels)} MP target`);
  if (steps) facts.push(`${compactNumber(steps)} steps`);
  if (frames) facts.push(`${compactNumber(frames)} ${frames === 1 ? "frame" : "frames"}`);
  if (durationSeconds) facts.push(`${compactNumber(durationSeconds)}s duration`);
  if (fps) facts.push(`${compactNumber(fps)} fps`);
  if (batchSize && batchSize > 1) facts.push(`batch ${compactNumber(batchSize)}`);
  if (modelCount) facts.push(`${modelCount} ${modelCount === 1 ? "model" : "models"}`);
  if (inputCount) facts.push(`${inputCount} retained ${inputCount === 1 ? "input" : "inputs"}`);

  const likelyContributors: string[] = [];
  if (megapixels && megapixels >= 1) likelyContributors.push(`${compactNumber(megapixels)} MP frame size`);
  if (steps && steps >= 25) likelyContributors.push(`${compactNumber(steps)} sampling steps`);
  if (frames && frames > 1) likelyContributors.push(`${compactNumber(frames)} generated frames`);
  else if (durationSeconds && durationSeconds > 2) likelyContributors.push(`${compactNumber(durationSeconds)}s generated duration`);
  if (batchSize && batchSize > 1) likelyContributors.push(`batch size ${compactNumber(batchSize)}`);
  if (modelCount > 2) likelyContributors.push(`${modelCount} model files and possible first-run loading`);
  if (inputCount) likelyContributors.push("input decoding or preprocessing");

  const promptAssessment = promptCharacters > 8_000
    ? `The prompt is unusually long (${promptCharacters.toLocaleString()} characters), so text encoding may add setup time; sampling is still usually the larger cost.`
    : `The prompt is ${promptCharacters.toLocaleString()} characters; prompt wording is unlikely to be the main render-time cause.`;
  return {
    width, height, megapixels, steps, frames, durationSeconds, fps, batchSize,
    modelCount, inputCount, promptCharacters, facts, likelyContributors, promptAssessment,
  };
}

function inferredStage(job: Job): GenerationExecutionStage {
  if (job.executionStage) return job.executionStage;
  if (job.status === "completed") return "completed";
  if (job.status === "failed") return "failed";
  if (job.status === "cancelled") return "cancelled";
  if (job.artifactId) return "retaining";
  if (job.status === "running") return "rendering";
  return "queued";
}

export function generationTiming(job: Job, now = new Date().toISOString()): GenerationTiming {
  const created = new Date(job.createdAt).getTime();
  const started = job.startedAt ? new Date(job.startedAt).getTime() : Number.NaN;
  const ended = job.completedAt ? new Date(job.completedAt).getTime() : new Date(now).getTime();
  const safeCreated = Number.isFinite(created) ? created : ended;
  const totalMs = Math.max(0, ended - safeCreated);
  const queueMs = Number.isFinite(started) ? Math.max(0, started - safeCreated) : null;
  const executionMs = Number.isFinite(started) ? Math.max(0, ended - started) : null;
  const active = job.status === "queued" || job.status === "running";
  const longElapsed = executionMs ?? totalMs;
  const stage = inferredStage(job);
  const updatedAt = new Date(job.updatedAt).getTime();
  const stageUpdatedAt = job.stageUpdatedAt ? new Date(job.stageUpdatedAt).getTime() : Number.NaN;
  const observationAgeMs = stage === "rendering" && Number.isFinite(stageUpdatedAt)
    ? Math.max(0, ended - stageUpdatedAt)
    : null;
  const observationLagMs = Number.isFinite(updatedAt) && Number.isFinite(stageUpdatedAt)
    ? Math.max(0, updatedAt - stageUpdatedAt)
    : 0;
  const runnerHeartbeatFresh = Number.isFinite(updatedAt)
    && Math.max(0, ended - updatedAt) <= RUNNER_HEARTBEAT_FRESH_THRESHOLD_MS;
  const comfyApiUnresponsive = active
    && stage === "rendering"
    && runnerHeartbeatFresh
    && observationLagMs >= COMFY_OBSERVATION_STALE_THRESHOLD_MS;
  return {
    totalMs,
    queueMs,
    executionMs,
    isLongRunning: active && longElapsed >= GENERATION_LONG_RUN_THRESHOLD_MS,
    stage,
    stageLabel: comfyApiUnresponsive ? "ComfyUI API unresponsive; GPU may still be rendering" : STAGE_LABELS[stage],
    comfyObservationAgeMs: observationAgeMs,
    comfyApiUnresponsive,
  };
}

function completedExecutionMs(job: Job) {
  if (job.status !== "completed" || !job.startedAt || !job.completedAt) return null;
  const value = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function workflowRuntimeHistory(jobs: Job[], revisionId: string): WorkflowRuntimeHistory {
  const durations = jobs
    .filter((job) => job.settingsStamp.workflow?.revisionId === revisionId)
    .map(completedExecutionMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (!durations.length) return { count: 0, medianMs: null, fastestMs: null };
  const middle = Math.floor(durations.length / 2);
  const medianMs = durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2;
  return { count: durations.length, medianMs, fastestMs: durations[0] };
}

export function formatGenerationDuration(milliseconds: number | null) {
  if (milliseconds === null) return "not measured";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
