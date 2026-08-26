import type { IsoDateString, MediaKind } from "./domain";

export const MODEL_TRAINING_RECIPE_SCHEMA_VERSION = "creative-studio-model-training-recipe/1.0" as const;
export const MODEL_ADAPTER_SCHEMA_VERSION = "creative-studio-model-adapter/1.0" as const;

export type ModelTrainingTarget = "music-style";
export type ModelTrainingProvider = "ace-step-1.5-lora";
export type ModelTrainingPreset = "proof" | "balanced" | "deep";
export type ModelTrainingStatus = "waiting-for-runner" | "waiting-for-review" | "running" | "completed" | "failed" | "cancelled";
export type ModelTrainingStage = "queued" | "preflight" | "captioning" | "dataset-review" | "preprocessing" | "training" | "retaining" | "adapter-review" | "completed" | "failed" | "cancelled";
export type ModelAdapterStatus = "review-required" | "active" | "inactive" | "rejected";

export type ModelTrainingConcept = {
  schemaVersion: "creative-studio-training-concept/1.0";
  target: ModelTrainingTarget;
  name: string;
  triggerToken: string;
  description: string;
  continuityRules: string[];
};

export type ModelTrainingRecipe = {
  schemaVersion: typeof MODEL_TRAINING_RECIPE_SCHEMA_VERSION;
  provider: ModelTrainingProvider;
  preset: ModelTrainingPreset;
  baseModel: {
    id: "ace-step-1.5-base";
    label: string;
    file: string;
  };
  dataset: {
    acceptedKinds: MediaKind[];
    minimumItems: number;
    captioner: "gemma4-multimodal-description/1.0";
  };
  optimization: {
    adapter: "lora";
    rank: number;
    alpha: number;
    learningRate: number;
    steps: number | null;
    epochs: number | null;
    batchSize: 1;
    gradientAccumulation: number;
    precision: "bf16";
    resolution: number | null;
    seed: number;
  };
  estimate: {
    minimumMinutes: number;
    maximumMinutes: number;
    basis: string;
  };
};

export type ModelTrainingJob = {
  id: string;
  projectId: string;
  dnaArtifactId: string | null;
  adapterId: string | null;
  name: string;
  target: ModelTrainingTarget;
  provider: ModelTrainingProvider;
  concept: ModelTrainingConcept;
  recipe: ModelTrainingRecipe;
  assetIds: string[];
  instrumental: boolean;
  dataset: ModelTrainingDataset | null;
  status: ModelTrainingStatus;
  stage: ModelTrainingStage;
  progress: number;
  runnerId: string | null;
  upstreamId: string | null;
  error: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  startedAt: IsoDateString | null;
  completedAt: IsoDateString | null;
};

export type ModelTrainingDatasetItem = {
  assetId: string;
  fileName: string;
  caption: string;
  lyrics: string;
  isInstrumental: boolean;
  durationSeconds: number;
  bpm: number | null;
  keyscale: string | null;
  captionSource: "gemma4-audio-description" | "owner-edited";
};

export type ModelTrainingDataset = {
  schemaVersion: "creative-studio-ace-step-dataset/1.0";
  items: ModelTrainingDatasetItem[];
  preparedAt: IsoDateString;
  reviewedAt: IsoDateString | null;
  reviewNote: string | null;
};

export type ModelAdapterEvaluation = {
  schemaVersion: "creative-studio-model-adapter-evaluation/1.0";
  datasetItems: number;
  captionedItems: number;
  validationPromptCount: number;
  notes: string[];
};

export type ModelAdapter = {
  schemaVersion: typeof MODEL_ADAPTER_SCHEMA_VERSION;
  id: string;
  projectId: string;
  dnaArtifactId: string | null;
  trainingJobId: string;
  name: string;
  target: ModelTrainingTarget;
  provider: ModelTrainingProvider;
  status: ModelAdapterStatus;
  concept: ModelTrainingConcept;
  recipe: ModelTrainingRecipe;
  localFile: {
    runnerId: string;
    relativePath: string;
    format: "safetensors";
    sha256: string;
    size: number;
  };
  evaluation: ModelAdapterEvaluation;
  recommendedStrength: number;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  activatedAt: IsoDateString | null;
};

export type ModelAdapterReviewDecision = "approved" | "rejected";

export type ModelAdapterReview = {
  id: string;
  projectId: string;
  trainingJobId: string;
  adapterId: string;
  decision: ModelAdapterReviewDecision;
  note: string;
  actor: "angelo" | "development-user";
  createdAt: IsoDateString;
};

