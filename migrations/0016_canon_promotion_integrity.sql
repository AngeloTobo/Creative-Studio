-- Bind a canon-promotion row to the exact optimistic-lock update that earned it.
-- A stale update changes zero rows, so its unique token can never satisfy the
-- following promotion insert. This prevents forged lineage under concurrency.
alter table creative_canon_references add column promotion_token text;

create unique index if not exists idx_cs_canon_references_owner_promotion_token
  on creative_canon_references(owner_id, promotion_token)
  where promotion_token is not null;

create unique index if not exists idx_cs_canon_promotions_owner_reference_version
  on creative_canon_promotions(owner_id, reference_id, reference_version);

create unique index if not exists idx_cs_canon_promotions_owner_world_entity_artifact
  on creative_canon_promotions(owner_id, world_id, entity_id, source_artifact_id)
  where source_artifact_id is not null;
