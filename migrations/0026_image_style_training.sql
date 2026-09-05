PRAGMA defer_foreign_keys = ON;

create table creative_model_training_jobs_image_upgrade (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  dna_artifact_id text,
  adapter_id text,
  name text not null,
  target text not null check (target in ('music-style', 'image-style')),
  provider text not null check (provider in ('ace-step-1.5-lora', 'comfy-sd15-lora')),
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

insert into creative_model_training_jobs_image_upgrade select * from creative_model_training_jobs;

drop table creative_model_training_jobs;

alter table creative_model_training_jobs_image_upgrade rename to creative_model_training_jobs;

create table creative_model_adapters_image_upgrade (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  dna_artifact_id text,
  training_job_id text not null unique,
  name text not null,
  target text not null check (target in ('music-style', 'image-style')),
  provider text not null check (provider in ('ace-step-1.5-lora', 'comfy-sd15-lora')),
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

insert into creative_model_adapters_image_upgrade select * from creative_model_adapters;

drop table creative_model_adapters;

alter table creative_model_adapters_image_upgrade rename to creative_model_adapters;

create unique index if not exists idx_cs_model_training_owner_idempotency
  on creative_model_training_jobs(owner_id, idempotency_key);

create index if not exists idx_cs_model_training_claim
  on creative_model_training_jobs(owner_id, status, created_at);

create index if not exists idx_cs_model_training_project
  on creative_model_training_jobs(owner_id, project_id, created_at desc);

create index if not exists idx_cs_model_adapters_project
  on creative_model_adapters(owner_id, project_id, status, created_at desc);

PRAGMA defer_foreign_keys = OFF;
