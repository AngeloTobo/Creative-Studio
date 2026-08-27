export const CREATIVE_WORLD_SCHEMA_VERSION = "creative-studio-world/1.0" as const;
export const WORLD_ENTITY_SCHEMA_VERSION = "creative-studio-world-entity/1.0" as const;
export const CANON_REFERENCE_SCHEMA_VERSION = "creative-studio-canon-reference/1.0" as const;
export const CONTINUITY_DIRECTIVE_SCHEMA_VERSION = "creative-studio-continuity-directive/1.0" as const;
export const PROMOTE_TO_CANON_SCHEMA_VERSION = "creative-studio-promote-to-canon/1.0" as const;

export const CONTINUITY_FACETS = [
  "identity",
  "face",
  "anatomy",
  "silhouette",
  "wardrobe",
  "material",
  "palette",
  "scale",
  "location",
  "lighting",
  "motion",
  "behavior",
  "relationship",
  "timeline",
  "composition",
  "voice",
  "sound",
] as const;

export type ContinuityFacet = (typeof CONTINUITY_FACETS)[number];
export type ContinuityModality = "image" | "video" | "music";
export type WorldStatus = "active" | "archived";
export type WorldEntityKind = "character" | "place" | "object";
export type WorldEntityStatus = "active" | "retired";
export type ContinuityRuleStrength = "must" | "prefer" | "avoid";
export type ContinuityRuleStatus = "active" | "retired";

