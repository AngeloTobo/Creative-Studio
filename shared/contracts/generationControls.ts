import type { GenerationWorkload } from "./generationPerformance";
import { canonicalWorkflowParameterValue, type WorkflowParameter, type WorkflowScalar } from "./workflows";

export const GENERATION_ASPECT_PRESETS = [
  { id: "1:1", label: "Square", ratio: 1 },
  { id: "9:16", label: "Portrait", ratio: 9 / 16 },
  { id: "16:9", label: "Wide", ratio: 16 / 9 },
  { id: "3:4", label: "Tall", ratio: 3 / 4 },
  { id: "4:3", label: "Classic", ratio: 4 / 3 },
] as const;

export const IMAGE_MEGAPIXEL_PRESETS = [0.25, 0.5, 1] as const;
export const VIDEO_MEGAPIXEL_PRESETS = [0.2, 0.5, 0.9] as const;
export const GENERATION_STEP_PRESETS = [8, 16, 24, 32] as const;
export const GENERATION_FPS_PRESETS = [16, 24, 30] as const;

export type GenerationAspectRatio = typeof GENERATION_ASPECT_PRESETS[number]["id"];
export type GenerationControlKind = "aspect" | "megapixels" | "width" | "height" | "steps" | "fps" | "seed";

export type GenerationControlSet = {
  aspect: WorkflowParameter[];
  megapixels: WorkflowParameter[];
  width: WorkflowParameter[];
  height: WorkflowParameter[];
  steps: WorkflowParameter[];
  fps: WorkflowParameter[];
  seed: WorkflowParameter[];
  parameterIds: Set<string>;
};

export type GenerationRuntimeEstimate = {
  perOutputLowMs: number;
  perOutputHighMs: number;
  totalLowMs: number;
  totalHighMs: number;
  workloadScale: number;
};

function normalizedIdentity(parameter: WorkflowParameter) {
  const inputName = parameter.binding.format === "comfyui-api" ? parameter.binding.inputName : "";
  const idName = parameter.id.split("::").at(-1) ?? parameter.id;
  return `${inputName} ${idName} ${parameter.label}`.replaceAll("-", "_").toLowerCase();
}

function matches(parameter: WorkflowParameter, names: string[]) {
  const identity = normalizedIdentity(parameter);
  return names.some((name) => new RegExp(`(?:^|[^a-z0-9])${name.replaceAll("_", "[_\\s]")}(?:$|[^a-z0-9])`, "i").test(identity));
}

export function generationControlSet(parameters: WorkflowParameter[]): GenerationControlSet {
  const controls = {
    aspect: parameters.filter((parameter) => matches(parameter, ["aspect_ratio"])),
    megapixels: parameters.filter((parameter) => matches(parameter, ["megapixels"])),
    width: parameters.filter((parameter) => matches(parameter, ["width"])),
    height: parameters.filter((parameter) => matches(parameter, ["height"])),
    steps: parameters.filter((parameter) => matches(parameter, ["steps", "sampling_steps"])),
    fps: parameters.filter((parameter) => matches(parameter, ["fps", "frame_rate"])),
    seed: parameters.filter((parameter) => matches(parameter, ["seed", "noise_seed"])),
  };
  return {
    ...controls,
    parameterIds: new Set(Object.values(controls).flat().map((parameter) => parameter.id)),
  };
}

function finitePositive(value: WorkflowScalar | undefined) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function aspectId(value: WorkflowScalar | undefined): GenerationAspectRatio | null {
  if (typeof value !== "string") return null;
  const shorthand = value.trim().match(/^\d+:\d+/)?.[0];
  return GENERATION_ASPECT_PRESETS.some((preset) => preset.id === shorthand) ? shorthand as GenerationAspectRatio : null;
}