export type GenerationModelAdapterBinding = {
  schemaVersion: "creative-studio-generation-adapter/1.0";
  adapterId: string;
  name: string;
  target: ModelTrainingTarget;
  provider: ModelTrainingProvider;
  baseModelId: ModelTrainingRecipe["baseModel"]["id"];
  triggerToken: string;
  relativePath: string;
  runnerId: string;
  strength: number;
};

export type CreateModelTrainingJobRequest = {
  projectId: string;
  dnaArtifactId?: string | null;
  name: string;
  target: ModelTrainingTarget;
  triggerToken: string;
  description: string;
  continuityRules?: string[];
  preset: ModelTrainingPreset;
  assetIds: string[];
  instrumental: boolean;
  idempotencyKey: string;
};

export type ReviewModelTrainingDatasetRequest = {
  items: Array<Pick<ModelTrainingDatasetItem, "assetId" | "caption" | "lyrics" | "isInstrumental">>;
  note: string;
};

export type CompleteModelTrainingJobRequest = {
  runnerId: string;
  upstreamId: string;
  localFile: ModelAdapter["localFile"];
  evaluation: ModelAdapterEvaluation;
};

export type CompleteModelTrainingDatasetRequest = {
  runnerId: string;
  dataset: ModelTrainingDataset;
};

const TARGETS = new Set<ModelTrainingTarget>(["music-style"]);
const PRESETS = new Set<ModelTrainingPreset>(["proof", "balanced", "deep"]);

function text(value: unknown, length: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);
}

function trigger(value: unknown) {
  const normalized = text(value, 48).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z][a-z0-9_-]{2,47}$/.test(normalized)) throw new Error("invalid_training_trigger");
  return normalized;
}

export function normalizeModelTrainingConcept(input: Pick<CreateModelTrainingJobRequest, "target" | "name" | "triggerToken" | "description" | "continuityRules">): ModelTrainingConcept {
  if (!TARGETS.has(input.target)) throw new Error("invalid_model_training_target");
  const name = text(input.name, 100);
  const description = text(input.description, 1_200);
  if (name.length < 2) throw new Error("model_training_name_required");
  if (description.length < 20) throw new Error("model_training_description_required");
  const continuityRules = [...new Set((input.continuityRules ?? []).map((rule) => text(rule, 240)).filter(Boolean))].slice(0, 12);
  return {
    schemaVersion: "creative-studio-training-concept/1.0",
    target: input.target,
    name,
    triggerToken: trigger(input.triggerToken),
    description,
    continuityRules,
  };
}

export function modelTrainingRecipe(target: ModelTrainingTarget, preset: ModelTrainingPreset): ModelTrainingRecipe {
  if (!TARGETS.has(target)) throw new Error("invalid_model_training_target");
  if (!PRESETS.has(preset)) throw new Error("invalid_model_training_preset");
  const settings = {
    proof: { rank: 16, epochs: 20, min: 20, max: 50 },
    balanced: { rank: 64, epochs: 100, min: 60, max: 180 },
    deep: { rank: 64, epochs: 300, min: 180, max: 480 },
  }[preset];
  return {
    schemaVersion: MODEL_TRAINING_RECIPE_SCHEMA_VERSION,
    provider: "ace-step-1.5-lora",
    preset,
    baseModel: { id: "ace-step-1.5-base", label: "ACE-Step 1.5 Base", file: "acestep-v15-base" },
    dataset: { acceptedKinds: ["audio"], minimumItems: 3, captioner: "gemma4-multimodal-description/1.0" },
    optimization: { adapter: "lora", rank: settings.rank, alpha: settings.rank * 2, learningRate: 0.0001, steps: null, epochs: settings.epochs, batchSize: 1, gradientAccumulation: 4, precision: "bf16", resolution: null, seed: 42 },
    estimate: { minimumMinutes: settings.min, maximumMinutes: settings.max, basis: "RTX 3090 estimate after ACE-Step tensor preprocessing; song length and dataset size can increase it." },
  };
}

export function modelTrainingTargetLabel(target: ModelTrainingTarget) {
  void target;
  return "Music style";
}

export function modelTrainingAssetKind(target: ModelTrainingTarget): MediaKind {
  void target;
  return "audio";
}

export function normalizeAdapterStrength(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.8;
  return Math.max(0.1, Math.min(1.5, Math.round(numeric * 100) / 100));
}
