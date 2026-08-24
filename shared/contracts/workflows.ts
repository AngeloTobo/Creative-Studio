export type WorkflowFormat = "comfyui-api" | "comfyui-ui";
export type WorkflowModality = "image" | "audio" | "music" | "video" | "3d";
export type WorkflowScalar = string | number | boolean;
export type WorkflowParameterKind = "text" | "number" | "boolean" | "choice" | "media";

export type WorkflowParameterBinding =
  | { format: "comfyui-api"; nodeId: string; inputName: string }
  | { format: "comfyui-ui"; nodeId: string; widgetIndex: number; subgraphId: string | null };

export type WorkflowParameter = {
  id: string;
  label: string;
  kind: WorkflowParameterKind;
  value: WorkflowScalar;
  mediaKind: "image" | "audio" | "video" | null;
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
};

export type WorkflowGraphInspection = {
  format: WorkflowFormat;
  modality: WorkflowModality;
  nodeCount: number;
  parameters: WorkflowParameter[];
  models: string[];
};

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

export function primaryWorkflowPromptParameter(parameters: WorkflowParameter[], modality?: WorkflowModality | "image" | "music" | "video") {
  const candidates = parameters.filter((parameter) => {
    if (parameter.kind !== "text") return false;
    const identity = `${parameter.label} ${parameter.id}`;
    return /prompt|caption|description|text/i.test(identity) && !/negative|undesired|avoid/i.test(identity);
  });
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

function apiInspection(graph: RecordValue): WorkflowGraphInspection {
  const parameters: WorkflowParameter[] = [];
  const models = new Set<string>();
  const types: string[] = [];
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
    if (/loader|save|preview|markdown/i.test(nodeType)) continue;
    for (const [inputName, value] of Object.entries(inputs)) {
      if (!SAFE_API_INPUTS.has(inputName) || !scalar(value)) continue;
      const parameterLabel = inputName === "value" && title ? title : `${title}: ${label(inputName)}`;
      parameters.push({
        id: `${nodeId}::${inputName}`,
        label: parameterLabel,
        kind: parameterKind(inputName, value),
        value,
        mediaKind: null,
        binding: { format: "comfyui-api", nodeId, inputName },
      });
    }
  }
  return { format: "comfyui-api", modality: inferModality(types), nodeCount: Object.keys(graph).length, parameters, models: [...models].sort() };
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
  return {
    id: `${subgraphId ?? "root"}:${nodeId}::${spec.name}`,
    label: spec.name === "value" ? title : `${title}: ${label(spec.name)}`,
    kind: spec.media ? "media" : parameterKind(spec.name, value),
    value,
    mediaKind: spec.media ?? null,
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
    if (!compatibleValue(parameter.value, value)) throw new Error("invalid_workflow_parameter_value");
    if (typeof value === "string" && value.length > 20_000) throw new Error("workflow_parameter_too_large");
    const binding = parameter.binding;
    if (binding.format === "comfyui-api") {
      const node = copy[binding.nodeId];
      if (!record(node) || !record(node.inputs)) throw new Error("workflow_parameter_binding_missing");
      node.inputs[binding.inputName] = value;
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
    node.widgets_values[binding.widgetIndex] = value;
  }
  return copy;
}
