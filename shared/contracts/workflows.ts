export type WorkflowFormat = "comfyui-api" | "comfyui-ui";
export type WorkflowModality = "image" | "audio" | "music" | "video" | "3d";
export type WorkflowScalar = string | number | boolean;
export type WorkflowParameterKind = "text" | "number" | "boolean" | "choice" | "media";
export type WorkflowPromptRole = "positive" | "negative" | "lyrics" | "system" | "unknown";

export type WorkflowParameterBinding =
  | { format: "comfyui-api"; nodeId: string; inputName: string }
  | { format: "comfyui-ui"; nodeId: string; widgetIndex: number; subgraphId: string | null };

export type WorkflowParameter = {
  id: string;
  label: string;
  kind: WorkflowParameterKind;
  value: WorkflowScalar;
  mediaKind: "image" | "audio" | "video" | null;
  promptRole?: WorkflowPromptRole;
  binding: WorkflowParameterBinding;
};

export type WorkflowRevision = {
  id: string;
  workflowId: string;
  version: number;
  parentRevisionId: string | null;
  format: WorkflowFormat;
  contentHash: string;
  nodeCount: number;
  parameters: WorkflowParameter[];
  models: string[];
  createdAt: string;
};

export type WorkflowDefinition = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  sourceFileName: string;
  modality: WorkflowModality;
  executionState: "ready" | "api-export-required";
  currentRevision: WorkflowRevision;
  createdAt: string;
  updatedAt: string;
};

export type SaveWorkflowRevisionRequest = {
  baseRevisionId: string;
  values: Record<string, WorkflowScalar>;
  /**
   * Model-library edits intentionally advance the visible default revision.
   * Create uses immutable execution revisions so per-run settings never rewrite
   * the owner's reusable model defaults.
   */
  scope?: "library-current" | "execution-only";
};

export type WorkflowGraphInspection = {
  format: WorkflowFormat;
  modality: WorkflowModality;
  nodeCount: number;
  parameters: WorkflowParameter[];
  models: string[];
};

const RESOLUTION_SELECTOR_ASPECT_RATIOS: WorkflowScalar[] = [
  "1:1 (Square)",
  "2:3 (Portrait Photo)",
  "3:2 (Photo)",
  "3:4 (Portrait Standard)",
  "4:3 (Standard)",
  "9:16 (Portrait Widescreen)",
  "16:9 (Widescreen)",
  "21:9 (Ultrawide)",
];

export function workflowParameterChoices(parameter: WorkflowParameter): WorkflowScalar[] {
  const inputName = parameter.binding.format === "comfyui-api"
    ? parameter.binding.inputName
    : parameter.id.split("::").at(-1) ?? "";
  if (parameter.kind === "choice" && inputName === "aspect_ratio") return RESOLUTION_SELECTOR_ASPECT_RATIOS;
  return [];
}

export function canonicalWorkflowParameterValue(parameter: WorkflowParameter, value: WorkflowScalar): WorkflowScalar {
  const choices = workflowParameterChoices(parameter);
  if (!choices.length || choices.includes(value) || typeof value !== "string") return value;
  const shorthand = value.trim().toLowerCase();
  const matches = choices.filter((choice) => typeof choice === "string"
    && (choice.toLowerCase() === shorthand || choice.toLowerCase().startsWith(`${shorthand} (`)));
  return matches.length === 1 ? matches[0] : value;
}

export function recoverWorkflowPromptRoles(graph: unknown, storedParameters: WorkflowParameter[]): WorkflowParameter[] {
  const inspectedById = new Map(inspectWorkflowGraph(graph).parameters.map((parameter) => [parameter.id, parameter]));
  return storedParameters.map((parameter) => {
    if (parameter.kind !== "text") return parameter;
    const inspected = inspectedById.get(parameter.id);
    return inspected ? { ...parameter, label: inspected.label, promptRole: inspected.promptRole } : parameter;
  });
}

export type MusicPromptProfile = {
  id: import("./domain").SongPromptProfileId;
  label: string;
  targetModel: string;
  outputFormat: "structured-caption" | "natural-language";
};

