import type { GenerationSettingsStamp } from "./domain";
import {
  canonicalWorkflowParameterValue,
  type WorkflowDefinition,
  type WorkflowParameter,
  type WorkflowParameterKind,
  type WorkflowScalar,
} from "./workflows";

export const TRUSTED_VIDEO_PRESET_SCHEMA_VERSION = "creative-studio-trusted-video-preset/1.0" as const;
export const TRUSTED_LTX_25_I2V_PORTRAIT_30S_ID = "ltx-2.5-i2v-portrait-30s-rtx3090-v1" as const;

export type TrustedVideoPresetId = typeof TRUSTED_LTX_25_I2V_PORTRAIT_30S_ID;

export type TrustedVideoPresetEvidence = Readonly<{
  kind: "measured-local-runtime";
  verifiedAt: string;
  hardware: string;
  completedRuns: number;
  terminalRuns: number;
  medianMs: number;
  fastestMs: number;
  slowestMs: number;
  qualityStatus: "unreviewed";
}>;

export type TrustedVideoGraphParameter = Readonly<{
  id: string;
  nodeId: string;
  inputName: string;
  kind: WorkflowParameterKind;
  mediaKind: WorkflowParameter["mediaKind"];
}>;

export type TrustedVideoPresetDefinition = Readonly<{
  schemaVersion: typeof TRUSTED_VIDEO_PRESET_SCHEMA_VERSION;
  id: TrustedVideoPresetId;
  label: string;
  shortLabel: string;
  strategy: "native-single-pass";
  workflowFamily: "ltx-2.5-image-to-video";
  settings: Readonly<{
    durationSeconds: 30;
    aspectRatio: "9:16";
    megapixels: 0.2;
    fps: 24;
    frames: 721;
    outputCount: 1;
    sampler: "euler_ancestral";
    videoCfg: 1;
    audioCfg: 1;
    batchSize: 1;
    promptEnhancement: true;
  }>;
  graphFamily: Readonly<{
    format: "comfyui-api";
    nodeCount: 50;
    sha256: string;
    parameterBindings: readonly TrustedVideoGraphParameter[];
    firstPassSteps: 8;
    refinePassSteps: 3;
    latentUpscale: "2x";
    decode: "tiled-vae";
  }>;
  requiredModels: readonly string[];
  evidence: TrustedVideoPresetEvidence;
}>;

export type TrustedVideoPresetStamp = Readonly<{
  schemaVersion: typeof TRUSTED_VIDEO_PRESET_SCHEMA_VERSION;
  id: TrustedVideoPresetId;
  label: string;
  strategy: "native-single-pass";
  verifiedAt: string;
  hardware: string;
  graphFamily: Readonly<{
    sha256: string;
    nodeCount: 50;
    firstPassSteps: 8;
    refinePassSteps: 3;
    latentUpscale: "2x";
    decode: "tiled-vae";
  }>;
  evidence: Readonly<{
    completedRuns: number;
    terminalRuns: number;
    medianMs: number;
    fastestMs: number;
    slowestMs: number;
    qualityStatus: "unreviewed";
  }>;
}>;

export type TrustedVideoPresetAssessment = Readonly<{
  supported: boolean;
  matches: boolean;
  reasons: readonly string[];
}>;

export type ThirtySecondVideoStrategySimulation = Readonly<{
  id: "native-30" | "two-by-15" | "three-by-10" | "six-by-5";
  label: string;
  segmentCount: number;
  segmentSeconds: number;
  simulatedMedianMs: number;
  p10Ms: number;
  p90Ms: number;
  evidence: "measured" | "interpolated";
  sampleCount: number;
  excludesJoinOverhead: boolean;
}>;

const REQUIRED_LTX_MODELS = [
  "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
  "gemma4_e2b_it_bf16.safetensors",
  "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
  "ltx-2.5-audio-vae-bf16.safetensors",
  "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
  "ltx-2.5-video-vae-bf16.safetensors",
] as const;

