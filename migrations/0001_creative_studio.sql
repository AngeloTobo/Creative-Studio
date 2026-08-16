create table if not exists creative_projects (
  id text not null,
  owner_id text not null,
  name text not null,
  type text not null,
  status text not null,
  description text not null,
  note text not null,
  hue text not null,
  initials text not null,
  created_at text not null,
  updated_at text not null,
  primary key (id, owner_id)
);

create table if not exists creative_dna_artifacts (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  root_artifact_id text not null,
  parent_artifact_id text,
  version integer not null,
  dna_json text not null,
  created_at text not null
);

create index if not exists idx_cs_dna_owner_created on creative_dna_artifacts(owner_id, created_at desc);
create index if not exists idx_cs_dna_root_version on creative_dna_artifacts(root_artifact_id, version);

create table if not exists creative_jobs (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  dna_artifact_id text not null,
  capability text not null,
  modality text not null,
  status text not null,
  progress integer not null,
  prompt text not null,
  provider text not null,
  upstream_id text,
  upstream_media_path text,
  artifact_id text,
  error text,
  created_at text not null,
  updated_at text not null,
  completed_at text
);

create index if not exists idx_cs_jobs_owner_created on creative_jobs(owner_id, created_at desc);
create index if not exists idx_cs_jobs_upstream on creative_jobs(upstream_id);

create table if not exists creative_artifacts (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  job_id text not null,
  dna_artifact_id text not null,
  kind text not null,
  name text not null,
  status text not null,
  provider text not null,
  prompt text not null,
  preview_kind text not null,
  preview_url text,
  preview_from text not null,
  preview_to text not null,
  upstream_media_path text,
  parent_artifact_id text,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_cs_artifacts_owner_created on creative_artifacts(owner_id, created_at desc);

create table if not exists creative_acceptances (
  id text primary key,
  owner_id text not null,
  artifact_id text not null,
  decision text not null,
  note text not null,
  actor text not null,
  created_at text not null
);

create index if not exists idx_cs_acceptances_artifact_created on creative_acceptances(artifact_id, created_at desc);
