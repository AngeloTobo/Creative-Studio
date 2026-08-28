create table if not exists creative_prompt_enhancements (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  workflow_id text not null,
  workflow_revision_id text not null,
  workflow_name text not null,
  status text not null check (status in ('waiting-for-runner', 'running', 'completed', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  source_prompt text not null,
  enhanced_prompt text,
  provider text not null check (provider = 'local-comfyui'),
  prompt_profile_id text not null,
  target_model text not null,
  output_format text not null check (output_format in ('minimax-h3-timeline', 'natural-language')),
  input_mode text not null check (input_mode in ('image-to-video', 'text-to-video', 'video-extension')),
  source_id text,
  video_duration_seconds integer not null check (video_duration_seconds in (5, 10, 15, 30, 60)),
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
  foreign key (workflow_id) references creative_workflows(id),
  foreign key (workflow_revision_id) references creative_workflow_revisions(id),
  unique (owner_id, idempotency_key)
);

create index if not exists idx_cs_prompt_enhancements_owner_updated
  on creative_prompt_enhancements(owner_id, updated_at desc);

create index if not exists idx_cs_prompt_enhancements_runner_due
  on creative_prompt_enhancements(owner_id, status, runner_lease_until, created_at)
  where status in ('waiting-for-runner', 'running');
