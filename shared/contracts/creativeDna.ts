import type { GenerationCapability } from "./domain";

export const CREATIVE_DNA_SCHEMA_VERSION = "creative-dna/1.0" as const;

export const CREATIVE_DNA_DIMENSION_KEYS = [
  "energy",
  "tension",
  "contrast",
  "warmth",
  "spaciousness",
  "rhythmicity",
  "organicity",
  "polish",
] as const;

export type CreativeDnaDimensionKey = (typeof CREATIVE_DNA_DIMENSION_KEYS)[number];
export type CreativeDnaTarget = "music" | "image";
export type CreativeDnaSourceKind = "original" | "commercial_reference";
export type CreativeDnaDimensions = Record<CreativeDnaDimensionKey, number>;

export type CreativeDnaMediaDescription = {
  schemaVersion: "creative-dna-media-description/1.0";
  text: string;
  provider: "local-comfyui";
  workflowId: "gemma4-multimodal-description";
  workflowVersion: 1;
  model: "gemma4_e4b_it_fp8_scaled.safetensors";
  prompt: string;
  comfyPromptId: string;
  settings: Record<string, string | number | boolean>;
};

export type CreativeDnaTrainingSourceAnalysis = {
  sourceId: string;
  mediaId: string;
  sourceType: "upload" | "accepted-artifact";
  kind: "image" | "audio" | "video";
  label: string;
  detailedDescription?: CreativeDnaMediaDescription;
  observations: string[];
  metrics: Record<string, string | number | boolean>;
  dimensions: Partial<CreativeDnaDimensions>;
  confidence: number;
};

export type CreativeDnaTrainingAnalysis = {
  schemaVersion: "creative-dna-training-analysis/1.0" | "creative-dna-training-analysis/1.1";
  createdAt: string;
  summary: string;
  sources: CreativeDnaTrainingSourceAnalysis[];
  dimensions: Record<CreativeDnaDimensionKey, {
    value: number;
    confidence: number;
    sourceIds: string[];
  }>;
};

export type CreativeDnaInfluence = {
  angeloCore: number;
  currentProject: number;
  reference: number;
};

export type CreativeDnaInput = {
  name?: string;
  directive: string;
  targetModality: CreativeDnaTarget;
  sourceKind?: CreativeDnaSourceKind;
  referenceLabel?: string;
  dimensions?: Partial<CreativeDnaDimensions>;
  influence?: Partial<CreativeDnaInfluence>;
};

export type CreativeDnaCompileMeta = {
  artifactId: string;
  projectId: string;
  version: number;
  rootArtifactId: string;
  parentArtifactId?: string | null;
  createdAt: string;
};

export type CreativeDnaArtifact = {
  schemaVersion: typeof CREATIVE_DNA_SCHEMA_VERSION;
  artifactId: string;
  projectId: string;
  version: number;
  rootArtifactId: string;
  name: string;
  createdAt: string;
  targetModality: CreativeDnaTarget;
  capability: GenerationCapability;
  source: {
    kind: CreativeDnaSourceKind;
    directive: string;
    referenceLabel: string | null;
  };
  shared: CreativeDnaDimensions;
  native: Record<string, unknown>;
  influence: CreativeDnaInfluence;
  evidence: Array<{
    path: string;
    class: "user-directed" | "metadata/database" | "derived/translated";
    confidence: number;
    downstream: boolean;
  }>;
  rights: {
    policy: "original-input" | "abstract-attributes-only";
    referenceStoredAsProvenanceOnly: boolean;
    allowedDownstream: string[];
    blockedDownstream: string[];
  };
  translations: Array<{
    id: string;
    source: "shared";
    target: CreativeDnaTarget;
    method: "semantic-axis-v1";
    confidence: number;
    informationLoss: number;
  }>;
  generationPrompts: Record<CreativeDnaTarget, string>;
  lineage: {
    rootArtifactId: string;
    parentArtifactId: string | null;
  };
  training?: null | {
    jobId: string;
    runnerId: string;
    assetIds: string[];
    trainingExampleIds: string[];
    analysis: CreativeDnaTrainingAnalysis;
  };
};

export const DEFAULT_CREATIVE_DNA_DIMENSIONS: CreativeDnaDimensions = {
  energy: 64,
  tension: 48,
  contrast: 62,
  warmth: 55,
  spaciousness: 58,
  rhythmicity: 60,
  organicity: 50,
  polish: 58,
};

export const DEFAULT_CREATIVE_DNA_INFLUENCE: CreativeDnaInfluence = {
  angeloCore: 75,
  currentProject: 15,
  reference: 50,
};

const TARGETS = new Set<CreativeDnaTarget>(["music", "image"]);
const SOURCE_KINDS = new Set<CreativeDnaSourceKind>(["original", "commercial_reference"]);

function boundedText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function boundedNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function dimensionBand(value: number) {
  if (value <= 24) return "restrained";
  if (value <= 49) return "measured";
  if (value <= 74) return "present";
  return "dominant";
}

function axisPrompt(dimensions: CreativeDnaDimensions) {
  return CREATIVE_DNA_DIMENSION_KEYS
    .map((key) => `${key} ${dimensionBand(dimensions[key])} (${dimensions[key]})`)
    .join(", ");
}

