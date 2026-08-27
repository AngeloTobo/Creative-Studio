import { describe, expect, it } from "vitest";
import {
  CANON_REFERENCE_SCHEMA_VERSION,
  CREATIVE_WORLD_SCHEMA_VERSION,
  PROMOTE_TO_CANON_SCHEMA_VERSION,
  WORLD_ENTITY_SCHEMA_VERSION,
  compileContinuityDirective,
  promoteCanonReference,
  type CanonReference,
  type ContinuityRule,
  type World,
  type WorldEntity,
} from "../../shared/contracts/worlds";

const createdAt = "2026-08-26T12:00:00.000Z";
const projectId = "project_rebecca";

const world: World = {
  schemaVersion: CREATIVE_WORLD_SCHEMA_VERSION,
  id: "world_rebecca",
  projectId,
  name: "Rebecca's Embryo",
  premise: "A nocturnal biomechanical city where human tenderness survives inside synthetic bodies",
  status: "active",
  entityIds: ["entity_rebecca", "entity_rooftop", "entity_vehicle"],
  continuityRuleIds: ["rule_eyes", "rule_motion", "rule_unused"],
  version: 1,
  createdAt,
  updatedAt: createdAt,
};

const entities: WorldEntity[] = [
  {
    schemaVersion: WORLD_ENTITY_SCHEMA_VERSION,
    id: "entity_rebecca",
    worldId: world.id,
    projectId,
    kind: "character",
    name: "Rebecca",
    summary: "A non-binary cybernetic figure with a precise human gaze",
    aliases: [],
    attributes: [
      { facet: "face", value: "luminous blue eyes and a calm, observant expression" },
      { facet: "material", value: "polished synthetic plates interrupted by translucent organic tissue" },
    ],
    canonReferenceIds: ["reference_owner", "reference_commercial"],
    status: "active",
    version: 1,
    createdAt,
    updatedAt: createdAt,
  },
  {
    schemaVersion: WORLD_ENTITY_SCHEMA_VERSION,
    id: "entity_rooftop",
    worldId: world.id,
    projectId,
    kind: "place",
    name: "River rooftop",
    summary: "A wind-cut roof above a river of light between dark towers",
    aliases: [],
    attributes: [{ facet: "lighting", value: "cool city glow with sparse moving highlights" }],
    canonReferenceIds: [],
    status: "active",
    version: 1,
    createdAt,
    updatedAt: createdAt,
  },
  {
    schemaVersion: WORLD_ENTITY_SCHEMA_VERSION,
    id: "entity_vehicle",
    worldId: world.id,
    projectId,
    kind: "object",
    name: "Flying vehicle",
    summary: "A silent vehicle leaving thin light streaks",
    aliases: [],
    attributes: [],
    canonReferenceIds: [],
    status: "active",
    version: 1,
    createdAt,
    updatedAt: createdAt,
  },
];

const rules: ContinuityRule[] = [
  {
    id: "rule_eyes", worldId: world.id, projectId, entityIds: ["entity_rebecca"], facet: "face", strength: "must",
    instruction: "Rebecca's eyes remain blue and readable in every close view", modalities: ["image", "video"], status: "active", createdAt, updatedAt: createdAt,
  },
  {
    id: "rule_motion", worldId: world.id, projectId, entityIds: ["entity_rebecca"], facet: "motion", strength: "prefer",
    instruction: "movement begins restrained and resolves with one decisive gesture", modalities: ["video"], status: "active", createdAt, updatedAt: createdAt,
  },
  {
    id: "rule_unused", worldId: world.id, projectId, entityIds: ["entity_vehicle"], facet: "motion", strength: "avoid",
    instruction: "the vehicle never moves", modalities: ["video"], status: "active", createdAt, updatedAt: createdAt,
  },
];

const ownerReference: CanonReference = {
  schemaVersion: CANON_REFERENCE_SCHEMA_VERSION,
  id: "reference_owner",
  worldId: world.id,
  projectId,
  entityId: "entity_rebecca",
  source: { kind: "owner-upload", mediaId: "media_rebecca", label: "Rebecca portrait master" },
  continuityNotes: [{ facet: "silhouette", value: "narrow shoulders and a long segmented neck" }],
  status: "canonical",
  rights: { policy: "owner-controlled", sourceIdentityPromptEligible: false, rawMediaPromptEligible: false },
  version: 2,
  createdAt,
  updatedAt: createdAt,
};

const commercialIdentity = "Protected Movie by Famous Director";
const commercialReference: CanonReference = {
  schemaVersion: CANON_REFERENCE_SCHEMA_VERSION,
  id: "reference_commercial",
  worldId: world.id,
  projectId,
  entityId: "entity_rebecca",
  source: { kind: "commercial-reference", identity: commercialIdentity, lineageOnly: true },
  continuityNotes: [{ facet: "lighting", value: `${commercialIdentity} contributes deep negative space interrupted by one narrow cyan edge` }],
  status: "canonical",
  rights: { policy: "abstract-attributes-only", sourceIdentityPromptEligible: false, rawMediaPromptEligible: false },
  version: 1,
  createdAt,
  updatedAt: createdAt,
};

