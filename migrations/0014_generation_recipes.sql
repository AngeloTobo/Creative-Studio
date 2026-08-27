create table if not exists creative_generation_recipes (
  id text primary key,
  owner_id text not null,
  project_id text,
  world_id text,
  name text not null,
  description text not null default '',
  media_kind text not null check (media_kind in ('music', 'image', 'video')),
  workflow_id text not null,
  workflow_revision_id text not null,
  model_identifier text,
  prompt_profile_json text not null,
  parameters_json text not null,
  source_kinds_json text not null,
  intent_tier text not null check (intent_tier in ('scout', 'explore', 'master')),
  created_at text not null,
  updated_at text not null,
  archived_at text,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (workflow_id) references creative_workflows(id),
  foreign key (workflow_revision_id) references creative_workflow_revisions(id)
);

create index if not exists idx_cs_generation_recipes_owner_updated
  on creative_generation_recipes(owner_id, archived_at, updated_at desc);

create index if not exists idx_cs_generation_recipes_owner_workflow
  on creative_generation_recipes(owner_id, workflow_id, workflow_revision_id, intent_tier);

create index if not exists idx_cs_generation_recipes_owner_project
  on creative_generation_recipes(owner_id, project_id, updated_at desc);

create table if not exists creative_generation_recipe_evidence (
  id text primary key,
  owner_id text not null,
  recipe_id text not null,
  job_id text not null,
  outcome text not null check (outcome in ('completed', 'failed', 'cancelled')),
  duration_ms integer,
  failure text,
  acceptance text not null check (acceptance in ('accepted', 'rejected', 'archived', 'unreviewed')),
  observed_at text not null,
  created_at text not null,
  updated_at text not null,
  foreign key (recipe_id) references creative_generation_recipes(id),
  foreign key (job_id) references creative_jobs(id),
  unique (owner_id, recipe_id, job_id)
);

create index if not exists idx_cs_generation_recipe_evidence_owner_recipe
  on creative_generation_recipe_evidence(owner_id, recipe_id, observed_at desc);
