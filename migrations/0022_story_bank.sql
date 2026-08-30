-- Durable, Local Runner-planned story and prompt recommendations. This adds no
-- Cloudflare cron, Queue producer, placeholder content, or AFDFW dependency.
create table if not exists creative_story_refreshes (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  dna_artifact_id text not null,
  world_id text,
  evidence_fingerprint text not null,
  trigger text not null check (trigger in ('automatic', 'manual')),
  source_refs_json text not null,
  planner_context_json text not null,
  workflows_json text not null,
  status text not null check (status in ('waiting-for-runner', 'running', 'completed', 'failed')),
  runner_id text,
  runner_lease_until text,
  planner_provider text not null default 'local-comfyui' check (planner_provider = 'local-comfyui'),
  planner_model text,
  comfy_prompt_id text,
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

create index if not exists idx_cs_story_refreshes_claim
  on creative_story_refreshes(owner_id, status, runner_lease_until, created_at)
  where status in ('waiting-for-runner', 'running');

create index if not exists idx_cs_story_refreshes_evidence
  on creative_story_refreshes(owner_id, project_id, evidence_fingerprint, created_at desc);

create unique index if not exists idx_cs_story_refreshes_one_active_project
  on creative_story_refreshes(owner_id, project_id)
  where status in ('waiting-for-runner', 'running');

create table if not exists creative_story_threads (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  refresh_id text not null,
  world_id text,
  dna_artifact_id text not null,
  title text not null,
  logline text not null,
  status text not null check (status in ('suggested', 'developing', 'parked', 'archived')),
  pinned integer not null default 0 check (pinned in (0, 1)),
  version integer not null default 1 check (version >= 1),
  source_refs_json text not null,
  evidence_fingerprint text not null,
  planner_provider text not null default 'local-comfyui' check (planner_provider = 'local-comfyui'),
  planner_model text not null,
  created_at text not null,
  updated_at text not null,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (refresh_id) references creative_story_refreshes(id),
  foreign key (dna_artifact_id) references creative_dna_artifacts(id),
  foreign key (world_id) references creative_worlds(id)
);

create index if not exists idx_cs_story_threads_project_rank
  on creative_story_threads(owner_id, project_id, pinned desc, updated_at desc);

create table if not exists creative_story_recommendations (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  refresh_id text not null,
  story_id text not null,
  version integer not null default 1 check (version >= 1),
  modality text not null check (modality in ('image', 'video', 'music')),
  role text not null check (role in ('faithful', 'signature', 'frontier', 'awe')),
  title text not null,
  prompt text not null,
  prompt_hash text not null,
  source_id text,
  source_type text check (source_type in ('upload', 'artifact')),
  source_kind text check (source_kind in ('image', 'audio', 'video')),
  workflow_id text,
  workflow_revision_id text,
  recipe_id text,
  model_target text,
  duration_seconds real,
  aspect_ratio text check (aspect_ratio in ('1:1', '16:9', '9:16')),
  estimated_duration_ms integer,
  status text not null check (status in ('ready', 'used', 'stale', 'dismissed')),
  created_at text not null,
  updated_at text not null,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (refresh_id) references creative_story_refreshes(id),
  foreign key (story_id) references creative_story_threads(id),
  foreign key (workflow_id) references creative_workflows(id),
  foreign key (workflow_revision_id) references creative_workflow_revisions(id),
  foreign key (recipe_id) references creative_generation_recipes(id),
  unique (owner_id, story_id, modality)
);

create index if not exists idx_cs_story_recommendations_story
  on creative_story_recommendations(owner_id, story_id, modality);

create index if not exists idx_cs_story_recommendations_ready
  on creative_story_recommendations(owner_id, project_id, status, updated_at desc);

-- The Local Runner polls for work frequently, but Story Bank evidence is large
-- and changes comparatively slowly. One owner-scoped high-water row keeps the
-- automatic planner scan durable and bounded without adding a Worker cron,
-- Queue producer, browser timer, or per-poll evidence traversal.
create table if not exists creative_story_scheduler_state (
  owner_id text primary key,
  next_scan_at text not null,
  transient_retry_at text,
  last_scanned_at text,
  evidence_high_watermark text,
  updated_at text not null
);
