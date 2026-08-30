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

export type LegacyVideoGenerationVariantRole = "aligned" | "discovery";
export type FourWayVideoGenerationVariantRole = "exact" | "enhanced" | "left-field" | "awe";
export type VideoGenerationVariantRole = LegacyVideoGenerationVariantRole | FourWayVideoGenerationVariantRole;
export type VideoGenerationVariant = {
  schemaVersion: "creative-studio-video-variant/1.0" | "creative-studio-video-variant/1.1";
  pairId: string;
  role: VideoGenerationVariantRole;
  seed: number | null;
  personalStyleWeight: number;
  randomDnaWeight: number;
  baseDimensions: CreativeDnaDimensions;
  randomDimensions: CreativeDnaDimensions | null;
  effectiveDimensions: CreativeDnaDimensions;
};

export type VideoGenerationVersion = {
  prompt: string;
  variant: VideoGenerationVariant;
};

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

function videoVariantDimensions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_video_generation_variant");
  const input = value as Record<string, unknown>;
  return CREATIVE_DNA_DIMENSION_KEYS.reduce((result, key) => {
    const numeric = Number(input[key]);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 100) throw new Error("invalid_video_generation_variant");
    result[key] = numeric;
    return result;
  }, {} as CreativeDnaDimensions);
}

export function normalizeVideoGenerationVariant(value: unknown): VideoGenerationVariant {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_video_generation_variant");
  const input = value as Record<string, unknown>;
  const pairId = boundedText(input.pairId, 100);
  const role = input.role;
  const seed = input.seed === null ? null : Number(input.seed);
  const personalStyleWeight = Number(input.personalStyleWeight);
  const randomDnaWeight = Number(input.randomDnaWeight);
  const legacyRole = role === "aligned" || role === "discovery";
  const fourWayRole = role === "exact" || role === "enhanced" || role === "left-field" || role === "awe";
  const legacyVariant = input.schemaVersion === "creative-studio-video-variant/1.0" && legacyRole;
  const fourWayVariant = input.schemaVersion === "creative-studio-video-variant/1.1" && fourWayRole;
  if ((!legacyVariant && !fourWayVariant)
    || !/^video_pair_[a-z0-9-]{8,80}$/i.test(pairId)
    || (seed !== null && (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff))
    || !Number.isInteger(personalStyleWeight) || !Number.isInteger(randomDnaWeight)
    || personalStyleWeight < 0 || randomDnaWeight < 0 || personalStyleWeight + randomDnaWeight !== 100
    || (role === "aligned" && (seed !== null || personalStyleWeight !== 100 || randomDnaWeight !== 0 || input.randomDimensions !== null))
    || (role === "discovery" && (seed === null || randomDnaWeight <= personalStyleWeight))
    || ((role === "exact" || role === "enhanced") && (seed === null || personalStyleWeight !== 100 || randomDnaWeight !== 0 || input.randomDimensions !== null))
    || (role === "left-field" && (seed === null || personalStyleWeight !== 25 || randomDnaWeight !== 75))
    || (role === "awe" && (seed === null || personalStyleWeight !== 10 || randomDnaWeight !== 90))) {
    throw new Error("invalid_video_generation_variant");
  }
  const baseDimensions = videoVariantDimensions(input.baseDimensions);
  const hasRandomDimensions = role === "discovery" || role === "left-field" || role === "awe";
  const randomDimensions = hasRandomDimensions ? videoVariantDimensions(input.randomDimensions) : null;
  const effectiveDimensions = videoVariantDimensions(input.effectiveDimensions);
  const validEffectiveDimensions = CREATIVE_DNA_DIMENSION_KEYS.every((key) => (
    !hasRandomDimensions
      ? effectiveDimensions[key] === baseDimensions[key]
      : effectiveDimensions[key] === Math.round((baseDimensions[key] * personalStyleWeight + randomDimensions![key] * randomDnaWeight) / 100)
  ));
  if (!validEffectiveDimensions) throw new Error("invalid_video_generation_variant");
  return {
    schemaVersion: input.schemaVersion as VideoGenerationVariant["schemaVersion"],
    pairId,
    role,
    seed,
    personalStyleWeight,
    randomDnaWeight,
    baseDimensions,
    randomDimensions,
    effectiveDimensions,
  };
}

