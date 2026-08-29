-- Local Runner-driven affectionate daily art. No browser, Queue, cron, or AFDFW work is required.
create table if not exists creative_love_loops (
  id text primary key,
  owner_id text not null unique,
  project_id text not null,
  dna_artifact_id text not null,
  timezone text not null,
  daily_count integer not null default 3 check (daily_count = 3),
  status text not null check (status in ('active', 'paused', 'disabled', 'needs-attention')),
  workflow_selections_json text not null,
  last_error text,
  created_at text not null,
  updated_at text not null,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (dna_artifact_id) references creative_dna_artifacts(id)
);

create index if not exists idx_cs_love_loops_status
  on creative_love_loops(status, owner_id)
  where status = 'active';

create table if not exists creative_love_loop_drops (
  id text primary key,
  owner_id text not null,
  loop_id text not null,
  local_date text not null,
  ordinal integer not null check (ordinal between 1 and 3),
  scheduled_for text not null,
  modality text not null check (modality in ('image', 'video')),
  title text not null,
  concept_id text not null,
  prompt text not null,
  seed integer not null check (seed between 0 and 4294967295),
  status text not null check (status in ('planned', 'queued', 'running', 'completed', 'failed', 'cancelled', 'skipped')),
  workflow_id text not null,
  workflow_revision_id text not null,
  recipe_id text,
  recipe_updated_at text,
  job_id text,
  artifact_id text,
  error text,
  created_at text not null,
  updated_at text not null,
  foreign key (loop_id) references creative_love_loops(id),
  foreign key (workflow_id) references creative_workflows(id),
  foreign key (workflow_revision_id) references creative_workflow_revisions(id),
  foreign key (recipe_id) references creative_generation_recipes(id),
  foreign key (job_id) references creative_jobs(id),
  foreign key (artifact_id) references creative_artifacts(id),
  unique (owner_id, loop_id, local_date, ordinal),
  unique (owner_id, job_id)
);

create index if not exists idx_cs_love_loop_drops_due
  on creative_love_loop_drops(owner_id, loop_id, status, scheduled_for)
  where status in ('planned', 'queued', 'running');

create index if not exists idx_cs_love_loop_drops_recent
  on creative_love_loop_drops(owner_id, loop_id, scheduled_for desc);
