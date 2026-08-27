import {
  CANON_REFERENCE_SCHEMA_VERSION,
  CONTINUITY_FACETS,
  CONTINUITY_RULE_SCHEMA_VERSION,
  CREATIVE_WORLD_SCHEMA_VERSION,
  GENERATION_CONTINUITY_SELECTION_SCHEMA_VERSION,
  PROMOTE_TO_CANON_SCHEMA_VERSION,
  WORLD_ENTITY_SCHEMA_VERSION,
  compileContinuityDirective,
  containsCommercialReferenceIdentity,
  createGenerationContinuityStamp,
  promoteCanonReference,
  type CanonPromotion,
  type CanonReference,
  type CanonReferenceSource,
  type ContinuityAttribute,
  type ContinuityFacet,
  type ContinuityModality,
  type ContinuityRule,
  type ContinuityRuleStrength,
  type CreateCanonReferenceRequest,
  type CreateContinuityRuleRequest,
  type CreateWorldEntityRequest,
  type CreateWorldRequest,
  type GenerationContinuitySelection,
  type GenerationContinuityStamp,
  type PromoteArtifactToCanonRequest,
  type PromoteArtifactToCanonResult,
  type PromoteToCanonRequest,
  type PromoteToCanonResult,
  type UpdateCanonReferenceRequest,
  type UpdateContinuityRuleRequest,
  type UpdateWorldEntityRequest,
  type UpdateWorldRequest,
  type World,
  type WorldEntity,
  type WorldEntityKind,
} from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import type { Env } from "./types";

type WorldRow = Omit<World, "schemaVersion" | "entityIds" | "continuityRuleIds">;
type WorldEntityRow = Omit<WorldEntity, "schemaVersion" | "aliases" | "attributes" | "canonReferenceIds"> & {
  aliasesJson: string;
  attributesJson: string;
};
type ContinuityRuleRow = Omit<ContinuityRule, "schemaVersion" | "entityIds" | "modalities"> & {
  entityIdsJson: string;
  modalitiesJson: string;
};
type CanonReferenceRow = Omit<CanonReference, "schemaVersion" | "source" | "continuityNotes" | "rights"> & {
  sourceJson: string;
  continuityNotesJson: string;
  rightsPolicy: CanonReference["rights"]["policy"];
};
type CanonPromotionRow = Omit<CanonPromotion, "schemaVersion" | "facets"> & { facetsJson: string };

const WORLD_COLUMNS = `id, project_id as projectId, name, premise, status, version,
  created_at as createdAt, updated_at as updatedAt`;
const ENTITY_COLUMNS = `id, world_id as worldId, project_id as projectId, kind, name, summary,
  aliases_json as aliasesJson, attributes_json as attributesJson, status, version,
  created_at as createdAt, updated_at as updatedAt`;
const RULE_COLUMNS = `id, world_id as worldId, project_id as projectId, entity_ids_json as entityIdsJson,
  facet, strength, instruction, modalities_json as modalitiesJson, status, version,
  created_at as createdAt, updated_at as updatedAt`;
const REFERENCE_COLUMNS = `id, world_id as worldId, project_id as projectId, entity_id as entityId,
  source_json as sourceJson, continuity_notes_json as continuityNotesJson, status,
  rights_policy as rightsPolicy, version, created_at as createdAt, updated_at as updatedAt`;
const PROMOTION_COLUMNS = `id as promotionId, world_id as worldId, entity_id as entityId,
  reference_id as referenceId, facets_json as facetsJson, note, actor,
  evidence_review_id as evidenceReviewId, source_artifact_id as sourceArtifactId,
  reference_version as referenceVersion, promoted_at as promotedAt`;

const FACETS = new Set<string>(CONTINUITY_FACETS);
const ENTITY_KINDS = new Set<WorldEntityKind>(["character", "place", "object"]);
const RULE_STRENGTHS = new Set<ContinuityRuleStrength>(["must", "prefer", "avoid"]);
const MODALITIES = new Set<ContinuityModality>(["image", "video", "music"]);

function storedJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function unique(values: readonly string[], limit: number, maxLength = 100) {
  return [...new Set(values.map((value) => boundedText(value, maxLength)).filter(Boolean))].slice(0, limit);
}

function normalizedAttributes(value: unknown, limit = 24): ContinuityAttribute[] {
  if (!Array.isArray(value)) throw new Error("invalid_continuity_attributes");
  const attributes = value.slice(0, limit).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("invalid_continuity_attributes");
    const attribute = entry as Partial<ContinuityAttribute>;
    const facet = boundedText(attribute.facet, 40) as ContinuityFacet;
    const text = boundedText(attribute.value, 360);
    if (!FACETS.has(facet) || !text) throw new Error("invalid_continuity_attributes");
    return { facet, value: text };
  });
  return attributes.filter((attribute, index) => attributes.findIndex((candidate) => candidate.facet === attribute.facet && candidate.value === attribute.value) === index);
}

function normalizedFacets(value: unknown) {
  if (!Array.isArray(value)) throw new Error("canon_promotion_facets_required");
  const facets = unique(value.map(String), CONTINUITY_FACETS.length, 40).filter((facet): facet is ContinuityFacet => FACETS.has(facet));
  if (!facets.length) throw new Error("canon_promotion_facets_required");
  return facets;
}