export function inferGenerationAspectRatio(parameters: WorkflowParameter[]) {
  const controls = generationControlSet(parameters);
  const direct = controls.aspect.map((parameter) => aspectId(parameter.value)).find(Boolean);
  if (direct) return direct;
  const width = finitePositive(controls.width[0]?.value);
  const height = finitePositive(controls.height[0]?.value);
  if (!width || !height) return null;
  const ratio = width / height;
  const closest = GENERATION_ASPECT_PRESETS.reduce<{ id: GenerationAspectRatio; distance: number } | null>((current, preset) => {
    const distance = Math.abs(ratio - preset.ratio) / preset.ratio;
    return !current || distance < current.distance ? { id: preset.id, distance } : current;
  }, null);
  return closest && closest.distance <= 0.04 ? closest.id : null;
}

export function inferGenerationMegapixels(parameters: WorkflowParameter[]) {
  const controls = generationControlSet(parameters);
  const declared = finitePositive(controls.megapixels[0]?.value);
  if (declared) return declared;
  const width = finitePositive(controls.width[0]?.value);
  const height = finitePositive(controls.height[0]?.value);
  return width && height ? width * height / 1_000_000 : null;
}

function roundedDimension(value: number) {
  return Math.max(64, Math.round(value / 8) * 8);
}

export function generationCanvasOverrides(
  parameters: WorkflowParameter[],
  aspect: GenerationAspectRatio | null,
  megapixels: number | null,
) {
  const controls = generationControlSet(parameters);
  const overrides: Record<string, WorkflowScalar> = {};
  const currentAspect = aspect ?? inferGenerationAspectRatio(parameters);
  const currentMegapixels = megapixels ?? inferGenerationMegapixels(parameters);
  if (aspect) {
    for (const parameter of controls.aspect) overrides[parameter.id] = canonicalWorkflowParameterValue(parameter, aspect);
  }
  if (megapixels) {
    for (const parameter of controls.megapixels) overrides[parameter.id] = megapixels;
  }
  if (currentAspect && currentMegapixels && controls.width.length && controls.height.length) {
    const ratio = GENERATION_ASPECT_PRESETS.find((preset) => preset.id === currentAspect)!.ratio;
    const width = roundedDimension(Math.sqrt(currentMegapixels * 1_000_000 * ratio));
    const height = roundedDimension(width / ratio);
    for (const parameter of controls.width) overrides[parameter.id] = width;
    for (const parameter of controls.height) overrides[parameter.id] = height;
  }
  return overrides;
}

function safeRatio(current: number | null, baseline: number | null) {
  return current !== null && baseline !== null && current > 0 && baseline > 0 ? current / baseline : null;
}

/** An evidence-based range, not a completion guarantee. It scales a completed-run median by exposed workload controls only. */
export function estimateGenerationRuntime(
  historicalMedianMs: number | null,
  current: GenerationWorkload | null,
  baseline: GenerationWorkload | null,
  outputCount = 1,
): GenerationRuntimeEstimate | null {
  if (!historicalMedianMs || !current || !baseline || outputCount < 1) return null;
  const ratios = [
    safeRatio(current.megapixels, baseline.megapixels),
    safeRatio(current.steps, baseline.steps),
    safeRatio(current.durationSeconds, baseline.durationSeconds),
    safeRatio(current.frames, baseline.frames),
    safeRatio(current.batchSize, baseline.batchSize),
  ].filter((ratio): ratio is number => ratio !== null);
  const workloadScale = Math.min(20, Math.max(0.15, ratios.reduce((scale, ratio) => scale * ratio, 1)));
  const projected = historicalMedianMs * workloadScale;
  const perOutputLowMs = Math.max(1_000, projected * 0.75);
  const perOutputHighMs = Math.max(perOutputLowMs, projected * 1.5);
  return {
    perOutputLowMs,
    perOutputHighMs,
    totalLowMs: perOutputLowMs * outputCount,
    totalHighMs: perOutputHighMs * outputCount,
    workloadScale,
  };
}