function seededRandom(seed: number) {
  let state = seed >>> 0 || 0x9e37_79b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function divergentRandomDimension(base: number, random: () => number) {
  let value = Math.round(random() * 100);
  if (Math.abs(value - base) < 28) value = base < 50 ? Math.min(100, base + 35) : Math.max(0, base - 35);
  return value;
}

function videoDiscoveryPrompt(direction: string, dimensions: CreativeDnaDimensions, hasSource: boolean) {
  const motion = dimensions.energy >= 67 ? "Motion arrives in decisive bursts" : dimensions.energy <= 33 ? "Motion unfolds with suspended restraint" : "Motion evolves through measured acceleration";
  const cadence = dimensions.rhythmicity >= 67 ? "with sharply patterned visual beats" : dimensions.rhythmicity <= 33 ? "with irregular pauses and asymmetrical timing" : "with a shifting, syncopated cadence";
  const tension = dimensions.tension >= 67 ? "and an unstable edge that never fully resolves." : dimensions.tension <= 33 ? "and a calm trajectory that resists obvious drama." : "and a controlled tension that changes direction once.";
  const camera = dimensions.spaciousness >= 67 ? "The camera reveals unexpected negative space and a wider spatial relationship." : dimensions.spaciousness <= 33 ? "The camera stays unusually close, cropping information and discovering detail through proximity." : "The camera changes scale midway, reframing the subject from an unfamiliar angle.";
  const light = `${dimensions.contrast >= 60 ? "Hard separation and graphic shadow" : "Low-contrast, layered light"} meet ${dimensions.warmth >= 60 ? "an unexpectedly warm color drift" : "a cool, estranged color drift"}.`;
  const surface = `${dimensions.organicity >= 60 ? "Movement feels tactile and imperfect" : "Movement feels precise and synthetic"}, while the finish remains ${dimensions.polish >= 60 ? "controlled but not conventional" : "raw enough to expose surprising transitions"}.`;
  const continuity = hasSource
    ? "Keep the source identity and opening frame recognizable, but let the staging and motion take the less expected path."
    : "Keep the central subject continuous, but let the staging and motion take the less expected path.";
  return boundedNarrative(`${direction.trim()} ${motion} ${cadence} ${tension} ${camera} ${light} ${surface} ${continuity} Keep the horizon upright and the camera level; use no sideways framing or camera roll.`, 2_400);
}

function deriveVideoSeed(baseSeed: number, index: number) {
  return ((baseSeed >>> 0) + Math.imul(index, 0x9e37_79b9)) >>> 0;
}

function randomVideoDimensions(baseDimensions: CreativeDnaDimensions, seed: number) {
  const random = seededRandom(seed);
  return CREATIVE_DNA_DIMENSION_KEYS.reduce((result, key) => {
    result[key] = divergentRandomDimension(baseDimensions[key], random);
    return result;
  }, {} as CreativeDnaDimensions);
}

function blendVideoDimensions(
  baseDimensions: CreativeDnaDimensions,
  randomDimensions: CreativeDnaDimensions,
  personalStyleWeight: number,
  randomDnaWeight: number,
) {
  return CREATIVE_DNA_DIMENSION_KEYS.reduce((result, key) => {
    result[key] = Math.round((baseDimensions[key] * personalStyleWeight + randomDimensions[key] * randomDnaWeight) / 100);
    return result;
  }, {} as CreativeDnaDimensions);
}

function seededChoice<T>(values: readonly T[], random: () => number) {
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

function leftFieldVideoPrompt(dimensions: CreativeDnaDimensions, seed: number, hasSource: boolean) {
  const random = seededRandom(seed);
  const premise = seededChoice([
    "Reverse cause and effect: the environment reacts first, then the subject completes the motion that appears to have caused it",
    "Treat stillness as the event while the surrounding space reorganizes itself around the subject in one continuous move",
    "Turn the expected action inside out: the background advances toward the lens while the subject seems fixed in a moving pocket of space",
    "Build the scene around one impossible transition in which foreground and distance quietly exchange places",
  ], random);
  const camera = seededChoice([
    "Use a low orbit that crosses behind one foreground obstruction before returning at a radically different scale",
    "Begin with a locked close view, then pull straight back through a foreground threshold into a wide architectural reveal without a cut",
    "Track against the apparent motion so the subject and world briefly seem to travel in opposite directions",
    "Use a level lateral parallax move after the spatial reversal appears, ending in a clean, unfamiliar composition",
  ], random);
  const finish = dimensions.polish >= 60
    ? "Keep every transition physically legible, sharply timed, and materially precise."
    : "Let one rough, tactile transition remain visible instead of polishing away the surprise.";
  const continuity = hasSource
    ? "Preserve the source subject, first-frame composition, and defining features even as the staging changes direction."
    : "Keep the central subject recognizable and continuous through the spatial change.";
  return boundedNarrative(`${premise}. ${camera}. ${finish} ${continuity} Keep the horizon upright and the camera level; use no sideways framing or camera roll.`, 2_400);
}

function aweVideoPrompt(dimensions: CreativeDnaDimensions, seed: number, hasSource: boolean) {
  const random = seededRandom(seed);
  const transformation = seededChoice([
    "A hairline opening in reality reveals nested versions of the same moment at planetary, cellular, and architectural scales",
    "Gravity folds into visible ribbons and each ribbon briefly contains a different impossible weather system",
    "The subject casts a shadow upward; the shadow becomes a vast living structure that bends the horizon without obscuring the subject",
    "Empty space crystallizes into translucent anatomy, then blooms outward as a silent impossible ecosystem before collapsing into one luminous detail",
  ], random);
  const movement = seededChoice([
    "Move through the transformation as one unbroken impossible macro-to-cosmic push",
    "Hold the subject with unnerving calm while scale, gravity, and depth transform around it in three escalating beats",
    "Use a precise spiral move that reveals each new scale only after the previous one becomes physically impossible",
    "Let the camera pass through one microscopic surface and emerge into a monumental version of the same composition",
  ], random);
  const finish = `${dimensions.contrast >= 60 ? "Use radiant separation against absolute shadow" : "Use pearlescent low-contrast light"}, with ${dimensions.organicity >= 60 ? "tactile living surfaces" : "uncannily exact synthetic surfaces"}; end on one breathtaking image that could not exist in ordinary physics.`;
  const continuity = hasSource
    ? "The source identity and opening frame must remain unmistakable anchors throughout the transformation."
    : "The central subject must remain an unmistakable anchor throughout the transformation.";
  return boundedNarrative(`${transformation}. ${movement}. ${finish} ${continuity} Keep the horizon upright and the camera level; use no sideways framing or camera roll.`, 2_400);
}

/**
 * Reconstructs the two four-way prompts that intentionally replace the reviewed
 * direction. This lets the Worker prove a left-field or awe job used the exact
 * deterministic variant described by its normalized settings stamp.
 */
export function deterministicReplacementVideoPrompt(value: unknown, hasSource: boolean) {
  const variant = normalizeVideoGenerationVariant(value);
  if (variant.role === "left-field") return leftFieldVideoPrompt(variant.effectiveDimensions, variant.seed!, hasSource);
  if (variant.role === "awe") return aweVideoPrompt(variant.effectiveDimensions, variant.seed!, hasSource);
  return null;
}

/**
 * Creates one truthful four-way motion board. Exact is the authored prompt,
 * Enhanced is the supplied model-enhanced prompt, and the two exploratory
 * prompts are deterministic from the board seed. A caller must not substitute
 * a local template for `enhancedPrompt`; equality is rejected so the label
 * cannot overstate what happened.
 */
export function createFourWayVideoGenerationVersions(input: {
  exactPrompt: string;
  enhancedPrompt: string;
  dimensions: CreativeDnaDimensions;
  pairId: string;
  boardSeed: number;
  hasSource: boolean;
}): [VideoGenerationVersion, VideoGenerationVersion, VideoGenerationVersion, VideoGenerationVersion] {
  const exactPrompt = boundedNarrative(input.exactPrompt, 2_400);
  const enhancedPrompt = boundedNarrative(input.enhancedPrompt, 4_000);
  if (exactPrompt.length < 4) throw new Error("directive_required");
  if (enhancedPrompt.length < 4) throw new Error("enhanced_prompt_required");
  const canonicalPrompt = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  if (canonicalPrompt(exactPrompt) === canonicalPrompt(enhancedPrompt)) throw new Error("enhanced_prompt_must_differ");

  const baseDimensions = videoVariantDimensions(input.dimensions);
  const seeds = [0, 1, 2, 3].map((index) => deriveVideoSeed(input.boardSeed, index));
  const leftFieldRandomDimensions = randomVideoDimensions(baseDimensions, seeds[2]);
  const aweRandomDimensions = randomVideoDimensions(baseDimensions, seeds[3]);
  const leftFieldDimensions = blendVideoDimensions(baseDimensions, leftFieldRandomDimensions, 25, 75);
  const aweDimensions = blendVideoDimensions(baseDimensions, aweRandomDimensions, 10, 90);

  const variant = (
    role: FourWayVideoGenerationVariantRole,
    seed: number,
    personalStyleWeight: number,
    randomDnaWeight: number,
    randomDimensions: CreativeDnaDimensions | null,
    effectiveDimensions: CreativeDnaDimensions,
  ): VideoGenerationVariant => ({
    schemaVersion: "creative-studio-video-variant/1.1",
    pairId: input.pairId,
    role,
    seed,
    personalStyleWeight,
    randomDnaWeight,
    baseDimensions,
    randomDimensions,
    effectiveDimensions,
  });

  return [
    { prompt: exactPrompt, variant: variant("exact", seeds[0], 100, 0, null, baseDimensions) },
    { prompt: enhancedPrompt, variant: variant("enhanced", seeds[1], 100, 0, null, baseDimensions) },
    { prompt: leftFieldVideoPrompt(leftFieldDimensions, seeds[2], input.hasSource), variant: variant("left-field", seeds[2], 25, 75, leftFieldRandomDimensions, leftFieldDimensions) },
    { prompt: aweVideoPrompt(aweDimensions, seeds[3], input.hasSource), variant: variant("awe", seeds[3], 10, 90, aweRandomDimensions, aweDimensions) },
  ];
}

export function createVideoGenerationVersions(input: {
  direction: string;
  dimensions: CreativeDnaDimensions;
  pairId: string;
  discoverySeed: number;
  hasSource: boolean;
}): [VideoGenerationVersion, VideoGenerationVersion] {
  const direction = boundedNarrative(input.direction, 2_400);
  if (direction.length < 4) throw new Error("directive_required");
  const baseDimensions = videoVariantDimensions(input.dimensions);
  const seed = input.discoverySeed >>> 0;
  const random = seededRandom(seed);
  const randomDimensions = CREATIVE_DNA_DIMENSION_KEYS.reduce((result, key) => {
    result[key] = divergentRandomDimension(baseDimensions[key], random);
    return result;
  }, {} as CreativeDnaDimensions);
  const effectiveDimensions = CREATIVE_DNA_DIMENSION_KEYS.reduce((result, key) => {
    result[key] = Math.round(baseDimensions[key] * 0.3 + randomDimensions[key] * 0.7);
    return result;
  }, {} as CreativeDnaDimensions);
  const aligned: VideoGenerationVersion = {
    prompt: direction,
    variant: {
      schemaVersion: "creative-studio-video-variant/1.0",
      pairId: input.pairId,
      role: "aligned",
      seed: null,
      personalStyleWeight: 100,
      randomDnaWeight: 0,
      baseDimensions,
      randomDimensions: null,
      effectiveDimensions: baseDimensions,
    },
  };
  const discovery: VideoGenerationVersion = {
    prompt: videoDiscoveryPrompt(direction, effectiveDimensions, input.hasSource),
    variant: {
      schemaVersion: "creative-studio-video-variant/1.0",
      pairId: input.pairId,
      role: "discovery",
      seed,
      personalStyleWeight: 30,
      randomDnaWeight: 70,
      baseDimensions,
      randomDimensions,
      effectiveDimensions,
    },
  };
  return [aligned, discovery];
}

export function videoGenerationVariantLabel(role: VideoGenerationVariantRole) {
  switch (role) {
    case "aligned": return "Aligned";
    case "discovery": return "Discovery";
    case "exact": return "Exact";
    case "enhanced": return "Enhanced";
    case "left-field": return "Left Field";
    case "awe": return "Awe";
  }
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