export function musicPromptProfileForIdentity(input: {
  name?: string | null;
  description?: string | null;
  sourceFileName?: string | null;
  models?: string[];
  parameters?: Array<Pick<WorkflowParameter, "id" | "label">>;
}): MusicPromptProfile {
  const identity = [
    input.name,
    input.description,
    input.sourceFileName,
    ...(input.models ?? []),
    ...(input.parameters ?? []).flatMap((parameter) => [parameter.id, parameter.label]),
  ].join(" ").toLowerCase();
  if (/minimax[^\n]*music\s*3|music\s*3[^\n]*minimax|minimax_music3|minimaxmusic3/.test(identity)) {
    return {
      id: "minimax-music-3-structured-caption/1.0",
      label: "MiniMax Music 3 structured caption",
      targetModel: "MiniMax Music 3",
      outputFormat: "structured-caption",
    };
  }
  if (/stable[_ .-]*audio|stable_audio/.test(identity)) {
    return {
      id: "stable-audio-natural-language/1.0",
      label: "Stable Audio natural-language prompt",
      targetModel: "Stable Audio",
      outputFormat: "natural-language",
    };
  }
  return {
    id: "generic-music-natural-language/1.0",
    label: "Model-ready music prompt",
    targetModel: "Selected music model",
    outputFormat: "natural-language",
  };
}

export function musicWorkflowPromptProfile(workflow: Pick<WorkflowDefinition, "name" | "description" | "sourceFileName" | "currentRevision">): MusicPromptProfile {
  return musicPromptProfileForIdentity({
    name: workflow.name,
    description: workflow.description,
    sourceFileName: workflow.sourceFileName,
    models: workflow.currentRevision.models,
    parameters: workflow.currentRevision.parameters,
  });
}

function heuristicPromptCandidates(parameters: WorkflowParameter[]) {
  return parameters.filter((parameter) => {
    if (parameter.kind !== "text") return false;
    const identity = `${parameter.label} ${parameter.id}`;
    return /prompt|caption|description|text/i.test(identity) && !/negative|undesired|avoid|lyrics?|system|template/i.test(identity);
  });
}

export function generationWorkflowPromptParameters(parameters: WorkflowParameter[]) {
  const structural = parameters.filter((parameter) => parameter.kind === "text" && parameter.promptRole === "positive");
  return structural.length ? structural : heuristicPromptCandidates(parameters);
}

export function primaryWorkflowPromptParameter(parameters: WorkflowParameter[], modality?: WorkflowModality | "image" | "music" | "video") {
  const candidates = generationWorkflowPromptParameters(parameters);
  if (modality === "music" || modality === "audio") {
    return candidates.find((parameter) => /caption/i.test(`${parameter.label} ${parameter.id}`)) ?? candidates[0] ?? null;
  }
  return candidates.find((parameter) => /positive/i.test(`${parameter.label} ${parameter.id}`))
    ?? candidates.find((parameter) => /prompt/i.test(`${parameter.label} ${parameter.id}`))
    ?? candidates[0]
    ?? null;
}

export function musicWorkflowLyricsParameter(parameters: WorkflowParameter[], modality?: WorkflowModality | "image" | "music" | "video") {
  if (modality !== "music" && modality !== "audio") return null;
  return parameters.find((parameter) => {
    if (parameter.kind !== "text") return false;
    const inputName = parameter.binding.format === "comfyui-api" ? parameter.binding.inputName : "";
    return /(?:^|\b|::)lyrics?(?:\b|$)/i.test(`${parameter.id} ${parameter.label} ${inputName}`);
  }) ?? null;
}

type RecordValue = Record<string, unknown>;

const MODEL_PATTERN = /[\w.-]+\.(?:safetensors|ckpt|pt|pth|gguf|onnx)/gi;
const SAFE_API_INPUTS = new Set([
  "prompt", "text", "value", "seed", "noise_seed", "steps", "cfg", "denoise",
  "sampler_name", "scheduler", "seconds", "duration", "width", "height", "frame_rate",
  "fps", "megapixels", "aspect_ratio", "strength", "video_cfg", "audio_cfg", "batch_size",
  "frames", "quality", "caption", "lyrics", "temperature", "top_k", "top_p", "min_p",
  "repetition_penalty", "presence_penalty", "thinking", "enable_prompt_enhance",
]);

