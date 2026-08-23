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
export type CreativeDnaSourceKind = "original" | "owner_uploads" | "commercial_reference";
export type CreativeDnaDimensions = Record<CreativeDnaDimensionKey, number>;

export const MAX_CREATIVE_DNA_REFERENCE_ASSETS = 12;

type CreativeDnaMediaDescriptionProvenance = {
  provider: "local-comfyui";
  workflowId: "gemma4-multimodal-description";
  workflowVersion: 1;
  model: "gemma4_e4b_it_fp8_scaled.safetensors";
  prompt: string;
  comfyPromptId: string;
  settings: Record<string, string | number | boolean>;
};

export type CreativeDnaMediaDescription = CreativeDnaMediaDescriptionProvenance & (
  | { schemaVersion: "creative-dna-media-description/1.0"; text: string }
  | { schemaVersion: "creative-dna-media-description/1.1"; longSummary: string; shortSummary: string }
);

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
  referenceAssetIds?: string[];
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
    referenceAssetIds: string[];
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
const SOURCE_KINDS = new Set<CreativeDnaSourceKind>(["original", "owner_uploads", "commercial_reference"]);

function boundedText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function creativeDnaReferenceAssetIds(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("invalid_reference_assets");
  const ids = [...new Set(value.map((item) => boundedText(item, 100)))];
  if (ids.length > MAX_CREATIVE_DNA_REFERENCE_ASSETS) throw new Error("too_many_reference_assets");
  if (ids.some((assetId) => !/^media_[a-z0-9_]+$/i.test(assetId))) throw new Error("invalid_reference_assets");
  return ids;
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

function boundedNarrative(value: unknown, maxLength: number) {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (normalized.length <= maxLength) return normalized;
  const candidate = normalized.slice(0, maxLength + 1);
  const sentenceEnd = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("! "), candidate.lastIndexOf("? "));
  return (sentenceEnd >= Math.floor(maxLength * 0.6) ? candidate.slice(0, sentenceEnd + 1) : candidate.slice(0, maxLength)).trim();
}

function withoutSummaryLabel(value: string, kind: "long" | "short") {
  const label = kind === "long" ? /^(?:long|detailed|full)\s+summary\s*:\s*/i : /^(?:short|concise|generation)\s+(?:summary|prompt)\s*:\s*/i;
  return value.replace(label, "").trim();
}

export function splitCreativeDnaMediaDescriptionText(value: unknown) {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  const labeled = normalized.match(/(?:^|\n)\s*(?:long|detailed|full)\s+summary\s*:\s*([\s\S]*?)(?:\n+\s*(?:short|concise|generation)\s+(?:summary|prompt)\s*:\s*)([\s\S]+)$/i);
  if (labeled) {
    return {
      longSummary: boundedNarrative(labeled[1], 12_000),
      shortSummary: boundedNarrative(labeled[2], 2_400),
    };
  }
  const paragraphs = normalized.split(/\n{2,}/).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (paragraphs.length > 1 && paragraphs.at(-1)!.length >= 40) {
    return {
      longSummary: boundedNarrative(paragraphs.slice(0, -1).join("\n\n"), 12_000),
      shortSummary: boundedNarrative(withoutSummaryLabel(paragraphs.at(-1)!, "short"), 2_400),
    };
  }
  const summary = boundedNarrative(withoutSummaryLabel(normalized, "short"), 2_400);
  return { longSummary: boundedNarrative(normalized, 12_000), shortSummary: summary };
}

export function creativeDnaDescriptionSummaries(description: CreativeDnaMediaDescription) {
  if (description.schemaVersion === "creative-dna-media-description/1.1") {
    return {
      longSummary: boundedNarrative(withoutSummaryLabel(description.longSummary, "long"), 12_000),
      shortSummary: boundedNarrative(withoutSummaryLabel(description.shortSummary, "short"), 2_400),
    };
  }
  return splitCreativeDnaMediaDescriptionText(description.text);
}

export function creativeDnaTrainingDescription(analysis: CreativeDnaTrainingAnalysis | null | undefined, target: CreativeDnaTarget) {
  if (!analysis) return null;
  const preferredKinds = target === "image" ? ["image", "video"] : ["audio", "video"];
  const descriptions = preferredKinds.flatMap((kind) => analysis.sources
    .filter((source) => source.kind === kind && source.detailedDescription)
    .map((source) => creativeDnaDescriptionSummaries(source.detailedDescription!).shortSummary))
    .filter(Boolean);
  if (!descriptions.length) return null;
  return boundedNarrative([...new Set(descriptions)].join(" "), 2_400) || null;
}

