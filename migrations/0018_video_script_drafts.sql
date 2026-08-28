create table if not exists creative_video_script_drafts (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  status text not null check (status in ('waiting-for-runner', 'running', 'completed', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  mode text not null check (mode in ('build', 'tighten')),
  seed_phrases_json text not null,
  source_script text,
  scene_direction text not null,
  video_duration_seconds integer not null check (video_duration_seconds in (5, 10, 15, 30, 60)),
  generated_script text,
  current_script text,
  edit_revision integer not null default 0 check (edit_revision >= 0),
  provider text not null check (provider = 'local-comfyui'),
  model text,
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
  unique (owner_id, idempotency_key)
);

create index if not exists idx_cs_video_script_drafts_owner_updated
  on creative_video_script_drafts(owner_id, updated_at desc);

create index if not exists idx_cs_video_script_drafts_runner_due
  on creative_video_script_drafts(owner_id, status, runner_lease_until, created_at)
  where status in ('waiting-for-runner', 'running');