function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scalar(value: unknown): value is WorkflowScalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function label(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()).trim();
}

function parameterKind(name: string, value: WorkflowScalar): WorkflowParameterKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (["sampler_name", "scheduler", "aspect_ratio", "quality"].includes(name)) return "choice";
  return "text";
}

function collectModels(value: unknown, models: Set<string>) {
  if (typeof value === "string") {
    for (const match of value.matchAll(MODEL_PATTERN)) models.add(match[0]);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectModels(item, models);
    return;
  }
  if (record(value)) for (const item of Object.values(value)) collectModels(item, models);
}

function inferModality(types: string[]): WorkflowModality {
  const joined = types.join(" ").toLowerCase();
  if (/triposplat|gaussian|splat|mesh|saveglb|file3d|moge/.test(joined)) return "3d";
  if (/minimaxmusic|music3/.test(joined)) return "music";
  if (/savevideo|createvideo|ltxv|minimaxh3/.test(joined)) return "video";
  if (/saveaudio|latentaudio|audiovae|stable.?audio/.test(joined)) return "audio";
  return "image";
}

function linkedNodeId(value: unknown) {
  return Array.isArray(value) && value.length >= 2 && (typeof value[0] === "string" || typeof value[0] === "number") && typeof value[1] === "number"
    ? String(value[0])
    : null;
}

const POSITIVE_CONDITIONING_INPUT = /^(?:positive|positive_prompt|positive_conditioning)$/i;
const NEGATIVE_CONDITIONING_INPUT = /negative|undesired|avoid/i;

type PromptDependencyRole = "positive" | "negative";

function dependencyClosure(graph: RecordValue, roots: Set<string>, role: PromptDependencyRole) {
  const result = new Set(roots);
  const pending = [...roots];
  while (pending.length) {
    const nodeId = pending.pop()!;
    const node = graph[nodeId];
    if (!record(node) || !record(node.inputs)) continue;
    for (const [inputName, value] of Object.entries(node.inputs)) {
      // Conditioning nodes can expose positive and negative branches through
      // different output slots while downstream guiders link both slots back to
      // the same node id. Preserve the branch role as we traverse upstream.
      if (role === "positive" && NEGATIVE_CONDITIONING_INPUT.test(inputName)) continue;
      if (role === "negative" && POSITIVE_CONDITIONING_INPUT.test(inputName)) continue;
      const linked = linkedNodeId(value);
      if (!linked || result.has(linked)) continue;
      result.add(linked);
      pending.push(linked);
    }
  }
  return result;
}

function apiPromptRoles(graph: RecordValue) {
  const positiveRoots = new Set<string>();
  const negativeRoots = new Set<string>();
  for (const rawNode of Object.values(graph)) {
    if (!record(rawNode) || !record(rawNode.inputs)) continue;
    for (const [inputName, value] of Object.entries(rawNode.inputs)) {
      const linked = linkedNodeId(value);
      if (!linked) continue;
      if (POSITIVE_CONDITIONING_INPUT.test(inputName)) positiveRoots.add(linked);
      if (NEGATIVE_CONDITIONING_INPUT.test(inputName)) negativeRoots.add(linked);
    }
  }
  return {
    positive: dependencyClosure(graph, positiveRoots, "positive"),
    negative: dependencyClosure(graph, negativeRoots, "negative"),
  };
}

function promptRole(nodeId: string, inputName: string, nodeType: string, title: string, roles: ReturnType<typeof apiPromptRoles>): WorkflowPromptRole {
  const identity = `${inputName} ${nodeType} ${title}`;
  if (/lyrics?/i.test(identity)) return "lyrics";
  if (roles.negative.has(nodeId) && !roles.positive.has(nodeId)) return "negative";
  if (/negative|undesired|avoid/i.test(identity)) return "negative";
  if (/system|template|instruction/i.test(identity)) return "system";
  if (roles.positive.has(nodeId)) return "positive";
  if (/prompt|caption|description|text/i.test(identity)) return "positive";
  return "unknown";
}

