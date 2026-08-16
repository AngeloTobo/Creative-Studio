create table if not exists creative_dna_training_jobs (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  base_dna_artifact_id text,
  result_dna_artifact_id text,
  name text not null,
  target_modality text not null check (target_modality in ('music', 'image')),
  status text not null check (status in ('waiting-for-runner', 'running', 'completed', 'failed', 'cancelled')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  provider text not null default 'local-creative-dna-runner' check (provider = 'local-creative-dna-runner'),
  asset_ids_json text not null,
  training_example_ids_json text not null,
  idempotency_key text not null,
  runner_id text,
  error text,
  created_at text not null,
  updated_at text not null,
  started_at text,
  completed_at text,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id)
);

create unique index if not exists idx_cs_dna_training_owner_idempotency
  on creative_dna_training_jobs(owner_id, idempotency_key);

create index if not exists idx_cs_dna_training_owner_project_created
  on creative_dna_training_jobs(owner_id, project_id, created_at desc);

create index if not exists idx_cs_dna_training_waiting
  on creative_dna_training_jobs(status, created_at)
  where status in ('waiting-for-runner', 'running');
