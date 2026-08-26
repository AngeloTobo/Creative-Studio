alter table creative_runners add column model_training_providers_json text not null default '[]';

create table if not exists creative_model_training_jobs (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  dna_artifact_id text,
  adapter_id text,
  name text not null,
  target text not null check (target = 'music-style'),
  provider text not null check (provider = 'ace-step-1.5-lora'),
  concept_json text not null,
  recipe_json text not null,
  asset_ids_json text not null,
  instrumental integer not null default 1 check (instrumental in (0, 1)),
  dataset_json text,
  status text not null check (status in ('waiting-for-runner', 'waiting-for-review', 'running', 'completed', 'failed', 'cancelled')),
  stage text not null check (stage in ('queued', 'preflight', 'captioning', 'dataset-review', 'preprocessing', 'training', 'retaining', 'adapter-review', 'completed', 'failed', 'cancelled')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  runner_id text,
  runner_lease_until text,
  upstream_id text,
  error text,
  idempotency_key text not null,
  created_at text not null,
  updated_at text not null,
  started_at text,
  completed_at text,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id)
);

create unique index if not exists idx_cs_model_training_owner_idempotency
  on creative_model_training_jobs(owner_id, idempotency_key);
create index if not exists idx_cs_model_training_claim
  on creative_model_training_jobs(owner_id, status, created_at);
create index if not exists idx_cs_model_training_project
  on creative_model_training_jobs(owner_id, project_id, created_at desc);

create table if not exists creative_model_adapters (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  dna_artifact_id text,
  training_job_id text not null unique,
  name text not null,
  target text not null check (target = 'music-style'),
  provider text not null check (provider = 'ace-step-1.5-lora'),
  status text not null check (status in ('review-required', 'active', 'inactive', 'rejected')),
  concept_json text not null,
  recipe_json text not null,
  local_file_json text not null,
  evaluation_json text not null,
  recommended_strength real not null default 0.8,
  created_at text not null,
  updated_at text not null,
  activated_at text,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (training_job_id) references creative_model_training_jobs(id)
);

create index if not exists idx_cs_model_adapters_project
  on creative_model_adapters(owner_id, project_id, status, created_at desc);

create table if not exists creative_model_adapter_reviews (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  training_job_id text not null,
  adapter_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  note text not null check (length(trim(note)) > 0),
  actor text not null check (actor in ('angelo', 'development-user')),
  created_at text not null,
  foreign key (training_job_id) references creative_model_training_jobs(id),
  foreign key (adapter_id) references creative_model_adapters(id)
);

create index if not exists idx_cs_model_adapter_reviews_job
  on creative_model_adapter_reviews(owner_id, training_job_id, created_at desc);