function apiInspection(graph: RecordValue): WorkflowGraphInspection {
  const parameters: WorkflowParameter[] = [];
  const models = new Set<string>();
  const types: string[] = [];
  const roles = apiPromptRoles(graph);
  for (const [nodeId, rawNode] of Object.entries(graph)) {
    if (!record(rawNode) || typeof rawNode.class_type !== "string") throw new Error("invalid_comfyui_api_workflow");
    const nodeType = rawNode.class_type;
    const title = record(rawNode._meta) && typeof rawNode._meta.title === "string" ? rawNode._meta.title : nodeType;
    types.push(nodeType);
    collectModels(rawNode, models);
    if (!record(rawNode.inputs)) continue;
    const inputs = rawNode.inputs;
    const mediaInput = (["image", "audio", "video"] as const).find((kind) =>
      typeof inputs[kind] === "string"
      && new RegExp(`(?:load|input|upload).*${kind}|${kind}.*(?:load|input|upload)`, "i").test(nodeType));
    if (mediaInput) {
      parameters.push({
        id: `${nodeId}::${mediaInput}`, label: title || `Input ${mediaInput}`, kind: "media", value: inputs[mediaInput] as string,
        mediaKind: mediaInput, binding: { format: "comfyui-api", nodeId, inputName: mediaInput },
      });
      continue;
    }
    if (["LoraLoader", "LoraLoaderModelOnly"].includes(nodeType)) {
      for (const inputName of ["lora_name", "strength_model", "strength_clip"]) {
        const value = inputs[inputName];
        if (!scalar(value)) continue;
        parameters.push({ id: `${nodeId}::${inputName}`, label: `${title}: ${label(inputName)}`,
          kind: typeof value === "number" ? "number" : "text", value, mediaKind: null,
          binding: { format: "comfyui-api", nodeId, inputName } });
      }
      continue;
    }
    if (/loader|save|preview|markdown/i.test(nodeType)) continue;
    for (const [inputName, value] of Object.entries(inputs)) {
      if (!SAFE_API_INPUTS.has(inputName) || !scalar(value)) continue;
      const role = typeof value === "string" ? promptRole(nodeId, inputName, nodeType, title, roles) : undefined;
      const baseLabel = inputName === "value" && title ? title : `${title}: ${label(inputName)}`;
      const parameterLabel = role === "negative" && !/negative/i.test(baseLabel) ? `Negative · ${baseLabel}` : baseLabel;
      parameters.push({
        id: `${nodeId}::${inputName}`,
        label: parameterLabel,
        kind: parameterKind(inputName, value),
        value,
        mediaKind: null,
        promptRole: role,
        binding: { format: "comfyui-api", nodeId, inputName },
      });
    }
  }
  return { format: "comfyui-api", modality: inferModality(types), nodeCount: Object.keys(graph).length, parameters, models: [...models].sort() };
}

export type ExactWorkflowPromptContamination = {
  positiveParameterId: string;
  negativeParameterId: string;
  sharedValue: string;
};

/**
 * Reports exact non-empty text copied into both a structurally positive and a
 * structurally negative prompt parameter. This is deliberately read-only so a
 * caller can decide whether to create a corrected immutable workflow revision.
 */
export function detectExactWorkflowPromptContamination(graph: unknown): ExactWorkflowPromptContamination[] {
  const parameters = inspectWorkflowGraph(graph).parameters;
  const positive = parameters.filter((parameter) =>
    parameter.kind === "text"
    && parameter.promptRole === "positive"
    && typeof parameter.value === "string"
    && parameter.value.length > 0);
  const negative = parameters.filter((parameter) =>
    parameter.kind === "text"
    && parameter.promptRole === "negative"
    && typeof parameter.value === "string"
    && parameter.value.length > 0);
  const matches: ExactWorkflowPromptContamination[] = [];
  for (const positiveParameter of positive) {
    for (const negativeParameter of negative) {
      if (positiveParameter.value !== negativeParameter.value) continue;
      matches.push({
        positiveParameterId: positiveParameter.id,
        negativeParameterId: negativeParameter.id,
        sharedValue: positiveParameter.value as string,
      });
    }
  }
  return matches;
}