function compileGenerationPrompt(
  modality: CreativeDnaTarget,
  directive: string,
  sourceKind: CreativeDnaSourceKind,
  dimensions: CreativeDnaDimensions,
) {
  if (modality === "image") return boundedNarrative(directive, 2_400);
  const rightsGuard = sourceKind === "commercial_reference"
    ? "Use rights-safe abstract attributes only; do not reproduce lyrics, identifiable melody, vocal likeness, composition, or protected passages. "
    : "Keep the result original. ";
  const instruction = "Compose an original 60-second track with a clear arrival, development, contrast, and resolve.";
  return `${instruction} ${rightsGuard}Direction: ${directive}. CreativeDNA: ${axisPrompt(dimensions)}.`
    .slice(0, 500);
}

export function resolveCreativeDnaGenerationArtifact(artifact: CreativeDnaArtifact): CreativeDnaArtifact {
  const referenceAssetIds = creativeDnaReferenceAssetIds(artifact.source.referenceAssetIds);
  const referencesAreCurrent = Array.isArray(artifact.source.referenceAssetIds)
    && artifact.source.referenceAssetIds.length === referenceAssetIds.length
    && artifact.source.referenceAssetIds.every((assetId, index) => assetId === referenceAssetIds[index]);
  const trainedDescription = creativeDnaTrainingDescription(artifact.training?.analysis, "image");
  const imageDirective = trainedDescription ?? artifact.source.directive;
  const imagePrompt = compileGenerationPrompt("image", imageDirective, artifact.source.kind, artifact.shared);
  const normalizedSource = referencesAreCurrent ? artifact.source : { ...artifact.source, referenceAssetIds };
  const source = trainedDescription && artifact.targetModality === "image"
    ? { ...normalizedSource, directive: trainedDescription }
    : normalizedSource;
  if (source === artifact.source && imagePrompt === artifact.generationPrompts.image) return artifact;
  return { ...artifact, source, generationPrompts: { ...artifact.generationPrompts, image: imagePrompt } };
}

export function creativeDnaGenerationPrompt(artifact: CreativeDnaArtifact, target: CreativeDnaTarget) {
  return resolveCreativeDnaGenerationArtifact(artifact).generationPrompts[target];
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
  const directive = boundedNarrative(input.directive, 2_400);
  if (directive.length < 4) throw new Error("directive_required");

  const targetModality = TARGETS.has(input.targetModality) ? input.targetModality : null;
  if (!targetModality) throw new Error("invalid_target_modality");

  const requestedSourceKind = input.sourceKind ?? "original";
  const sourceKind = SOURCE_KINDS.has(requestedSourceKind) ? requestedSourceKind : "original";
  const referenceLabel = boundedText(input.referenceLabel, 160) || null;
  const referenceAssetIds = sourceKind === "owner_uploads" ? creativeDnaReferenceAssetIds(input.referenceAssetIds) : [];
  if (sourceKind === "commercial_reference" && !referenceLabel) throw new Error("reference_label_required");
  if (sourceKind === "owner_uploads" && !referenceAssetIds.length) throw new Error("reference_assets_required");

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
    source: { kind: sourceKind, directive, referenceLabel: sourceKind === "commercial_reference" ? referenceLabel : null, referenceAssetIds },
    shared: dimensions,
    native: nativeDna(targetModality, dimensions),
    influence,
    evidence: [
      { path: "source.directive", class: "user-directed", confidence: 1, downstream: true },
      { path: "shared", class: "user-directed", confidence: 1, downstream: true },
      { path: "source.referenceLabel", class: "metadata/database", confidence: 1, downstream: false },
      { path: "source.referenceAssetIds", class: "metadata/database", confidence: 1, downstream: false },
      { path: "generationPrompts", class: "derived/translated", confidence: 0.84, downstream: true },
    ],
    rights: {
      policy: isReference ? "abstract-attributes-only" : "original-input",
      referenceStoredAsProvenanceOnly: isReference,
      allowedDownstream: isReference
        ? ["abstract structure", "energy", "instrumentation concepts", "production character", "tempo", "density", "contrast"]
        : sourceKind === "owner_uploads"
          ? ["user directive", "shared CreativeDNA", "translated CreativeDNA", "owner-upload lineage"]
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