const TRUSTED_GRAPH_PARAMETERS: readonly TrustedVideoGraphParameter[] = [
  { id: "395::image", nodeId: "395", inputName: "image", kind: "media", mediaKind: "image" },
  { id: "403::aspect_ratio", nodeId: "403", inputName: "aspect_ratio", kind: "choice", mediaKind: null },
  { id: "403::megapixels", nodeId: "403", inputName: "megapixels", kind: "number", mediaKind: null },
  { id: "398:380::thinking", nodeId: "398:380", inputName: "thinking", kind: "boolean", mediaKind: null },
  { id: "398:383::value", nodeId: "398:383", inputName: "value", kind: "boolean", mediaKind: null },
  { id: "398:376::value", nodeId: "398:376", inputName: "value", kind: "text", mediaKind: null },
  { id: "398:362::value", nodeId: "398:362", inputName: "value", kind: "number", mediaKind: null },
  { id: "398:363::value", nodeId: "398:363", inputName: "value", kind: "boolean", mediaKind: null },
  { id: "398:373::text", nodeId: "398:373", inputName: "text", kind: "text", mediaKind: null },
  { id: "398:352::sampler_name", nodeId: "398:352", inputName: "sampler_name", kind: "choice", mediaKind: null },
  { id: "398:339::noise_seed", nodeId: "398:339", inputName: "noise_seed", kind: "number", mediaKind: null },
  { id: "398:361::value", nodeId: "398:361", inputName: "value", kind: "number", mediaKind: null },
  { id: "398:388::video_cfg", nodeId: "398:388", inputName: "video_cfg", kind: "number", mediaKind: null },
  { id: "398:388::audio_cfg", nodeId: "398:388", inputName: "audio_cfg", kind: "number", mediaKind: null },
  { id: "398:357::strength", nodeId: "398:357", inputName: "strength", kind: "number", mediaKind: null },
  { id: "398:366::batch_size", nodeId: "398:366", inputName: "batch_size", kind: "number", mediaKind: null },
  { id: "398:356::batch_size", nodeId: "398:356", inputName: "batch_size", kind: "number", mediaKind: null },
  { id: "398:349::strength", nodeId: "398:349", inputName: "strength", kind: "number", mediaKind: null },
  { id: "398:338::noise_seed", nodeId: "398:338", inputName: "noise_seed", kind: "number", mediaKind: null },
  { id: "398:391::video_cfg", nodeId: "398:391", inputName: "video_cfg", kind: "number", mediaKind: null },
  { id: "398:391::audio_cfg", nodeId: "398:391", inputName: "audio_cfg", kind: "number", mediaKind: null },
  { id: "398:341::sampler_name", nodeId: "398:341", inputName: "sampler_name", kind: "choice", mediaKind: null },
] as const;

const EXACT_PARAMETER_OVERRIDES: Readonly<Record<string, WorkflowScalar>> = {
  "403::aspect_ratio": "9:16",
  "403::megapixels": 0.2,
  "398:380::thinking": false,
  "398:383::value": true,
  "398:362::value": 30,
  "398:363::value": false,
  "398:352::sampler_name": "euler_ancestral",
  "398:361::value": 24,
  "398:388::video_cfg": 1,
  "398:388::audio_cfg": 1,
  "398:357::strength": 0.7,
  "398:366::batch_size": 1,
  "398:356::batch_size": 1,
  "398:349::strength": 1,
  "398:391::video_cfg": 1,
  "398:391::audio_cfg": 1,
  "398:341::sampler_name": "euler_ancestral",
};

/**
 * A production-measured performance profile, not a quality endorsement. The
 * graph digest was stable across the original import and all 56 stored
 * revisions after replacing only the exact 22 owner-controlled bindings.
 */
export const TRUSTED_LTX_25_I2V_PORTRAIT_30S: TrustedVideoPresetDefinition = {
  schemaVersion: TRUSTED_VIDEO_PRESET_SCHEMA_VERSION,
  id: TRUSTED_LTX_25_I2V_PORTRAIT_30S_ID,
  label: "Runtime-trusted LTX 2.5 portrait 30s",
  shortLabel: "Trusted 30s",
  strategy: "native-single-pass",
  workflowFamily: "ltx-2.5-image-to-video",
  settings: {
    durationSeconds: 30,
    aspectRatio: "9:16",
    megapixels: 0.2,
    fps: 24,
    frames: 721,
    outputCount: 1,
    sampler: "euler_ancestral",
    videoCfg: 1,
    audioCfg: 1,
    batchSize: 1,
    promptEnhancement: true,
  },
  graphFamily: {
    format: "comfyui-api",
    nodeCount: 50,
    sha256: "16f150969e42df82020f405b8b69ffab5e3104e884e7776cc6e7d6e5df4215e9",
    parameterBindings: TRUSTED_GRAPH_PARAMETERS,
    firstPassSteps: 8,
    refinePassSteps: 3,
    latentUpscale: "2x",
    decode: "tiled-vae",
  },
  requiredModels: REQUIRED_LTX_MODELS,
  evidence: {
    kind: "measured-local-runtime",
    verifiedAt: "2026-08-29",
    hardware: "NVIDIA GeForce RTX 3090 24 GB",
    completedRuns: 6,
    terminalRuns: 6,
    medianMs: 121_400,
    fastestMs: 114_800,
    slowestMs: 439_500,
    qualityStatus: "unreviewed",
  },
};