type UiWidgetSpec = { name: string; index: number; media?: "image" | "audio" | "video" };

const UI_WIDGETS: Record<string, UiWidgetSpec[]> = {
  LoadImage: [{ name: "image", index: 0, media: "image" }],
  KSampler: [
    { name: "seed", index: 0 }, { name: "steps", index: 2 }, { name: "cfg", index: 3 },
    { name: "sampler_name", index: 4 }, { name: "scheduler", index: 5 }, { name: "denoise", index: 6 },
  ],
  RandomNoise: [{ name: "noise_seed", index: 0 }],
  SeedNode: [{ name: "seed", index: 0 }],
  ResolutionSelector: [{ name: "aspect_ratio", index: 0 }, { name: "megapixels", index: 1 }],
  PrimitiveInt: [{ name: "value", index: 0 }],
  PrimitiveFloat: [{ name: "value", index: 0 }],
  PrimitiveBoolean: [{ name: "value", index: 0 }],
  PrimitiveStringMultiline: [{ name: "value", index: 0 }],
  MiniMaxMusic3TextEncode: [
    { name: "caption", index: 0 }, { name: "lyrics", index: 1 }, { name: "seed", index: 2 },
    { name: "max_duration", index: 4 }, { name: "cfg", index: 5 }, { name: "steps", index: 6 },
  ],
  EmptyMiniMaxMusic3LatentAudio: [{ name: "seconds", index: 0 }, { name: "batch_size", index: 1 }],
};

function uiParameter(node: RecordValue, spec: UiWidgetSpec, subgraphId: string | null, displayTitle?: string): WorkflowParameter | null {
  const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  const value = widgets[spec.index];
  if (!scalar(value)) return null;
  const nodeId = String(node.id ?? "");
  const title = displayTitle || (typeof node.title === "string" && node.title ? node.title : String(node.type ?? "Node"));
  const identity = `${spec.name} ${title} ${String(node.type ?? "")}`;
  const role: WorkflowPromptRole | undefined = typeof value === "string"
    ? /lyrics?/i.test(identity) ? "lyrics"
      : /negative|undesired|avoid/i.test(identity) ? "negative"
        : /system|template|instruction/i.test(identity) ? "system"
          : /prompt|caption|description|text/i.test(identity) ? "positive" : "unknown"
    : undefined;
  return {
    id: `${subgraphId ?? "root"}:${nodeId}::${spec.name}`,
    label: spec.name === "value" ? title : `${title}: ${label(spec.name)}`,
    kind: spec.media ? "media" : parameterKind(spec.name, value),
    value,
    mediaKind: spec.media ?? null,
    promptRole: role,
    binding: { format: "comfyui-ui", nodeId, widgetIndex: spec.index, subgraphId },
  };
}