export type World = {
  schemaVersion: typeof CREATIVE_WORLD_SCHEMA_VERSION;
  id: string;
  projectId: string;
  name: string;
  premise: string;
  status: WorldStatus;
  entityIds: string[];
  continuityRuleIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ContinuityAttribute = {
  facet: ContinuityFacet;
  value: string;
};

export type WorldEntity = {
  schemaVersion: typeof WORLD_ENTITY_SCHEMA_VERSION;
  id: string;
  worldId: string;
  projectId: string;
  kind: WorldEntityKind;
  name: string;
  summary: string;
  aliases: string[];
  attributes: ContinuityAttribute[];
  canonReferenceIds: string[];
  status: WorldEntityStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CanonReferenceSource =
  | { kind: "owner-upload"; mediaId: string; label: string }
  | { kind: "retained-artifact"; artifactId: string; label: string }
  | { kind: "commercial-reference"; identity: string; lineageOnly: true };

export type CanonReference = {
  schemaVersion: typeof CANON_REFERENCE_SCHEMA_VERSION;
  id: string;
  worldId: string;
  projectId: string;
  entityId: string;
  source: CanonReferenceSource;
  continuityNotes: ContinuityAttribute[];
  status: "candidate" | "canonical" | "retired";
  rights: {
    policy: "owner-controlled" | "abstract-attributes-only";
    sourceIdentityPromptEligible: false;
    rawMediaPromptEligible: false;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ContinuityRule = {
  id: string;
  worldId: string;
  projectId: string;
  entityIds: string[];
  facet: ContinuityFacet;
  strength: ContinuityRuleStrength;
  instruction: string;
  modalities: ContinuityModality[];
  status: ContinuityRuleStatus;
  createdAt: string;
  updatedAt: string;
};

export type PromoteToCanonRequest = {
  schemaVersion: typeof PROMOTE_TO_CANON_SCHEMA_VERSION;
  confirmation: "promote-to-canon";
  worldId: string;
  entityId: string;
  referenceId: string;
  facets: ContinuityFacet[];
  note: string;
  expectedReferenceVersion: number;
  evidenceReviewId?: string | null;
};

export type PromoteToCanonResult = {
  schemaVersion: typeof PROMOTE_TO_CANON_SCHEMA_VERSION;
  promotionId: string;
  worldId: string;
  entityId: string;
  referenceId: string;
  facets: ContinuityFacet[];
  note: string;
  actor: "angelo" | "development-user";
  evidenceReviewId: string | null;
  promotedAt: string;
  reference: CanonReference;
};

export type ContinuityDirectiveSegment = {
  kind: "world" | "entity" | "rule" | "reference";
  sourceId: string;
  facet: ContinuityFacet | null;
  text: string;
};

export type ContinuityDirective = {
  schemaVersion: typeof CONTINUITY_DIRECTIVE_SCHEMA_VERSION;
  worldId: string;
  modality: ContinuityModality;
  text: string;
  segments: ContinuityDirectiveSegment[];
  entityIds: string[];
  ruleIds: string[];
  referenceIds: string[];
  excludedCommercialReferenceIdentityIds: string[];
  facets: ContinuityFacet[];
  truncated: boolean;
};

export type CompileContinuityDirectiveInput = {
  world: World;
  entities: readonly WorldEntity[];
  rules: readonly ContinuityRule[];
  references?: readonly CanonReference[];
  selectedEntityIds: readonly string[];
  selectedRuleIds: readonly string[];
  selectedReferenceIds?: readonly string[];
  modality: ContinuityModality;
  maxCharacters?: number;
};

const FACETS = new Set<string>(CONTINUITY_FACETS);

function clean(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function normalizedFacets(values: readonly ContinuityFacet[]) {
  return unique(values).filter((facet) => FACETS.has(facet));
}

function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function selectionOrder<T extends { id: string }>(values: readonly T[], selectedIds: readonly string[]) {
  const byId = new Map(values.map((value) => [value.id, value]));
  return unique(selectedIds).flatMap((id) => {
    const value = byId.get(id);
    return value ? [value] : [];
  });
}

function attributeText(attributes: readonly ContinuityAttribute[]) {
  return attributes
    .map((attribute) => ({ facet: attribute.facet, value: clean(attribute.value, 240) }))
    .filter((attribute) => attribute.value && FACETS.has(attribute.facet));
}

function withoutCommercialReferenceIdentities(value: string, references: readonly CanonReference[], maxLength = 360) {
  let result = clean(value, maxLength);
  for (const reference of references) {
    if (reference.source.kind !== "commercial-reference") continue;
    const identity = clean(reference.source.identity, 300);
    if (!identity) continue;
    const pattern = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}_])${pattern}(?:['’]s)?(?=$|[^\\p{L}\\p{N}_])`, "giu"),
      (_match, prefix: string) => prefix,
    );
  }
  return clean(result.replace(/\s+([,.;:!?])/g, "$1"), maxLength);
}

/**
 * Compiles only owner-confirmed world records. Source labels and commercial
 * identities remain inspectable provenance and never enter the provider text.
 */
export function compileContinuityDirective(input: CompileContinuityDirectiveInput): ContinuityDirective {
  const maxCharacters = Math.max(240, Math.min(4_000, Math.round(input.maxCharacters ?? 1_800)));
  const selectedEntities = selectionOrder(input.entities, input.selectedEntityIds)
    .filter((entity) => entity.worldId === input.world.id && entity.projectId === input.world.projectId && entity.status === "active");
  const selectedEntityIds = new Set(selectedEntities.map((entity) => entity.id));
  const selectedRules = selectionOrder(input.rules, input.selectedRuleIds)
    .filter((rule) => rule.worldId === input.world.id
      && rule.projectId === input.world.projectId
      && rule.status === "active"
      && rule.modalities.includes(input.modality)
      && (rule.entityIds.length === 0 || rule.entityIds.some((entityId) => selectedEntityIds.has(entityId))));
  const requestedReferenceIds = input.selectedReferenceIds ?? selectedEntities.flatMap((entity) => entity.canonReferenceIds);
  const selectedReferences = selectionOrder(input.references ?? [], requestedReferenceIds)
    .filter((reference) => reference.worldId === input.world.id
      && reference.projectId === input.world.projectId
      && reference.status === "canonical"
      && selectedEntityIds.has(reference.entityId));

  const candidates: ContinuityDirectiveSegment[] = [];
  const premise = withoutCommercialReferenceIdentities(input.world.premise, selectedReferences, 500);
  if (premise) candidates.push({ kind: "world", sourceId: input.world.id, facet: null, text: `World continuity: ${premise}.` });

  for (const entity of selectedEntities) {
    const summary = withoutCommercialReferenceIdentities(entity.summary, selectedReferences, 360);
    const entityName = withoutCommercialReferenceIdentities(entity.name, selectedReferences, 100);
    if (summary) candidates.push({ kind: "entity", sourceId: entity.id, facet: "identity", text: `${title(entity.kind)}${entityName ? ` ${entityName}` : ""}: ${summary}.` });
    for (const attribute of attributeText(entity.attributes)) {
      const value = withoutCommercialReferenceIdentities(attribute.value, selectedReferences, 240);
      if (value) candidates.push({ kind: "entity", sourceId: entity.id, facet: attribute.facet, text: `${title(attribute.facet)}: ${value}.` });
    }
  }

  for (const rule of selectedRules) {
    const instruction = withoutCommercialReferenceIdentities(rule.instruction, selectedReferences, 360);
    if (instruction) candidates.push({
      kind: "rule",
      sourceId: rule.id,
      facet: rule.facet,
      text: `${rule.strength === "must" ? "Keep" : rule.strength === "avoid" ? "Avoid" : "Prefer"} ${rule.facet}: ${instruction}.`,
    });
  }

  for (const reference of selectedReferences) {
    for (const note of attributeText(reference.continuityNotes)) {
      const value = withoutCommercialReferenceIdentities(note.value, selectedReferences, 240);
      if (value) candidates.push({ kind: "reference", sourceId: reference.id, facet: note.facet, text: `Reference guidance for ${note.facet}: ${value}.` });
    }
  }

  const segments: ContinuityDirectiveSegment[] = [];
  let text = "";
  for (const candidate of candidates) {
    const next = text ? `${text} ${candidate.text}` : candidate.text;
    if (next.length > maxCharacters) break;
    segments.push(candidate);
    text = next;
  }

  const usedEntityIds = unique(segments.filter((segment) => segment.kind === "entity").map((segment) => segment.sourceId));
  const usedRuleIds = unique(segments.filter((segment) => segment.kind === "rule").map((segment) => segment.sourceId));
  const usedReferenceIds = unique(segments.filter((segment) => segment.kind === "reference").map((segment) => segment.sourceId));
  const facets = unique(segments.flatMap((segment) => segment.facet ? [segment.facet] : []));

  return {
    schemaVersion: CONTINUITY_DIRECTIVE_SCHEMA_VERSION,
    worldId: input.world.id,
    modality: input.modality,
    text,
    segments,
    entityIds: usedEntityIds,
    ruleIds: usedRuleIds,
    referenceIds: usedReferenceIds,
    excludedCommercialReferenceIdentityIds: selectedReferences
      .filter((reference) => reference.source.kind === "commercial-reference")
      .map((reference) => reference.id),
    facets,
    truncated: segments.length < candidates.length,
  };
}

/**
 * Creates an immutable promotion result. Persistence must still perform its
 * own optimistic-lock check before storing the returned reference.
 */
export function promoteCanonReference(
  request: PromoteToCanonRequest,
  reference: CanonReference,
  meta: { promotionId: string; actor: PromoteToCanonResult["actor"]; promotedAt: string },
): PromoteToCanonResult {
  if (request.schemaVersion !== PROMOTE_TO_CANON_SCHEMA_VERSION || request.confirmation !== "promote-to-canon") {
    throw new Error("canon_promotion_confirmation_required");
  }
  if (reference.id !== request.referenceId || reference.worldId !== request.worldId || reference.entityId !== request.entityId) {
    throw new Error("canon_promotion_reference_mismatch");
  }
  if (reference.status === "retired") throw new Error("canon_reference_retired");
  if (reference.version !== request.expectedReferenceVersion) throw new Error("canon_reference_version_conflict");
  const note = clean(request.note, 500);
  if (note.length < 4) throw new Error("canon_promotion_note_required");
  const facets = normalizedFacets(request.facets);
  if (!facets.length) throw new Error("canon_promotion_facets_required");
  const promotionId = clean(meta.promotionId, 100);
  const promotedAt = clean(meta.promotedAt, 40);
  if (!promotionId || !promotedAt) throw new Error("canon_promotion_metadata_required");

  const promotedReference: CanonReference = {
    ...reference,
    status: "canonical",
    continuityNotes: reference.continuityNotes.filter((entry) => facets.includes(entry.facet)),
    version: reference.version + 1,
    updatedAt: promotedAt,
  };
  return {
    schemaVersion: PROMOTE_TO_CANON_SCHEMA_VERSION,
    promotionId,
    worldId: request.worldId,
    entityId: request.entityId,
    referenceId: request.referenceId,
    facets,
    note,
    actor: meta.actor,
    evidenceReviewId: clean(request.evidenceReviewId, 100) || null,
    promotedAt,
    reference: promotedReference,
  };
}