export const TRUSTED_VIDEO_PRESETS = [TRUSTED_LTX_25_I2V_PORTRAIT_30S] as const;

/** Versioned bootstrap output from 100,000 deterministic trials over retained local timings. */
export const THIRTY_SECOND_VIDEO_STRATEGY_SIMULATION: readonly ThirtySecondVideoStrategySimulation[] = [
  { id: "native-30", label: "One native 30s render", segmentCount: 1, segmentSeconds: 30, simulatedMedianMs: 122_600, p10Ms: 114_800, p90Ms: 439_500, evidence: "measured", sampleCount: 8, excludesJoinOverhead: false },
  { id: "two-by-15", label: "Two 15s segments", segmentCount: 2, segmentSeconds: 15, simulatedMedianMs: 186_400, p10Ms: 165_300, p90Ms: 233_600, evidence: "measured", sampleCount: 4, excludesJoinOverhead: true },
  { id: "three-by-10", label: "Three 10s segments", segmentCount: 3, segmentSeconds: 10, simulatedMedianMs: 249_500, p10Ms: 222_600, p90Ms: 281_500, evidence: "interpolated", sampleCount: 0, excludesJoinOverhead: true },
  { id: "six-by-5", label: "Six 5s segments", segmentCount: 6, segmentSeconds: 5, simulatedMedianMs: 405_200, p10Ms: 376_900, p90Ms: 435_700, evidence: "measured", sampleCount: 6, excludesJoinOverhead: true },
] as const;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: WorkflowScalar | undefined) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function sameNumber(value: WorkflowScalar | undefined, expected: number, tolerance = 0.000_001) {
  const number = finiteNumber(value);
  return number !== null && Math.abs(number - expected) <= tolerance;
}

function exactModelInventory(models: readonly string[], required: readonly string[]) {
  const normalized = new Set(models.map((model) => model.trim().toLowerCase()));
  return models.length === required.length && required.every((model) => normalized.has(model.toLowerCase()));
}

function parameterById(parameters: readonly WorkflowParameter[]) {
  return new Map(parameters.map((parameter) => [parameter.id, parameter]));
}

function expectedScalarType(parameter: TrustedVideoGraphParameter) {
  if (parameter.kind === "number") return "number";
  if (parameter.kind === "boolean") return "boolean";
  return "string";
}

function expectedParameterReasons(workflow: WorkflowDefinition, preset: TrustedVideoPresetDefinition) {
  const reasons: string[] = [];
  const expected = preset.graphFamily.parameterBindings;
  const actual = parameterById(workflow.currentRevision.parameters);
  if (workflow.currentRevision.parameters.length !== expected.length) reasons.push("exposed parameter set differs from the measured graph");
  for (const spec of expected) {
    const parameter = actual.get(spec.id);
    if (!parameter) {
      reasons.push(`required parameter ${spec.id} is missing`);
      continue;
    }
    if (parameter.kind !== spec.kind || parameter.mediaKind !== spec.mediaKind
      || parameter.binding.format !== "comfyui-api"
      || parameter.binding.nodeId !== spec.nodeId
      || parameter.binding.inputName !== spec.inputName) {
      reasons.push(`required parameter ${spec.id} has a different binding`);
    }
  }
  return reasons;
}

function workflowSupportReasons(workflow: WorkflowDefinition, preset: TrustedVideoPresetDefinition) {
  const reasons: string[] = [];
  if (workflow.modality !== "video") reasons.push("workflow is not video");
  if (workflow.currentRevision.format !== preset.graphFamily.format) reasons.push("workflow is not a ComfyUI API graph");
  if (workflow.currentRevision.nodeCount !== preset.graphFamily.nodeCount) reasons.push("node count differs from the measured graph");
  if (!exactModelInventory(workflow.currentRevision.models, preset.requiredModels)) reasons.push("model inventory differs from the measured graph");
  reasons.push(...expectedParameterReasons(workflow, preset));
  return reasons;
}

function canonicalGraphValue(
  value: unknown,
  parameterByBinding: ReadonlyMap<string, TrustedVideoGraphParameter>,
  nodeId = "",
  inputName = "",
): unknown {
  const parameter = nodeId && inputName ? parameterByBinding.get(`${nodeId}::${inputName}`) : undefined;
  if (parameter) {
    if (typeof value !== expectedScalarType(parameter)) throw new Error("trusted_video_graph_invalid");
    return { $parameter: parameter.id, $type: typeof value };
  }
  if (Array.isArray(value)) return value.map((item) => canonicalGraphValue(item, parameterByBinding));
  if (!record(value)) return value;
  const normalized: UnknownRecord = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "_meta") continue;
    normalized[key] = canonicalGraphValue(value[key], parameterByBinding, nodeId, key);
  }
  return normalized;
}