describe("Creative Worlds continuity contracts", () => {
  it("compiles a deterministic, inspectable directive from only the selected entities and rules", () => {
    const directive = compileContinuityDirective({
      world,
      entities,
      rules,
      references: [ownerReference, commercialReference],
      selectedEntityIds: ["entity_rebecca", "entity_rooftop"],
      selectedRuleIds: ["rule_eyes", "rule_motion", "rule_unused"],
      modality: "video",
    });

    expect(directive.text).toContain("Character Rebecca");
    expect(directive.text).toContain("Place River rooftop");
    expect(directive.text).toContain("Keep face");
    expect(directive.text).toContain("Prefer motion");
    expect(directive.text).not.toContain("Flying vehicle");
    expect(directive.text).not.toContain("the vehicle never moves");
    expect(directive.entityIds).toEqual(["entity_rebecca", "entity_rooftop"]);
    expect(directive.ruleIds).toEqual(["rule_eyes", "rule_motion"]);
    expect(directive.segments.every((segment) => Boolean(segment.sourceId && segment.text))).toBe(true);
    expect(compileContinuityDirective({
      world, entities, rules, references: [ownerReference, commercialReference],
      selectedEntityIds: ["entity_rebecca", "entity_rooftop"], selectedRuleIds: ["rule_eyes", "rule_motion", "rule_unused"], modality: "video",
    })).toEqual(directive);
  });

  it("uses abstract commercial-reference guidance while excluding its identity", () => {
    const directive = compileContinuityDirective({
      world: { ...world, premise: `${world.premise} without copying ${commercialIdentity}` },
      entities: entities.map((entity) => entity.id === "entity_rebecca"
        ? { ...entity, summary: `${entity.summary}, unlike ${commercialIdentity}` }
        : entity),
      rules: [{ ...rules[0], instruction: `${rules[0].instruction}; avoid naming ${commercialIdentity}` }],
      references: [commercialReference],
      selectedEntityIds: ["entity_rebecca"],
      selectedRuleIds: [rules[0].id],
      selectedReferenceIds: [commercialReference.id],
      modality: "image",
    });

    expect(directive.text).toContain("deep negative space");
    expect(directive.text).not.toContain(commercialIdentity);
    expect(directive.excludedCommercialReferenceIdentityIds).toEqual([commercialReference.id]);
    expect(directive.referenceIds).toEqual([commercialReference.id]);
  });

  it("removes a one-character commercial identity without damaging ordinary words", () => {
    const oneCharacterReference: CanonReference = {
      ...commercialReference,
      id: "reference_x",
      source: { kind: "commercial-reference", identity: "X", lineageOnly: true },
      continuityNotes: [{ facet: "material", value: "X suggests an extra-soft mineral surface" }],
    };
    const directive = compileContinuityDirective({
      world: { ...world, premise: "X lighting around an extra-soft organism" },
      entities,
      rules,
      references: [oneCharacterReference],
      selectedEntityIds: ["entity_rebecca"],
      selectedRuleIds: [],
      selectedReferenceIds: [oneCharacterReference.id],
      modality: "image",
    });

    expect(directive.text).toContain("extra-soft");
    expect(directive.text).not.toMatch(/(?:^|\s)X(?:\s|$)/);
  });

  it("reports truncation instead of emitting an unbounded continuity prompt", () => {
    const directive = compileContinuityDirective({
      world,
      entities,
      rules,
      references: [ownerReference, commercialReference],
      selectedEntityIds: ["entity_rebecca", "entity_rooftop"],
      selectedRuleIds: ["rule_eyes", "rule_motion"],
      modality: "video",
      maxCharacters: 240,
    });

    expect(directive.text.length).toBeLessThanOrEqual(240);
    expect(directive.truncated).toBe(true);
  });

  it("requires a separate explicit promotion and returns an immutable canon result", () => {
    const candidate = { ...ownerReference, status: "candidate" as const, version: 1 };
    const request = {
      schemaVersion: PROMOTE_TO_CANON_SCHEMA_VERSION,
      confirmation: "promote-to-canon" as const,
      worldId: world.id,
      entityId: "entity_rebecca",
      referenceId: candidate.id,
      facets: ["silhouette", "silhouette"] as const,
      note: "Approved as Rebecca's canonical silhouette reference.",
      expectedReferenceVersion: 1,
      evidenceReviewId: "acceptance_rebecca",
    };
    const result = promoteCanonReference(
      { ...request, facets: [...request.facets] },
      candidate,
      { promotionId: "promotion_rebecca", actor: "angelo", promotedAt: "2026-08-26T13:00:00.000Z" },
    );

    expect(result).toMatchObject({
      promotionId: "promotion_rebecca",
      actor: "angelo",
      facets: ["silhouette"],
      evidenceReviewId: "acceptance_rebecca",
      reference: { status: "canonical", version: 2 },
    });
    expect(candidate.status).toBe("candidate");
    expect(candidate.version).toBe(1);
    expect(() => promoteCanonReference(
      { ...request, confirmation: "accept-artifact" as never, facets: [...request.facets] },
      candidate,
      { promotionId: "promotion_invalid", actor: "angelo", promotedAt: createdAt },
    )).toThrow("canon_promotion_confirmation_required");
  });
});