function normalizedModalities(value: unknown) {
  if (!Array.isArray(value)) throw new Error("invalid_continuity_modalities");
  const modalities = unique(value.map(String), 3, 20).filter((item): item is ContinuityModality => MODALITIES.has(item as ContinuityModality));
  if (!modalities.length) throw new Error("invalid_continuity_modalities");
  return modalities;
}

function mapEntity(row: WorldEntityRow, referenceIds: string[]): WorldEntity {
  return {
    schemaVersion: WORLD_ENTITY_SCHEMA_VERSION,
    id: row.id,
    worldId: row.worldId,
    projectId: row.projectId,
    kind: row.kind,
    name: row.name,
    summary: row.summary,
    aliases: storedJson<string[]>(row.aliasesJson, []),
    attributes: storedJson<ContinuityAttribute[]>(row.attributesJson, []),
    canonReferenceIds: referenceIds,
    status: row.status,
    version: Number(row.version),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRule(row: ContinuityRuleRow): ContinuityRule {
  return {
    schemaVersion: CONTINUITY_RULE_SCHEMA_VERSION,
    id: row.id,
    worldId: row.worldId,
    projectId: row.projectId,
    entityIds: storedJson<string[]>(row.entityIdsJson, []),
    facet: row.facet,
    strength: row.strength,
    instruction: row.instruction,
    modalities: storedJson<ContinuityModality[]>(row.modalitiesJson, []),
    status: row.status,
    version: Number(row.version),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapReference(row: CanonReferenceRow): CanonReference {
  return {
    schemaVersion: CANON_REFERENCE_SCHEMA_VERSION,
    id: row.id,
    worldId: row.worldId,
    projectId: row.projectId,
    entityId: row.entityId,
    source: storedJson<CanonReferenceSource>(row.sourceJson, { kind: "commercial-reference", identity: "", lineageOnly: true }),
    continuityNotes: storedJson<ContinuityAttribute[]>(row.continuityNotesJson, []),
    status: row.status,
    rights: {
      policy: row.rightsPolicy,
      sourceIdentityPromptEligible: false,
      rawMediaPromptEligible: false,
    },
    version: Number(row.version),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPromotion(row: CanonPromotionRow): CanonPromotion {
  return {
    schemaVersion: PROMOTE_TO_CANON_SCHEMA_VERSION,
    promotionId: row.promotionId,
    worldId: row.worldId,
    entityId: row.entityId,
    referenceId: row.referenceId,
    facets: storedJson<ContinuityFacet[]>(row.facetsJson, []),
    note: row.note,
    actor: row.actor,
    evidenceReviewId: row.evidenceReviewId,
    promotedAt: row.promotedAt,
    referenceVersion: Number(row.referenceVersion),
    sourceArtifactId: row.sourceArtifactId,
  };
}

async function projectStatus(env: Env, ownerId: string, projectId: string) {
  return env.DB.prepare("select status from creative_projects where id = ? and owner_id = ?")
    .bind(projectId, ownerId).first<{ status: string }>();
}

async function assertActiveProject(env: Env, ownerId: string, projectId: string) {
  const project = await projectStatus(env, ownerId, projectId);
  if (!project) throw new Error("project_not_found");
  if (project.status === "archived") throw new Error("project_archived");
}

export async function listWorldRecords(env: Env, ownerId: string) {
  const [worldRows, entityRows, ruleRows, referenceRows, promotionRows] = await Promise.all([
    env.DB.prepare(`select ${WORLD_COLUMNS} from creative_worlds where owner_id = ? order by case when status = 'archived' then 1 else 0 end, updated_at desc, id desc`).bind(ownerId).all<WorldRow>(),
    env.DB.prepare(`select ${ENTITY_COLUMNS} from creative_world_entities where owner_id = ? order by updated_at desc, id desc`).bind(ownerId).all<WorldEntityRow>(),
    env.DB.prepare(`select ${RULE_COLUMNS} from creative_continuity_rules where owner_id = ? order by updated_at desc, id desc`).bind(ownerId).all<ContinuityRuleRow>(),
    env.DB.prepare(`select ${REFERENCE_COLUMNS} from creative_canon_references where owner_id = ? order by updated_at desc, id desc`).bind(ownerId).all<CanonReferenceRow>(),
    env.DB.prepare(`select ${PROMOTION_COLUMNS} from creative_canon_promotions where owner_id = ? order by promoted_at desc, id desc`).bind(ownerId).all<CanonPromotionRow>(),
  ]);
  const references = (referenceRows.results ?? []).map(mapReference);
  const referenceIdsByEntity = new Map<string, string[]>();
  for (const reference of references) {
    if (reference.status === "retired") continue;
    const ids = referenceIdsByEntity.get(reference.entityId) ?? [];
    ids.push(reference.id);
    referenceIdsByEntity.set(reference.entityId, ids);
  }
  const entities = (entityRows.results ?? []).map((row) => mapEntity(row, referenceIdsByEntity.get(row.id) ?? []));
  const rules = (ruleRows.results ?? []).map(mapRule);
  const worlds = (worldRows.results ?? []).map((row): World => ({
    schemaVersion: CREATIVE_WORLD_SCHEMA_VERSION,
    ...row,
    version: Number(row.version),
    entityIds: entities.filter((entity) => entity.worldId === row.id && entity.status !== "retired").map((entity) => entity.id),
    continuityRuleIds: rules.filter((rule) => rule.worldId === row.id && rule.status !== "retired").map((rule) => rule.id),
  }));
  return {
    worlds,
    worldEntities: entities,
    continuityRules: rules,
    canonReferences: references,
    canonPromotions: (promotionRows.results ?? []).map(mapPromotion),
  };
}

export async function worldById(env: Env, ownerId: string, worldId: string) {
  const records = await listWorldRecords(env, ownerId);
  const world = records.worlds.find((item) => item.id === worldId) ?? null;
  return world ? {
    world,
    entities: records.worldEntities.filter((item) => item.worldId === world.id),
    rules: records.continuityRules.filter((item) => item.worldId === world.id),
    references: records.canonReferences.filter((item) => item.worldId === world.id),
    promotions: records.canonPromotions.filter((item) => item.worldId === world.id),
  } : null;
}

export async function createWorld(env: Env, ownerId: string, input: CreateWorldRequest) {
  const projectId = boundedText(input.projectId, 100);
  const name = boundedText(input.name, 100);
  if (!projectId) throw new Error("project_required");
  if (!name) throw new Error("world_name_required");
  await assertActiveProject(env, ownerId, projectId);
  const now = new Date().toISOString();
  const worldId = id("world");
  await env.DB.prepare(`insert into creative_worlds
    (id, owner_id, project_id, name, premise, status, version, created_at, updated_at)
    values (?, ?, ?, ?, ?, 'active', 1, ?, ?)`)
    .bind(worldId, ownerId, projectId, name, boundedText(input.premise, 1_200), now, now).run();
  return (await worldById(env, ownerId, worldId))!.world;
}

export async function updateWorld(env: Env, ownerId: string, worldId: string, input: UpdateWorldRequest) {
  const current = await worldById(env, ownerId, worldId);
  if (!current) throw new Error("world_not_found");
  if (current.world.version !== Number(input.expectedVersion)) throw new Error("world_version_conflict");
  if (current.world.status === "archived"
    && (input.status !== "active" || input.name !== undefined || input.premise !== undefined)) throw new Error("world_archived");
  const name = input.name === undefined ? current.world.name : boundedText(input.name, 100);
  if (!name) throw new Error("world_name_required");
  const premise = input.premise === undefined ? current.world.premise : boundedText(input.premise, 1_200);
  const status = input.status ?? current.world.status;
  if (status !== "active" && status !== "archived") throw new Error("invalid_world_status");
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`update creative_worlds set name = ?, premise = ?, status = ?, version = version + 1,
    updated_at = ? where id = ? and owner_id = ? and version = ?`)
    .bind(name, premise, status, now, worldId, ownerId, current.world.version).run();
  if (!result.meta.changes) throw new Error("world_version_conflict");
  return (await worldById(env, ownerId, worldId))!.world;
}

function entityValues(input: CreateWorldEntityRequest | (UpdateWorldEntityRequest & { projectId: string; kind: WorldEntityKind }), current?: WorldEntity) {
  const kind = "kind" in input ? input.kind : current?.kind;
  if (!kind || !ENTITY_KINDS.has(kind)) throw new Error("invalid_world_entity_kind");
  const name = "name" in input && input.name !== undefined ? boundedText(input.name, 100) : current?.name ?? "";
  if (!name) throw new Error("world_entity_name_required");
  return {
    kind,
    name,
    summary: "summary" in input && input.summary !== undefined ? boundedText(input.summary, 800) : current?.summary ?? "",
    aliases: "aliases" in input && input.aliases !== undefined ? unique(input.aliases, 12, 100) : current?.aliases ?? [],
    attributes: "attributes" in input && input.attributes !== undefined ? normalizedAttributes(input.attributes) : current?.attributes ?? [],
  };
}

export async function createWorldEntity(env: Env, ownerId: string, worldId: string, input: CreateWorldEntityRequest) {
  const currentWorld = await worldById(env, ownerId, worldId);
  if (!currentWorld) throw new Error("world_not_found");
  if (currentWorld.world.status === "archived") throw new Error("world_archived");
  if (boundedText(input.projectId, 100) !== currentWorld.world.projectId) throw new Error("world_project_mismatch");
  const values = entityValues(input);
  const now = new Date().toISOString();
  const entityId = id("entity");
  await env.DB.prepare(`insert into creative_world_entities
    (id, owner_id, world_id, project_id, kind, name, summary, aliases_json, attributes_json, status, version, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`)
    .bind(entityId, ownerId, worldId, currentWorld.world.projectId, values.kind, values.name, values.summary,
      JSON.stringify(values.aliases), JSON.stringify(values.attributes), now, now).run();
  return (await worldById(env, ownerId, worldId))!.entities.find((item) => item.id === entityId)!;
}

export async function updateWorldEntity(env: Env, ownerId: string, worldId: string, entityId: string, input: UpdateWorldEntityRequest) {
  const records = await worldById(env, ownerId, worldId);
  if (!records) throw new Error("world_not_found");
  if (records.world.status === "archived") throw new Error("world_archived");
  const current = records.entities.find((item) => item.id === entityId);
  if (!current) throw new Error("world_entity_not_found");
  if (current.version !== Number(input.expectedVersion)) throw new Error("world_entity_version_conflict");
  const values = entityValues({ ...input, projectId: current.projectId, kind: current.kind }, current);
  const status = input.status ?? current.status;
  if (status !== "active" && status !== "retired") throw new Error("invalid_world_entity_status");
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`update creative_world_entities set name = ?, summary = ?, aliases_json = ?, attributes_json = ?,
    status = ?, version = version + 1, updated_at = ? where id = ? and world_id = ? and owner_id = ? and version = ?`)
    .bind(values.name, values.summary, JSON.stringify(values.aliases), JSON.stringify(values.attributes), status,
      now, entityId, worldId, ownerId, current.version).run();
  if (!result.meta.changes) throw new Error("world_entity_version_conflict");
  return (await worldById(env, ownerId, worldId))!.entities.find((item) => item.id === entityId)!;
}

function ruleValues(input: CreateContinuityRuleRequest | UpdateContinuityRuleRequest, current?: ContinuityRule) {
  const facet = input.facet ?? current?.facet;
  const strength = input.strength ?? current?.strength;
  const instruction = input.instruction === undefined ? current?.instruction ?? "" : boundedText(input.instruction, 500);
  if (!facet || !FACETS.has(facet)) throw new Error("invalid_continuity_facet");
  if (!strength || !RULE_STRENGTHS.has(strength)) throw new Error("invalid_continuity_rule_strength");
  if (!instruction) throw new Error("continuity_rule_instruction_required");
  return {
    facet,
    strength,
    instruction,
    entityIds: input.entityIds === undefined ? current?.entityIds ?? [] : unique(input.entityIds, 24),
    modalities: input.modalities === undefined ? current?.modalities ?? [] : normalizedModalities(input.modalities),
  };
}

async function assertRuleEntities(records: NonNullable<Awaited<ReturnType<typeof worldById>>>, entityIds: string[]) {
  if (entityIds.some((entityId) => !records.entities.some((entity) => entity.id === entityId && entity.status === "active"))) {
    throw new Error("continuity_rule_entity_not_found");
  }
}

export async function createContinuityRule(env: Env, ownerId: string, worldId: string, input: CreateContinuityRuleRequest) {
  const records = await worldById(env, ownerId, worldId);
  if (!records) throw new Error("world_not_found");
  if (records.world.status === "archived") throw new Error("world_archived");
  if (boundedText(input.projectId, 100) !== records.world.projectId) throw new Error("world_project_mismatch");
  const values = ruleValues(input);
  await assertRuleEntities(records, values.entityIds);
  const now = new Date().toISOString();
  const ruleId = id("rule");
  await env.DB.prepare(`insert into creative_continuity_rules
    (id, owner_id, world_id, project_id, entity_ids_json, facet, strength, instruction, modalities_json, status, version, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`)
    .bind(ruleId, ownerId, worldId, records.world.projectId, JSON.stringify(values.entityIds), values.facet,
      values.strength, values.instruction, JSON.stringify(values.modalities), now, now).run();
  return (await worldById(env, ownerId, worldId))!.rules.find((item) => item.id === ruleId)!;
}

export async function updateContinuityRule(env: Env, ownerId: string, worldId: string, ruleId: string, input: UpdateContinuityRuleRequest) {
  const records = await worldById(env, ownerId, worldId);
  if (!records) throw new Error("world_not_found");
  if (records.world.status === "archived") throw new Error("world_archived");
  const current = records.rules.find((item) => item.id === ruleId);
  if (!current) throw new Error("continuity_rule_not_found");
  if (current.version !== Number(input.expectedVersion)) throw new Error("continuity_rule_version_conflict");
  const values = ruleValues(input, current);
  const status = input.status ?? current.status;
  if (status !== "active" && status !== "retired") throw new Error("invalid_continuity_rule_status");
  if (status === "active") await assertRuleEntities(records, values.entityIds);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`update creative_continuity_rules set entity_ids_json = ?, facet = ?, strength = ?, instruction = ?,
    modalities_json = ?, status = ?, version = version + 1, updated_at = ?
    where id = ? and world_id = ? and owner_id = ? and version = ?`)
    .bind(JSON.stringify(values.entityIds), values.facet, values.strength, values.instruction, JSON.stringify(values.modalities),
      status, now, ruleId, worldId, ownerId, current.version).run();
  if (!result.meta.changes) throw new Error("continuity_rule_version_conflict");
  return (await worldById(env, ownerId, worldId))!.rules.find((item) => item.id === ruleId)!;
}

async function validatedReferenceSource(env: Env, ownerId: string, projectId: string, source: CanonReferenceSource): Promise<CanonReferenceSource> {
  if (source.kind === "owner-upload") {
    const mediaId = boundedText(source.mediaId, 100);
    const media = await env.DB.prepare("select project_id as projectId, status from creative_media_assets where id = ? and owner_id = ?")
      .bind(mediaId, ownerId).first<{ projectId: string; status: string }>();
    if (!media || media.status !== "retained") throw new Error("canon_reference_media_not_found");
    if (media.projectId !== projectId) throw new Error("canon_reference_project_mismatch");
    return { kind: "owner-upload", mediaId, label: boundedText(source.label, 160) || "Owner upload" };
  }
  if (source.kind === "retained-artifact") {
    const artifactId = boundedText(source.artifactId, 100);
    const artifact = await env.DB.prepare("select project_id as projectId, retained_key as retainedKey, status from creative_artifacts where id = ? and owner_id = ?")
      .bind(artifactId, ownerId).first<{ projectId: string; retainedKey: string | null; status: string }>();
    if (!artifact?.retainedKey) throw new Error("canon_reference_artifact_not_retained");
    if (artifact.status !== "accepted") throw new Error("canon_reference_artifact_acceptance_required");
    if (artifact.projectId !== projectId) throw new Error("canon_reference_project_mismatch");
    const acceptance = await env.DB.prepare(`select id from creative_acceptances
      where owner_id = ? and artifact_id = ? and decision = 'accepted'
      order by created_at desc, id desc limit 1`)
      .bind(ownerId, artifactId).first<{ id: string }>();
    if (!acceptance) throw new Error("canon_reference_artifact_acceptance_required");
    return { kind: "retained-artifact", artifactId, label: boundedText(source.label, 160) || "Retained artifact" };
  }
  const identity = boundedText(source.identity, 240);
  if (!identity || source.lineageOnly !== true) throw new Error("invalid_commercial_reference");
  return { kind: "commercial-reference", identity, lineageOnly: true };
}

export async function createCanonReference(env: Env, ownerId: string, worldId: string, input: CreateCanonReferenceRequest) {
  const records = await worldById(env, ownerId, worldId);
  if (!records) throw new Error("world_not_found");
  if (records.world.status === "archived") throw new Error("world_archived");
  if (boundedText(input.projectId, 100) !== records.world.projectId) throw new Error("world_project_mismatch");
  const entity = records.entities.find((item) => item.id === boundedText(input.entityId, 100) && item.status === "active");
  if (!entity) throw new Error("world_entity_not_found");
  const source = await validatedReferenceSource(env, ownerId, records.world.projectId, input.source);
  const continuityNotes = normalizedAttributes(input.continuityNotes);
  if (!continuityNotes.length) throw new Error("canon_reference_notes_required");
  const referenceId = id("reference");
  const now = new Date().toISOString();
  const policy: CanonReference["rights"]["policy"] = source.kind === "commercial-reference" ? "abstract-attributes-only" : "owner-controlled";
  await env.DB.prepare(`insert into creative_canon_references
    (id, owner_id, world_id, project_id, entity_id, source_json, continuity_notes_json, status, rights_policy, version, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, 'candidate', ?, 1, ?, ?)`)
    .bind(referenceId, ownerId, worldId, records.world.projectId, entity.id, JSON.stringify(source),
      JSON.stringify(continuityNotes), policy, now, now).run();
  return (await worldById(env, ownerId, worldId))!.references.find((item) => item.id === referenceId)!;
}

export async function updateCanonReference(env: Env, ownerId: string, worldId: string, referenceId: string, input: UpdateCanonReferenceRequest) {
  const records = await worldById(env, ownerId, worldId);
  if (!records) throw new Error("world_not_found");
  if (records.world.status === "archived") throw new Error("world_archived");
  const current = records.references.find((item) => item.id === referenceId);
  if (!current) throw new Error("canon_reference_not_found");
  if (current.version !== Number(input.expectedVersion)) throw new Error("canon_reference_version_conflict");
  const status = input.status ?? current.status;
  if (status !== "candidate" && status !== "retired") throw new Error("invalid_canon_reference_status");
  const notes = input.continuityNotes === undefined ? current.continuityNotes : normalizedAttributes(input.continuityNotes);
  if (!notes.length) throw new Error("canon_reference_notes_required");
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`update creative_canon_references set continuity_notes_json = ?, status = ?, version = version + 1,
    updated_at = ? where id = ? and world_id = ? and owner_id = ? and version = ?`)
    .bind(JSON.stringify(notes), status, now, referenceId, worldId, ownerId, current.version).run();
  if (!result.meta.changes) throw new Error("canon_reference_version_conflict");
  return (await worldById(env, ownerId, worldId))!.references.find((item) => item.id === referenceId)!;
}

async function persistPromotion(env: Env, ownerId: string, projectId: string, result: PromoteToCanonResult, sourceArtifactId: string | null) {
  const artifactPredicate = sourceArtifactId ? `
    and exists (select 1 from creative_artifacts where id = ? and owner_id = ? and project_id = ?
      and status = 'accepted' and retained_key is not null)
    and ? = (select id from creative_acceptances where owner_id = ? and artifact_id = ?
      order by created_at desc, id desc limit 1)
    and exists (select 1 from creative_acceptances where id = ? and owner_id = ? and artifact_id = ? and decision = 'accepted')` : "";
  const updateBindings: unknown[] = [
    JSON.stringify(result.reference.continuityNotes), result.reference.version, result.reference.updatedAt, result.promotionId,
    result.reference.id, result.worldId, ownerId, result.reference.version - 1,
    result.worldId, ownerId, projectId,
    result.entityId, result.worldId, ownerId,
    projectId, ownerId,
  ];
  if (sourceArtifactId) updateBindings.push(
    sourceArtifactId, ownerId, projectId,
    result.evidenceReviewId, ownerId, sourceArtifactId,
    result.evidenceReviewId, ownerId, sourceArtifactId,
  );
  const update = env.DB.prepare(`update creative_canon_references set continuity_notes_json = ?, status = 'canonical',
    version = ?, updated_at = ?, promotion_token = ? where id = ? and world_id = ? and owner_id = ? and version = ?
    and exists (select 1 from creative_worlds where id = ? and owner_id = ? and project_id = ? and status = 'active')
    and exists (select 1 from creative_world_entities where id = ? and world_id = ? and owner_id = ? and status = 'active')
    and exists (select 1 from creative_projects where id = ? and owner_id = ? and status <> 'archived')${artifactPredicate}`)
    .bind(...updateBindings);
  const insert = env.DB.prepare(`insert into creative_canon_promotions
    (id, owner_id, world_id, project_id, entity_id, reference_id, facets_json, note, actor,
      evidence_review_id, source_artifact_id, reference_version, promoted_at)
    select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    where exists (select 1 from creative_canon_references
      where id = ? and world_id = ? and owner_id = ? and version = ? and status = 'canonical' and promotion_token = ?)`)
    .bind(result.promotionId, ownerId, result.worldId, projectId, result.entityId, result.referenceId,
      JSON.stringify(result.facets), result.note, result.actor, result.evidenceReviewId, sourceArtifactId,
      result.reference.version, result.promotedAt, result.reference.id, result.worldId, ownerId,
      result.reference.version, result.promotionId);
  const responses = await env.DB.batch([update, insert]);
  if (!responses[0].meta.changes || !responses[1].meta.changes) throw new Error("canon_promotion_prerequisite_changed");
}

async function promotionEvidenceForReference(
  env: Env,
  ownerId: string,
  projectId: string,
  reference: CanonReference,
  requestedEvidenceReviewId: string | null | undefined,
) {
  const requested = boundedText(requestedEvidenceReviewId, 100);
  if (reference.source.kind !== "retained-artifact") {
    if (requested) throw new Error("canon_promotion_evidence_not_applicable");
    return null;
  }
  const artifact = await env.DB.prepare(`select project_id as projectId, status, retained_key as retainedKey
    from creative_artifacts where id = ? and owner_id = ?`)
    .bind(reference.source.artifactId, ownerId)
    .first<{ projectId: string; status: string; retainedKey: string | null }>();
  if (!artifact?.retainedKey) throw new Error("canon_reference_artifact_not_retained");
  if (artifact.projectId !== projectId) throw new Error("canon_reference_project_mismatch");
  if (artifact.status !== "accepted") throw new Error("canon_reference_artifact_acceptance_required");
  const acceptance = await env.DB.prepare(`select id from creative_acceptances
    where owner_id = ? and artifact_id = ? and decision = 'accepted'
    order by created_at desc, id desc limit 1`)
    .bind(ownerId, reference.source.artifactId).first<{ id: string }>();
  if (!acceptance) throw new Error("canon_reference_artifact_acceptance_required");
  if (requested && requested !== acceptance.id) throw new Error("artifact_acceptance_mismatch");
  return acceptance.id;
}

export async function promoteReferenceToCanon(env: Env, ownerId: string, worldId: string, request: PromoteToCanonRequest) {
  const records = await worldById(env, ownerId, worldId);
  if (!records) throw new Error("world_not_found");
  if (records.world.status === "archived") throw new Error("world_archived");
  if (request.worldId !== worldId) throw new Error("canon_promotion_reference_mismatch");
  const reference = records.references.find((item) => item.id === request.referenceId);
  if (!reference) throw new Error("canon_reference_not_found");
  const evidenceReviewId = await promotionEvidenceForReference(
    env, ownerId, records.world.projectId, reference, request.evidenceReviewId,
  );
  const promoted = promoteCanonReference({ ...request, evidenceReviewId }, reference, {
    promotionId: id("promotion"),
    actor: "angelo",
    promotedAt: new Date().toISOString(),
  });
  await persistPromotion(env, ownerId, records.world.projectId, promoted,
    reference.source.kind === "retained-artifact" ? reference.source.artifactId : null);
  return promoted;
}

export async function promoteArtifactToCanon(env: Env, ownerId: string, artifactId: string, request: PromoteArtifactToCanonRequest): Promise<PromoteArtifactToCanonResult> {
  if (request.schemaVersion !== PROMOTE_TO_CANON_SCHEMA_VERSION || request.confirmation !== "promote-artifact-to-canon") {
    throw new Error("canon_promotion_confirmation_required");
  }
  if (boundedText(request.artifactId, 100) !== artifactId) throw new Error("canon_promotion_artifact_mismatch");
  const records = await worldById(env, ownerId, boundedText(request.worldId, 100));
  if (!records) throw new Error("world_not_found");
  if (records.world.status === "archived") throw new Error("world_archived");
  if (records.world.projectId !== boundedText(request.projectId, 100)) throw new Error("world_project_mismatch");
  const entity = records.entities.find((item) => item.id === boundedText(request.entityId, 100) && item.status === "active");
  if (!entity) throw new Error("world_entity_not_found");
  if (entity.version !== Number(request.expectedEntityVersion)) throw new Error("world_entity_version_conflict");
  if (records.promotions.some((promotion) => promotion.entityId === entity.id && promotion.sourceArtifactId === artifactId)) {
    throw new Error("artifact_already_canonical");
  }
  const artifact = await env.DB.prepare(`select id, project_id as projectId, name, status, retained_key as retainedKey
    from creative_artifacts where id = ? and owner_id = ?`)
    .bind(artifactId, ownerId).first<{ id: string; projectId: string; name: string; status: string; retainedKey: string | null }>();
  if (!artifact) throw new Error("artifact_not_found");
  if (artifact.projectId !== records.world.projectId) throw new Error("canon_reference_project_mismatch");
  if (artifact.status !== "accepted") throw new Error("artifact_acceptance_required");
  if (!artifact.retainedKey) throw new Error("canon_reference_artifact_not_retained");
  const acceptance = await env.DB.prepare(`select id from creative_acceptances
    where owner_id = ? and artifact_id = ? and decision = 'accepted' order by created_at desc, id desc limit 1`)
    .bind(ownerId, artifactId).first<{ id: string }>();
  if (!acceptance) throw new Error("artifact_acceptance_required");
  if (request.acceptanceId && boundedText(request.acceptanceId, 100) !== acceptance.id) throw new Error("artifact_acceptance_mismatch");
  const facets = normalizedFacets(request.facets);
  const continuityNotes = normalizedAttributes(request.continuityNotes).filter((note) => facets.includes(note.facet));
  if (!continuityNotes.length) throw new Error("canon_reference_notes_required");
  const createdAt = new Date().toISOString();
  const candidate: CanonReference = {
    schemaVersion: CANON_REFERENCE_SCHEMA_VERSION,
    id: id("reference"),
    worldId: records.world.id,
    projectId: records.world.projectId,
    entityId: entity.id,
    source: { kind: "retained-artifact", artifactId, label: boundedText(artifact.name, 160) || "Accepted artifact" },
    continuityNotes,
    status: "candidate",
    rights: { policy: "owner-controlled", sourceIdentityPromptEligible: false, rawMediaPromptEligible: false },
    version: 1,
    createdAt,
    updatedAt: createdAt,
  };
  const promotion = promoteCanonReference({
    schemaVersion: PROMOTE_TO_CANON_SCHEMA_VERSION,
    confirmation: "promote-to-canon",
    worldId: records.world.id,
    entityId: entity.id,
    referenceId: candidate.id,
    facets,
    note: request.note,
    expectedReferenceVersion: 1,
    evidenceReviewId: acceptance.id,
  }, candidate, { promotionId: id("promotion"), actor: "angelo", promotedAt: createdAt });
  const insertReference = env.DB.prepare(`insert into creative_canon_references
    (id, owner_id, world_id, project_id, entity_id, source_json, continuity_notes_json, status, rights_policy,
      version, created_at, updated_at, promotion_token)
    select ?, ?, ?, ?, ?, ?, ?, 'canonical', 'owner-controlled', ?, ?, ?, ?
    where exists (select 1 from creative_worlds where id = ? and owner_id = ? and project_id = ? and status = 'active')
      and exists (select 1 from creative_world_entities where id = ? and owner_id = ? and world_id = ? and project_id = ?
        and status = 'active' and version = ?)
      and exists (select 1 from creative_projects where id = ? and owner_id = ? and status <> 'archived')
      and exists (select 1 from creative_artifacts where id = ? and owner_id = ? and project_id = ?
        and status = 'accepted' and retained_key is not null)
      and ? = (select id from creative_acceptances where owner_id = ? and artifact_id = ?
        order by created_at desc, id desc limit 1)
      and exists (select 1 from creative_acceptances where id = ? and owner_id = ? and artifact_id = ? and decision = 'accepted')`)
    .bind(promotion.reference.id, ownerId, records.world.id, records.world.projectId, entity.id,
      JSON.stringify(promotion.reference.source), JSON.stringify(promotion.reference.continuityNotes),
      promotion.reference.version, promotion.reference.createdAt, promotion.reference.updatedAt, promotion.promotionId,
      records.world.id, ownerId, records.world.projectId,
      entity.id, ownerId, records.world.id, records.world.projectId, entity.version,
      records.world.projectId, ownerId,
      artifactId, ownerId, records.world.projectId,
      acceptance.id, ownerId, artifactId,
      acceptance.id, ownerId, artifactId);
  const insertPromotion = env.DB.prepare(`insert into creative_canon_promotions
    (id, owner_id, world_id, project_id, entity_id, reference_id, facets_json, note, actor,
      evidence_review_id, source_artifact_id, reference_version, promoted_at)
    select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    where exists (select 1 from creative_canon_references where id = ? and owner_id = ? and world_id = ?
      and entity_id = ? and status = 'canonical' and promotion_token = ?)`)
    .bind(promotion.promotionId, ownerId, promotion.worldId, records.world.projectId, promotion.entityId,
      promotion.referenceId, JSON.stringify(promotion.facets), promotion.note, promotion.actor,
      promotion.evidenceReviewId, artifactId, promotion.reference.version, promotion.promotedAt,
      promotion.referenceId, ownerId, promotion.worldId, promotion.entityId, promotion.promotionId);
  let responses: D1Result<unknown>[];
  try {
    responses = await env.DB.batch([insertReference, insertPromotion]);
  } catch (error) {
    const existing = await env.DB.prepare(`select id from creative_canon_promotions
      where owner_id = ? and world_id = ? and entity_id = ? and source_artifact_id = ? limit 1`)
      .bind(ownerId, records.world.id, entity.id, artifactId).first<{ id: string }>();
    if (existing) throw new Error("artifact_already_canonical", { cause: error });
    throw error;
  }
  if (!responses[0].meta.changes || !responses[1].meta.changes) throw new Error("canon_promotion_prerequisite_changed");
  return { schemaVersion: PROMOTE_TO_CANON_SCHEMA_VERSION, artifactId, promotion };
}

function assertVersionedSelection(values: readonly { id: string; version: number }[], label: string) {
  const ids = values.map((value) => boundedText(value.id, 100));
  if (!ids.length || ids.some((value) => !value) || new Set(ids).size !== ids.length
    || values.some((value) => !Number.isInteger(value.version) || value.version < 1)) {
    throw new Error(`invalid_continuity_${label}_selection`);
  }
}

/** Worker-authoritative compiler for the immutable settings stamp. */
export async function generationContinuityStamp(
  env: Env,
  ownerId: string,
  projectId: string,
  modality: ContinuityModality,
  selection: GenerationContinuitySelection,
  providerPrompt?: string,
): Promise<GenerationContinuityStamp> {
  if (selection.schemaVersion !== GENERATION_CONTINUITY_SELECTION_SCHEMA_VERSION || selection.modality !== modality) {
    throw new Error("invalid_generation_continuity_selection");
  }
  assertVersionedSelection([selection.world], "world");
  if (selection.entities.length) assertVersionedSelection(selection.entities, "entity");
  if (selection.rules.length) assertVersionedSelection(selection.rules, "rule");
  if (selection.references.length) assertVersionedSelection(selection.references, "reference");
  const records = await worldById(env, ownerId, selection.world.id);
  if (!records) throw new Error("world_not_found");
  if (records.world.projectId !== projectId) throw new Error("world_project_mismatch");
  if (records.world.status !== "active") throw new Error("world_archived");
  if (records.world.version !== selection.world.version) throw new Error("world_version_conflict");
  const entities = selection.entities.map((selected) => {
    const entity = records.entities.find((item) => item.id === selected.id && item.status === "active");
    if (!entity) throw new Error("world_entity_not_found");
    if (entity.version !== selected.version) throw new Error("world_entity_version_conflict");
    return entity;
  });
  const selectedEntityIds = new Set(entities.map((entity) => entity.id));
  const rules = selection.rules.map((selected) => {
    const rule = records.rules.find((item) => item.id === selected.id && item.status === "active");
    if (!rule) throw new Error("continuity_rule_not_found");
    if (rule.version !== selected.version) throw new Error("continuity_rule_version_conflict");
    if (!rule.modalities.includes(modality)) throw new Error("continuity_rule_modality_mismatch");
    if (rule.entityIds.length && !rule.entityIds.some((entityId) => selectedEntityIds.has(entityId))) throw new Error("continuity_rule_entity_mismatch");
    return rule;
  });
  const references = selection.references.map((selected) => {
    const reference = records.references.find((item) => item.id === selected.id && item.status === "canonical");
    if (!reference) throw new Error("canon_reference_not_found");
    if (reference.version !== selected.version) throw new Error("canon_reference_version_conflict");
    if (!selectedEntityIds.has(reference.entityId)) throw new Error("canon_reference_entity_mismatch");
    return reference;
  });
  const directive = compileContinuityDirective({
    world: records.world,
    entities,
    rules,
    // Selection decides which canonical guidance contributes. Every reference
    // remains available to the redactor so an unselected commercial identity
    // cannot leak through editable World, entity, or rule prose.
    references: records.references,
    selectedEntityIds: entities.map((entity) => entity.id),
    selectedRuleIds: rules.map((rule) => rule.id),
    selectedReferenceIds: references.map((reference) => reference.id),
    modality,
  });
  if (!directive.text) throw new Error("continuity_directive_empty");
  if (directive.truncated) throw new Error("continuity_directive_too_large");
  if (providerPrompt && containsCommercialReferenceIdentity(providerPrompt, records.references)) {
    throw new Error("continuity_commercial_identity_in_prompt");
  }
  return createGenerationContinuityStamp({
    selection,
    directive,
    world: records.world,
    entities,
    rules,
    references,
    redactionReferences: records.references.filter((reference) => reference.source.kind === "commercial-reference"),
    createdAt: new Date().toISOString(),
  });
}
