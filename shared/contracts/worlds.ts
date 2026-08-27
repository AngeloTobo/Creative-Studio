export const CREATIVE_WORLD_SCHEMA_VERSION = "creative-studio-world/1.0" as const;
export const WORLD_ENTITY_SCHEMA_VERSION = "creative-studio-world-entity/1.0" as const;
export const CONTINUITY_RULE_SCHEMA_VERSION = "creative-studio-continuity-rule/1.0" as const;
export const CANON_REFERENCE_SCHEMA_VERSION = "creative-studio-canon-reference/1.0" as const;
export const CONTINUITY_DIRECTIVE_SCHEMA_VERSION = "creative-studio-continuity-directive/1.0" as const;
export const PROMOTE_TO_CANON_SCHEMA_VERSION = "creative-studio-promote-to-canon/1.0" as const;
export const GENERATION_CONTINUITY_SELECTION_SCHEMA_VERSION = "creative-studio-generation-continuity-selection/1.0" as const;
export const GENERATION_CONTINUITY_STAMP_SCHEMA_VERSION = "creative-studio-generation-continuity-stamp/1.0" as const;

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

export type CreateWorldRequest = {
  projectId: string;
  name: string;
  premise?: string;
};

export type UpdateWorldRequest = {
  name?: string;
  premise?: string;
  status?: WorldStatus;
  expectedVersion: number;
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

export type CreateWorldEntityRequest = {
  projectId: string;
  kind: WorldEntityKind;
  name: string;
  summary?: string;
  aliases?: string[];
  attributes?: ContinuityAttribute[];
};

export type UpdateWorldEntityRequest = {
  name?: string;
  summary?: string;
  aliases?: string[];
  attributes?: ContinuityAttribute[];
  status?: WorldEntityStatus;
  expectedVersion: number;
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

export type CreateCanonReferenceRequest = {
  projectId: string;
  entityId: string;
  source: CanonReferenceSource;
  continuityNotes: ContinuityAttribute[];
};

export type UpdateCanonReferenceRequest = {
  continuityNotes?: ContinuityAttribute[];
  status?: "candidate" | "retired";
  expectedVersion: number;
};

export type ContinuityRule = {
  schemaVersion: typeof CONTINUITY_RULE_SCHEMA_VERSION;
  id: string;
  worldId: string;
  projectId: string;
  entityIds: string[];
  facet: ContinuityFacet;
  strength: ContinuityRuleStrength;
  instruction: string;
  modalities: ContinuityModality[];
  status: ContinuityRuleStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateContinuityRuleRequest = {
  projectId: string;
  entityIds?: string[];
  facet: ContinuityFacet;
  strength: ContinuityRuleStrength;
  instruction: string;
  modalities: ContinuityModality[];
};

export type UpdateContinuityRuleRequest = {
  entityIds?: string[];
  facet?: ContinuityFacet;
  strength?: ContinuityRuleStrength;
  instruction?: string;
  modalities?: ContinuityModality[];
  status?: ContinuityRuleStatus;
  expectedVersion: number;
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

export type PromoteArtifactToCanonRequest = {
  schemaVersion: typeof PROMOTE_TO_CANON_SCHEMA_VERSION;
  confirmation: "promote-artifact-to-canon";
  projectId: string;
  worldId: string;
  entityId: string;
  artifactId: string;
  facets: ContinuityFacet[];
  continuityNotes: ContinuityAttribute[];
  note: string;
  expectedEntityVersion: number;
  acceptanceId?: string | null;
};

export type PromoteArtifactToCanonResult = {
  schemaVersion: typeof PROMOTE_TO_CANON_SCHEMA_VERSION;
  artifactId: string;
  promotion: PromoteToCanonResult;
};

export type CanonPromotion = Omit<PromoteToCanonResult, "reference"> & {
  referenceVersion: number;
  sourceArtifactId: string | null;
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

export type VersionedContinuitySelection = {
  id: string;
  version: number;
};

/**
 * The browser selects record identities plus the exact versions it inspected.
 * The Worker must reject a stale selection and compile the provider directive
 * again from owner-scoped canonical records.
 */
export type GenerationContinuitySelection = {
  schemaVersion: typeof GENERATION_CONTINUITY_SELECTION_SCHEMA_VERSION;
  modality: ContinuityModality;
  world: VersionedContinuitySelection;
  entities: readonly VersionedContinuitySelection[];
  rules: readonly VersionedContinuitySelection[];
  references: readonly VersionedContinuitySelection[];
};

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

/**
 * Immutable generation evidence. It retains the exact compiled text and the
 * complete versioned records used to produce it, even after current World
 * records evolve. Commercial identities may remain in these provenance-only
 * snapshots, but never in `directive.text`.
 */
export type GenerationContinuityStamp = {
  readonly schemaVersion: typeof GENERATION_CONTINUITY_STAMP_SCHEMA_VERSION;
  readonly createdAt: string;
  readonly selection: DeepReadonly<GenerationContinuitySelection>;
  readonly directive: DeepReadonly<ContinuityDirective>;
  readonly records: {
    readonly world: DeepReadonly<World>;
    readonly entities: readonly DeepReadonly<WorldEntity>[];
    readonly rules: readonly DeepReadonly<ContinuityRule>[];
    readonly references: readonly DeepReadonly<CanonReference>[];
    /** Exact provenance-only records whose identities were excluded from provider text. */
    readonly redactionReferences: readonly DeepReadonly<CanonReference>[];
  };
};

export type CreateGenerationContinuityStampInput = {
  selection: GenerationContinuitySelection;
  directive: ContinuityDirective;
  world: World;
  entities: readonly WorldEntity[];
  rules: readonly ContinuityRule[];
  references: readonly CanonReference[];
  redactionReferences?: readonly CanonReference[];
  createdAt: string;
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

function normalizedText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clean(value: unknown, maxLength: number) {
  return normalizedText(value).slice(0, maxLength);
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

function selectedVersionedRecords<T extends { id: string; version: number }>(
  values: readonly T[],
  selected: readonly VersionedContinuitySelection[],
  error: string,
) {
  const byId = new Map(values.map((value) => [value.id, value]));
  const seen = new Set<string>();
  return selected.map((entry) => {
    if (seen.has(entry.id)) throw new Error(`${error}_duplicate`);
    seen.add(entry.id);
    const record = byId.get(entry.id);
    if (!record || record.version !== entry.version) throw new Error(error);
    return record;
  });
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function attributeText(attributes: readonly ContinuityAttribute[]) {
  return attributes
    // Keep the full normalized stored value until every commercial identity
    // has been removed. Truncating here can leave an unmatched identity prefix
    // when the identity straddles the eventual provider-field boundary.
    .map((attribute) => ({ facet: attribute.facet, value: normalizedText(attribute.value) }))
    .filter((attribute) => attribute.value && FACETS.has(attribute.facet));
}

function commercialIdentityPattern(reference: CanonReference) {
  if (reference.source.kind !== "commercial-reference") return null;
  const identity = normalizedText(reference.source.identity);
  if (!identity) return null;
  const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?:['’]s)?(?=$|[^\\p{L}\\p{N}_])`, "iu");
}

export function containsCommercialReferenceIdentity(value: string, references: readonly CanonReference[]) {
  return references.some((reference) => commercialIdentityPattern(reference)?.test(value) ?? false);
}

function withoutCommercialReferenceIdentities(value: string, references: readonly CanonReference[], maxLength = 360) {
  // Redact against the complete normalized stored field. Applying maxLength
  // first can split a protected identity and leave its leading fragment in the
  // provider prompt because the shortened fragment no longer matches.
  let result = normalizedText(value);
  for (const reference of references) {
    const pattern = commercialIdentityPattern(reference);
    if (!pattern) continue;
    result = result.replace(
      new RegExp(pattern.source, "giu"),
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
  // Redaction is deliberately broader than selection: an unselected lineage
  // reference can still have its identity repeated in editable World text.
  const commercialIdentityReferences = (input.references ?? [])
    .filter((reference) => reference.worldId === input.world.id
      && reference.projectId === input.world.projectId
      && reference.source.kind === "commercial-reference"
      && Boolean(normalizedText(reference.source.identity)));
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
  const premise = withoutCommercialReferenceIdentities(input.world.premise, commercialIdentityReferences, 500);
  if (premise) candidates.push({ kind: "world", sourceId: input.world.id, facet: null, text: `World continuity: ${premise}.` });

  for (const entity of selectedEntities) {
    const summary = withoutCommercialReferenceIdentities(entity.summary, commercialIdentityReferences, 360);
    const entityName = withoutCommercialReferenceIdentities(entity.name, commercialIdentityReferences, 100);
    if (summary) candidates.push({ kind: "entity", sourceId: entity.id, facet: "identity", text: `${title(entity.kind)}${entityName ? ` ${entityName}` : ""}: ${summary}.` });
    for (const attribute of attributeText(entity.attributes)) {
      const value = withoutCommercialReferenceIdentities(attribute.value, commercialIdentityReferences, 240);
      if (value) candidates.push({ kind: "entity", sourceId: entity.id, facet: attribute.facet, text: `${title(attribute.facet)}: ${value}.` });
    }
  }

  for (const rule of selectedRules) {
    const instruction = withoutCommercialReferenceIdentities(rule.instruction, commercialIdentityReferences, 360);
    if (instruction) candidates.push({
      kind: "rule",
      sourceId: rule.id,
      facet: rule.facet,
      text: `${rule.strength === "must" ? "Keep" : rule.strength === "avoid" ? "Avoid" : "Prefer"} ${rule.facet}: ${instruction}.`,
    });
  }

  for (const reference of selectedReferences) {
    for (const note of attributeText(reference.continuityNotes)) {
      const value = withoutCommercialReferenceIdentities(note.value, commercialIdentityReferences, 240);
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
    excludedCommercialReferenceIdentityIds: unique(commercialIdentityReferences.map((reference) => reference.id)),
    facets,
    truncated: segments.length < candidates.length,
  };
}

/**
 * Creates the append-only continuity evidence stored on a generation job.
 * Persistence must still load all records by owner/project and perform the
 * optimistic-lock checks in the same write boundary as job creation.
 */
export function createGenerationContinuityStamp(input: CreateGenerationContinuityStampInput): GenerationContinuityStamp {
  if (input.selection.schemaVersion !== GENERATION_CONTINUITY_SELECTION_SCHEMA_VERSION) {
    throw new Error("invalid_continuity_selection_schema");
  }
  if (input.directive.schemaVersion !== CONTINUITY_DIRECTIVE_SCHEMA_VERSION
    || input.selection.modality !== input.directive.modality) {
    throw new Error("continuity_modality_mismatch");
  }
  if (input.selection.world.id !== input.world.id
    || input.selection.world.version !== input.world.version
    || input.directive.worldId !== input.world.id) {
    throw new Error("continuity_world_version_mismatch");
  }

  const entities = selectedVersionedRecords(input.entities, input.selection.entities, "continuity_entity_version_mismatch");
  const rules = selectedVersionedRecords(input.rules, input.selection.rules, "continuity_rule_version_mismatch");
  const references = selectedVersionedRecords(input.references, input.selection.references, "continuity_reference_version_mismatch");
  const redactionReferences = [...(input.redactionReferences ?? input.references.filter((reference) => reference.source.kind === "commercial-reference"))];
  if (entities.some((record) => record.worldId !== input.world.id || record.projectId !== input.world.projectId)
    || rules.some((record) => record.worldId !== input.world.id || record.projectId !== input.world.projectId)
    || references.some((record) => record.worldId !== input.world.id || record.projectId !== input.world.projectId)) {
    throw new Error("continuity_record_scope_mismatch");
  }

  const selectedEntityIds = new Set(entities.map((record) => record.id));
  const selectedRuleIds = new Set(rules.map((record) => record.id));
  const selectedReferenceIds = new Set(references.map((record) => record.id));
  if (input.directive.entityIds.some((id) => !selectedEntityIds.has(id))
    || input.directive.ruleIds.some((id) => !selectedRuleIds.has(id))
    || input.directive.referenceIds.some((id) => !selectedReferenceIds.has(id))) {
    throw new Error("continuity_directive_selection_mismatch");
  }
  if (references.some((reference) => reference.entityId && !selectedEntityIds.has(reference.entityId))) {
    throw new Error("continuity_reference_entity_mismatch");
  }
  const redactionReferenceIds = new Set<string>();
  for (const reference of redactionReferences) {
    if (redactionReferenceIds.has(reference.id)) throw new Error("continuity_redaction_reference_duplicate");
    redactionReferenceIds.add(reference.id);
    if (reference.worldId !== input.world.id || reference.projectId !== input.world.projectId
      || reference.source.kind !== "commercial-reference" || reference.version < 1) {
      throw new Error("continuity_redaction_reference_mismatch");
    }
  }
  if (input.directive.excludedCommercialReferenceIdentityIds.some((id) => !redactionReferenceIds.has(id))) {
    throw new Error("continuity_redaction_evidence_missing");
  }
  for (const reference of references) {
    if (reference.source.kind !== "commercial-reference") continue;
    if (containsCommercialReferenceIdentity(input.directive.text, [reference])) {
      throw new Error("continuity_commercial_identity_in_prompt");
    }
  }

  const createdAt = clean(input.createdAt, 40);
  if (!createdAt) throw new Error("continuity_stamp_timestamp_required");
  return jsonClone({
    schemaVersion: GENERATION_CONTINUITY_STAMP_SCHEMA_VERSION,
    createdAt,
    selection: input.selection,
    directive: input.directive,
    records: { world: input.world, entities, rules, references, redactionReferences },
  });
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
  const guidedFacets = new Set(attributeText(reference.continuityNotes).map((entry) => entry.facet));
  if (facets.some((facet) => !guidedFacets.has(facet))) throw new Error("canon_promotion_facet_guidance_required");
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
