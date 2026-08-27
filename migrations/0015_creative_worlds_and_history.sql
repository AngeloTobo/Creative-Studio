create table if not exists creative_worlds (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  name text not null,
  premise text not null default '',
  status text not null check (status in ('active', 'archived')),
  version integer not null check (version >= 1),
  created_at text not null,
  updated_at text not null,
  unique (id, owner_id),
  foreign key (project_id, owner_id) references creative_projects(id, owner_id)
);

create index if not exists idx_cs_worlds_owner_project_updated
  on creative_worlds(owner_id, project_id, status, updated_at desc, id desc);

create table if not exists creative_world_entities (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  world_id text not null,
  kind text not null check (kind in ('character', 'place', 'object')),
  name text not null,
  summary text not null default '',
  aliases_json text not null default '[]',
  attributes_json text not null default '[]',
  status text not null check (status in ('active', 'retired')),
  version integer not null check (version >= 1),
  created_at text not null,
  updated_at text not null,
  unique (id, owner_id),
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (world_id, owner_id) references creative_worlds(id, owner_id)
);

create index if not exists idx_cs_world_entities_owner_world_updated
  on creative_world_entities(owner_id, world_id, status, updated_at desc, id desc);

create index if not exists idx_cs_world_entities_owner_project_kind
  on creative_world_entities(owner_id, project_id, kind, status, updated_at desc, id desc);

create table if not exists creative_continuity_rules (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  world_id text not null,
  entity_ids_json text not null default '[]',
  facet text not null check (facet in ('identity', 'face', 'anatomy', 'silhouette', 'wardrobe', 'material', 'palette', 'scale', 'location', 'lighting', 'motion', 'behavior', 'relationship', 'timeline', 'composition', 'voice', 'sound')),
  strength text not null check (strength in ('must', 'prefer', 'avoid')),
  instruction text not null,
  modalities_json text not null default '[]',
  status text not null check (status in ('active', 'retired')),
  version integer not null check (version >= 1),
  created_at text not null,
  updated_at text not null,
  unique (id, owner_id),
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (world_id, owner_id) references creative_worlds(id, owner_id)
);

create index if not exists idx_cs_continuity_rules_owner_world_updated
  on creative_continuity_rules(owner_id, world_id, status, updated_at desc, id desc);

create table if not exists creative_canon_references (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  world_id text not null,
  entity_id text not null,
  source_json text not null,
  continuity_notes_json text not null default '[]',
  status text not null check (status in ('candidate', 'canonical', 'retired')),
  rights_policy text not null check (rights_policy in ('owner-controlled', 'abstract-attributes-only')),
  version integer not null check (version >= 1),
  created_at text not null,
  updated_at text not null,
  unique (id, owner_id),
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (world_id, owner_id) references creative_worlds(id, owner_id),
  foreign key (entity_id, owner_id) references creative_world_entities(id, owner_id)
);

create index if not exists idx_cs_canon_references_owner_world_entity
  on creative_canon_references(owner_id, world_id, entity_id, status, updated_at desc, id desc);

create table if not exists creative_canon_promotions (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  world_id text not null,
  entity_id text not null,
  reference_id text not null,
  facets_json text not null,
  note text not null,
  actor text not null check (actor in ('angelo', 'development-user')),
  evidence_review_id text,
  source_artifact_id text,
  reference_version integer not null check (reference_version >= 1),
  promoted_at text not null,
  unique (id, owner_id),
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (world_id, owner_id) references creative_worlds(id, owner_id),
  foreign key (entity_id, owner_id) references creative_world_entities(id, owner_id),
  foreign key (reference_id, owner_id) references creative_canon_references(id, owner_id),
  foreign key (source_artifact_id) references creative_artifacts(id)
);

create index if not exists idx_cs_canon_promotions_owner_world_promoted
  on creative_canon_promotions(owner_id, world_id, promoted_at desc, id desc);

create index if not exists idx_cs_canon_promotions_owner_reference
  on creative_canon_promotions(owner_id, reference_id, promoted_at desc, id desc);

-- Stable keyset pagination for the complete retained history and its related
-- owner-scoped records. Existing tables and rows remain unchanged.
create index if not exists idx_cs_artifacts_owner_created_id
  on creative_artifacts(owner_id, created_at desc, id desc);

create index if not exists idx_cs_artifacts_owner_project_created_id
  on creative_artifacts(owner_id, project_id, created_at desc, id desc);

create index if not exists idx_cs_jobs_owner_created_id
  on creative_jobs(owner_id, created_at desc, id desc);

create index if not exists idx_cs_acceptances_owner_artifact_created_id
  on creative_acceptances(owner_id, artifact_id, created_at desc, id desc);

create index if not exists idx_cs_training_examples_owner_artifact_created_id
  on creative_training_examples(owner_id, artifact_id, created_at desc, id desc);