/** Canonical execution graph used for exact family hashing; only pinned bindings are variable. */
export function canonicalTrustedVideoGraphFamily(
  graph: unknown,
  preset: TrustedVideoPresetDefinition = TRUSTED_LTX_25_I2V_PORTRAIT_30S,
) {
  if (!record(graph) || Object.keys(graph).length !== preset.graphFamily.nodeCount) throw new Error("trusted_video_graph_invalid");
  const bindings = new Map(preset.graphFamily.parameterBindings.map((parameter) => [
    `${parameter.nodeId}::${parameter.inputName}`,
    parameter,
  ]));
  for (const parameter of preset.graphFamily.parameterBindings) {
    const node = graph[parameter.nodeId];
    if (!record(node) || !record(node.inputs) || !Object.prototype.hasOwnProperty.call(node.inputs, parameter.inputName)) {
      throw new Error("trusted_video_graph_invalid");
    }
  }
  const normalized: UnknownRecord = {};
  for (const nodeId of Object.keys(graph).sort()) normalized[nodeId] = canonicalGraphValue(graph[nodeId], bindings, nodeId);
  return JSON.stringify(normalized);
}

export async function trustedVideoGraphFamilyHash(
  graph: unknown,
  preset: TrustedVideoPresetDefinition = TRUSTED_LTX_25_I2V_PORTRAIT_30S,
) {
  const encoded = new TextEncoder().encode(canonicalTrustedVideoGraphFamily(graph, preset));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function assessTrustedVideoPresetGraph(
  graph: unknown,
  preset: TrustedVideoPresetDefinition = TRUSTED_LTX_25_I2V_PORTRAIT_30S,
): Promise<TrustedVideoPresetAssessment> {
  try {
    const hash = await trustedVideoGraphFamilyHash(graph, preset);
    const matches = hash === preset.graphFamily.sha256;
    return { supported: matches, matches, reasons: matches ? [] : ["execution graph differs from the measured graph"] };
  } catch {
    return { supported: false, matches: false, reasons: ["execution graph differs from the measured graph"] };
  }
}

export function trustedVideoPresetById(value: unknown) {
  return TRUSTED_VIDEO_PRESETS.find((preset) => preset.id === value) ?? null;
}

/** Structural check for presenting the preset before the Worker validates the raw graph digest. */
export function assessTrustedVideoPresetSupport(
  workflow: WorkflowDefinition,
  preset: TrustedVideoPresetDefinition = TRUSTED_LTX_25_I2V_PORTRAIT_30S,
): TrustedVideoPresetAssessment {
  const reasons = workflowSupportReasons(workflow, preset);
  return { supported: reasons.length === 0, matches: false, reasons };
}

/** Applies exact performance controls. Prompt, both seeds, and media remain untouched. */
export function trustedVideoPresetParameterOverrides(
  parameters: readonly WorkflowParameter[],
  preset: TrustedVideoPresetDefinition = TRUSTED_LTX_25_I2V_PORTRAIT_30S,
) {
  const overrides: Record<string, WorkflowScalar> = {};
  const expectedIds = new Set(preset.graphFamily.parameterBindings.map((parameter) => parameter.id));
  for (const parameter of parameters) {
    if (!expectedIds.has(parameter.id) || !Object.prototype.hasOwnProperty.call(EXACT_PARAMETER_OVERRIDES, parameter.id)) continue;
    const value = EXACT_PARAMETER_OVERRIDES[parameter.id];
    overrides[parameter.id] = parameter.id === "403::aspect_ratio"
      ? canonicalWorkflowParameterValue(parameter, value)
      : value;
  }
  return overrides;
}

export function assessTrustedVideoPresetExecution(
  workflow: WorkflowDefinition,
  outputCount: number,
  preset: TrustedVideoPresetDefinition = TRUSTED_LTX_25_I2V_PORTRAIT_30S,
): TrustedVideoPresetAssessment {
  const supportReasons = workflowSupportReasons(workflow, preset);
  if (supportReasons.length) return { supported: false, matches: false, reasons: supportReasons };
  const parameters = parameterById(workflow.currentRevision.parameters);
  const reasons: string[] = [];
  const value = (id: string) => parameters.get(id)?.value;
  if (!sameNumber(value("398:362::value"), preset.settings.durationSeconds)) reasons.push("duration must be 30 seconds");
  if (!String(value("403::aspect_ratio") ?? "").trim().startsWith(preset.settings.aspectRatio)) reasons.push("aspect ratio must be 9:16");
  if (!sameNumber(value("403::megapixels"), preset.settings.megapixels)) reasons.push("resolution must be 0.20 MP");
  if (!sameNumber(value("398:361::value"), preset.settings.fps)) reasons.push("frame rate must be 24 fps");
  if (String(value("398:352::sampler_name")) !== preset.settings.sampler
    || String(value("398:341::sampler_name")) !== preset.settings.sampler) reasons.push("samplers must be euler_ancestral");
  if (!sameNumber(value("398:388::video_cfg"), preset.settings.videoCfg)
    || !sameNumber(value("398:391::video_cfg"), preset.settings.videoCfg)) reasons.push("video CFG must be 1");
  if (!sameNumber(value("398:388::audio_cfg"), preset.settings.audioCfg)
    || !sameNumber(value("398:391::audio_cfg"), preset.settings.audioCfg)) reasons.push("audio CFG must be 1");
  if (!sameNumber(value("398:349::strength"), 1)
    || !sameNumber(value("398:357::strength"), 0.7)) reasons.push("stage image strengths must remain 1 then 0.7");
  if (!sameNumber(value("398:356::batch_size"), preset.settings.batchSize)
    || !sameNumber(value("398:366::batch_size"), preset.settings.batchSize)) reasons.push("batch size must be 1");
  if (value("398:383::value") !== preset.settings.promptEnhancement) reasons.push("internal prompt enhancement must be enabled");
  if (value("398:380::thinking") !== false) reasons.push("prompt-enhancement thinking must be disabled");
  if (value("398:363::value") !== false) reasons.push("image-to-video mode must remain enabled");
  if (preset.settings.durationSeconds * preset.settings.fps + 1 !== preset.settings.frames) reasons.push("trusted frame derivation is invalid");
  if (outputCount !== preset.settings.outputCount) reasons.push("trusted speed requires one output");
  return { supported: true, matches: reasons.length === 0, reasons };
}

export function trustedVideoPresetStamp(
  preset: TrustedVideoPresetDefinition = TRUSTED_LTX_25_I2V_PORTRAIT_30S,
): TrustedVideoPresetStamp {
  return {
    schemaVersion: preset.schemaVersion,
    id: preset.id,
    label: preset.label,
    strategy: preset.strategy,
    verifiedAt: preset.evidence.verifiedAt,
    hardware: preset.evidence.hardware,
    graphFamily: {
      sha256: preset.graphFamily.sha256,
      nodeCount: preset.graphFamily.nodeCount,
      firstPassSteps: preset.graphFamily.firstPassSteps,
      refinePassSteps: preset.graphFamily.refinePassSteps,
      latentUpscale: preset.graphFamily.latentUpscale,
      decode: preset.graphFamily.decode,
    },
    evidence: {
      completedRuns: preset.evidence.completedRuns,
      terminalRuns: preset.evidence.terminalRuns,
      medianMs: preset.evidence.medianMs,
      fastestMs: preset.evidence.fastestMs,
      slowestMs: preset.evidence.slowestMs,
      qualityStatus: preset.evidence.qualityStatus,
    },
  };
}

/** Recognizes only server-created graph-bound stamps, never partial model/workload lookalikes. */
export function matchesTrustedVideoPreset(
  stamp: GenerationSettingsStamp,
  preset: TrustedVideoPresetDefinition = TRUSTED_LTX_25_I2V_PORTRAIT_30S,
) {
  const trusted = stamp.videoPerformance?.trustedPreset;
  const workload = stamp.videoPerformance?.workload;
  return stamp.modality === "video"
    && trusted?.id === preset.id
    && trusted.graphFamily.sha256 === preset.graphFamily.sha256
    && trusted.graphFamily.nodeCount === preset.graphFamily.nodeCount
    && Math.abs((workload?.durationSeconds ?? 0) - preset.settings.durationSeconds) < 0.01
    && Math.abs((workload?.megapixels ?? 0) - preset.settings.megapixels) < 0.001
    && Math.abs((workload?.fps ?? 0) - preset.settings.fps) < 0.01
    && workload?.frames === preset.settings.frames
    && (stamp.outputBatch?.count ?? 1) === preset.settings.outputCount;
}

/**
 * The displayed comparison is deliberately static and versioned. Runtime job
 * history cannot silently contaminate the proven graph-family evidence.
 */
export function simulateThirtySecondVideoStrategies() {
  return [...THIRTY_SECOND_VIDEO_STRATEGY_SIMULATION];
}