function compileGenerationPrompt(
  modality: CreativeDnaTarget,
  directive: string,
  sourceKind: CreativeDnaSourceKind,
  dimensions: CreativeDnaDimensions,
) {
  const rightsGuard = sourceKind === "commercial_reference"
    ? "Use rights-safe abstract attributes only; do not reproduce lyrics, identifiable melody, vocal likeness, composition, or protected passages. "
    : "Keep the result original. ";
  const instruction = modality === "music"
    ? "Compose an original 60-second track with a clear arrival, development, contrast, and resolve."
    : "Create an original image with a decisive focal hierarchy, material texture, and intentional negative space.";
  return `${instruction} ${rightsGuard}Direction: ${directive}. CreativeDNA: ${axisPrompt(dimensions)}.`
    .slice(0, modality === "music" ? 500 : 700);
}

function nativeDna(target: CreativeDnaTarget, dimensions: CreativeDnaDimensions) {
  if (target === "music") {
    return {
      kind: "MusicDNA",
      durationSeconds: 60,
      sectionMap: ["arrival", "development", "contrast", "resolve"],
      energyCurve: dimensionBand(dimensions.energy),
      harmonicTension: dimensionBand(dimensions.tension),
      rhythmicDensity: dimensionBand(dimensions.rhythmicity),
      spatialWidth: dimensionBand(dimensions.spaciousness),
      productionFinish: dimensionBand(dimensions.polish),
    };
  }
  return {
    kind: "VisualDNA",
    focalContrast: dimensionBand(dimensions.contrast),
    paletteTemperature: dimensionBand(dimensions.warmth),
    spatialScale: dimensionBand(dimensions.spaciousness),
    materialCharacter: dimensionBand(dimensions.organicity),
    surfaceFinish: dimensionBand(dimensions.polish),
  };
}

export function compileCreativeDna(input: CreativeDnaInput, meta: CreativeDnaCompileMeta): CreativeDnaArtifact {
  const directive = boundedText(input.directive, 1200);
  if (directive.length < 4) throw new Error("directive_required");

  const targetModality = TARGETS.has(input.targetModality) ? input.targetModality : null;
  if (!targetModality) throw new Error("invalid_target_modality");

  const requestedSourceKind = input.sourceKind ?? "original";
  const sourceKind = SOURCE_KINDS.has(requestedSourceKind) ? requestedSourceKind : "original";
  const referenceLabel = boundedText(input.referenceLabel, 160) || null;
  if (sourceKind === "commercial_reference" && !referenceLabel) throw new Error("reference_label_required");

  const dimensions = CREATIVE_DNA_DIMENSION_KEYS.reduce((result, key) => {
    result[key] = boundedNumber(input.dimensions?.[key], DEFAULT_CREATIVE_DNA_DIMENSIONS[key]);
    return result;
  }, {} as CreativeDnaDimensions);

  const influence: CreativeDnaInfluence = {
    angeloCore: boundedNumber(input.influence?.angeloCore, DEFAULT_CREATIVE_DNA_INFLUENCE.angeloCore),
    currentProject: boundedNumber(input.influence?.currentProject, DEFAULT_CREATIVE_DNA_INFLUENCE.currentProject),
    reference: boundedNumber(input.influence?.reference, DEFAULT_CREATIVE_DNA_INFLUENCE.reference),
  };

  const isReference = sourceKind === "commercial_reference";
  const name = boundedText(input.name, 80) || `Untitled ${targetModality === "music" ? "track" : "image"}`;

  return {
    schemaVersion: CREATIVE_DNA_SCHEMA_VERSION,
    artifactId: meta.artifactId,
    projectId: meta.projectId,
    version: Math.max(1, Math.round(meta.version)),
    rootArtifactId: meta.rootArtifactId,
    name,
    createdAt: meta.createdAt,
    targetModality,
    capability: targetModality === "music" ? "MUSIC_GENERATE" : "IMAGE_GENERATE",
    source: { kind: sourceKind, directive, referenceLabel },
    shared: dimensions,
    native: nativeDna(targetModality, dimensions),
    influence,
    evidence: [
      { path: "source.directive", class: "user-directed", confidence: 1, downstream: true },
      { path: "shared", class: "user-directed", confidence: 1, downstream: true },
      { path: "source.referenceLabel", class: "metadata/database", confidence: 1, downstream: false },
      { path: "generationPrompts", class: "derived/translated", confidence: 0.84, downstream: true },
    ],
    rights: {
      policy: isReference ? "abstract-attributes-only" : "original-input",
      referenceStoredAsProvenanceOnly: isReference,
      allowedDownstream: isReference
        ? ["abstract structure", "energy", "instrumentation concepts", "production character", "tempo", "density", "contrast"]
        : ["user directive", "shared CreativeDNA", "translated CreativeDNA"],
      blockedDownstream: isReference
        ? ["lyrics", "identifiable melody", "copied passages", "vocal likeness", "raw reference audio"]
        : [],
    },
    translations: [
      { id: "shared-to-music-v1", source: "shared", target: "music", method: "semantic-axis-v1", confidence: 0.84, informationLoss: 0.22 },
      { id: "shared-to-image-v1", source: "shared", target: "image", method: "semantic-axis-v1", confidence: 0.84, informationLoss: 0.22 },
    ],
    generationPrompts: {
      music: compileGenerationPrompt("music", directive, sourceKind, dimensions),
      image: compileGenerationPrompt("image", directive, sourceKind, dimensions),
    },
    lineage: {
      rootArtifactId: meta.rootArtifactId,
      parentArtifactId: meta.parentArtifactId || null,
    },
    training: null,
  };
}