function uiInspection(graph: RecordValue): WorkflowGraphInspection {
  if (!Array.isArray(graph.nodes)) throw new Error("invalid_comfyui_ui_workflow");
  const parameters: WorkflowParameter[] = [];
  const models = new Set<string>();
  const types: string[] = [];
  let nodeCount = 0;
  const definitions = record(graph.definitions) && Array.isArray(graph.definitions.subgraphs) ? graph.definitions.subgraphs : [];
  const subgraphInputs = new Map<string, Array<RecordValue>>();
  const subgraphNames = new Map<string, string>();
  for (const definition of definitions) {
    if (!record(definition) || typeof definition.id !== "string") continue;
    subgraphInputs.set(definition.id, Array.isArray(definition.inputs) ? definition.inputs.filter(record) : []);
    subgraphNames.set(definition.id, typeof definition.name === "string" ? definition.name : definition.id);
  }
  for (const rawNode of graph.nodes) {
    if (!record(rawNode) || typeof rawNode.type !== "string") continue;
    nodeCount += 1;
    types.push(rawNode.type);
    collectModels(rawNode, models);
    const specs = UI_WIDGETS[rawNode.type] ?? [];
    for (const spec of specs) {
      const found = uiParameter(rawNode, spec, null);
      if (found) parameters.push(found);
    }
    const inputs = subgraphInputs.get(rawNode.type);
    if (!inputs || !Array.isArray(rawNode.widgets_values)) continue;
    let widgetIndex = 0;
    for (const input of inputs) {
      const inputName = typeof input.name === "string" ? input.name : "";
      const inputType = typeof input.type === "string" ? input.type : "";
      if (/^(IMAGE|AUDIO|VIDEO|MASK)$/i.test(inputType)) continue;
      const value = rawNode.widgets_values[widgetIndex];
      if (scalar(value) && (SAFE_API_INPUTS.has(inputName) || ["value_1"].includes(inputName))) {
        const safeName = inputName === "value_1" && input.label === "duration" ? "duration" : inputName;
        const found = uiParameter(rawNode, { name: safeName, index: widgetIndex }, null, subgraphNames.get(rawNode.type));
        if (found) parameters.push(found);
      }
      widgetIndex += 1;
    }
  }
  for (const definition of definitions) {
    if (!record(definition) || !Array.isArray(definition.nodes)) continue;
    nodeCount += definition.nodes.length;
    for (const node of definition.nodes) if (record(node) && typeof node.type === "string") types.push(node.type);
    collectModels(definition, models);
  }
  const unique = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  return { format: "comfyui-ui", modality: inferModality(types), nodeCount, parameters: [...unique.values()], models: [...models].sort() };
}

export function inspectWorkflowGraph(graph: unknown): WorkflowGraphInspection {
  if (!record(graph)) throw new Error("invalid_comfyui_workflow");
  if (Array.isArray(graph.nodes)) return uiInspection(graph);
  const nodes = Object.values(graph);
  if (nodes.length && nodes.every((node) => record(node) && typeof node.class_type === "string")) return apiInspection(graph);
  throw new Error("unsupported_comfyui_workflow_format");
}

function compatibleValue(current: WorkflowScalar, value: unknown): value is WorkflowScalar {
  return typeof current === typeof value && scalar(value);
}

export function applyWorkflowValues(graph: unknown, parameters: WorkflowParameter[], values: Record<string, WorkflowScalar>) {
  const copy = JSON.parse(JSON.stringify(graph)) as unknown;
  if (!record(copy)) throw new Error("invalid_comfyui_workflow");
  const byId = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  for (const [parameterId, value] of Object.entries(values)) {
    const parameter = byId.get(parameterId);
    if (!parameter) throw new Error("unknown_workflow_parameter");
    const canonicalValue = canonicalWorkflowParameterValue(parameter, value);
    if (!compatibleValue(parameter.value, canonicalValue)) throw new Error("invalid_workflow_parameter_value");
    const choices = workflowParameterChoices(parameter);
    if (choices.length && !choices.includes(canonicalValue)) throw new Error("invalid_workflow_parameter_choice");
    if (typeof canonicalValue === "string" && canonicalValue.length > 20_000) throw new Error("workflow_parameter_too_large");
    const binding = parameter.binding;
    if (binding.format === "comfyui-api") {
      const node = copy[binding.nodeId];
      if (!record(node) || !record(node.inputs)) throw new Error("workflow_parameter_binding_missing");
      node.inputs[binding.inputName] = canonicalValue;
      continue;
    }
    const container = binding.subgraphId
      ? record(copy.definitions) && Array.isArray(copy.definitions.subgraphs)
        ? copy.definitions.subgraphs.find((item) => record(item) && item.id === binding.subgraphId)
        : null
      : copy;
    if (!record(container) || !Array.isArray(container.nodes)) throw new Error("workflow_parameter_binding_missing");
    const node = container.nodes.find((item) => record(item) && String(item.id) === binding.nodeId);
    if (!record(node) || !Array.isArray(node.widgets_values)) throw new Error("workflow_parameter_binding_missing");
    node.widgets_values[binding.widgetIndex] = canonicalValue;
  }
  return copy;
}
