-- Local Runner-owned overnight orchestration. No browser, Queue, or AFDFW work is required.
alter table creative_jobs add column priority integer not null default 100;
alter table creative_jobs add column not_before text;
alter table creative_jobs add column automation_session_id text;

create index if not exists idx_cs_jobs_local_priority
  on creative_jobs(owner_id, execution_target, status, priority desc, created_at)
  where execution_target = 'local-comfyui' and status in ('queued', 'running');

create index if not exists idx_cs_jobs_automation_session
  on creative_jobs(owner_id, automation_session_id, created_at)
  where automation_session_id is not null;

create table if not exists creative_overnight_sessions (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  dna_artifact_id text not null,
  world_id text,
  name text not null,
  story_seed text not null,
  story_count integer not null check (story_count between 1 and 3),
  output_count integer not null check (output_count between 3 and 8),
  modalities_json text not null,
  exploration text not null check (exploration in ('familiar', 'exploratory', 'wild')),
  workflow_selections_json text not null,
  planner_context_json text not null,
  status text not null check (status in ('armed', 'planning', 'running', 'paused', 'completed', 'needs-attention', 'failed', 'cancelled')),
  scheduled_for text not null,
  cutoff_at text not null,
  max_failures integer not null check (max_failures between 1 and 3),
  max_bytes integer not null check (max_bytes between 104857600 and 2147483648),
  plan_json text,
  plan_hash text,
  planner_model text,
  comfy_prompt_id text,
  runner_id text,
  runner_lease_until text,
  error text,
  idempotency_key text not null,
  created_at text not null,
  updated_at text not null,
  started_at text,
  completed_at text,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (dna_artifact_id) references creative_dna_artifacts(id),
  foreign key (world_id) references creative_worlds(id),
  unique (owner_id, idempotency_key)
);

create index if not exists idx_cs_overnight_sessions_owner_updated
  on creative_overnight_sessions(owner_id, updated_at desc);

create index if not exists idx_cs_overnight_sessions_runner_due
  on creative_overnight_sessions(owner_id, status, scheduled_for, runner_lease_until, created_at)
  where status in ('armed', 'planning');

-- A project may have only one owner-controlled overnight lifecycle at a time. The
-- application still performs an explicit check so constraint races map to a useful
-- domain error instead of leaking a SQLite error.
create unique index if not exists idx_cs_overnight_sessions_one_active_project
  on creative_overnight_sessions(owner_id, project_id)
  where status in ('armed', 'planning', 'running', 'paused', 'needs-attention');

create table if not exists creative_overnight_tasks (
  id text primary key,
  owner_id text not null,
  session_id text not null,
  ordinal integer not null check (ordinal between 1 and 8),
  story_id text not null,
  story_title text not null,
  scene_id text,
  scene_title text,
  role text not null check (role in ('scene-image', 'scene-video', 'soundtrack', 'soundscape')),
  modality text not null check (modality in ('image', 'video', 'music')),
  prompt text not null,
  seed integer not null check (seed between 0 and 4294967295),
  status text not null check (status in ('planned', 'queued', 'running', 'completed', 'failed', 'cancelled', 'skipped')),
  recipe_id text,
  recipe_updated_at text,
  workflow_id text not null,
  workflow_revision_id text not null,
  job_id text,
  artifact_id text,
  error text,
  created_at text not null,
  updated_at text not null,
  foreign key (session_id) references creative_overnight_sessions(id),
  foreign key (recipe_id) references creative_generation_recipes(id),
  foreign key (workflow_id) references creative_workflows(id),
  foreign key (workflow_revision_id) references creative_workflow_revisions(id),
  foreign key (job_id) references creative_jobs(id),
  foreign key (artifact_id) references creative_artifacts(id),
  unique (owner_id, session_id, ordinal),
  unique (owner_id, job_id)
);

create index if not exists idx_cs_overnight_tasks_session
  on creative_overnight_tasks(owner_id, session_id, ordinal);

create index if not exists idx_cs_overnight_tasks_job
  on creative_overnight_tasks(owner_id, job_id)
  where job_id is not null;
