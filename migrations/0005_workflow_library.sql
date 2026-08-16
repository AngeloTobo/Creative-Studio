create table if not exists creative_workflows (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  name text not null,
  description text not null default '',
  source_file_name text not null,
  modality text not null check (modality in ('image', 'audio', 'music', 'video', '3d')),
  execution_state text not null check (execution_state in ('ready', 'api-export-required')),
  current_revision_id text not null,
  created_at text not null,
  updated_at text not null,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id)
);

create index if not exists idx_cs_workflows_owner_project_updated
  on creative_workflows(owner_id, project_id, updated_at desc);

create table if not exists creative_workflow_revisions (
  id text primary key,
  owner_id text not null,
  workflow_id text not null,
  version integer not null,
  parent_revision_id text,
  format text not null check (format in ('comfyui-api', 'comfyui-ui')),
  content_hash text not null,
  graph_json text not null,
  node_count integer not null,
  parameters_json text not null,
  models_json text not null,
  created_at text not null,
  foreign key (workflow_id) references creative_workflows(id)
);

create unique index if not exists idx_cs_workflow_revision_version
  on creative_workflow_revisions(workflow_id, version);

create index if not exists idx_cs_workflow_revisions_owner_workflow
  on creative_workflow_revisions(owner_id, workflow_id, version desc);

alter table creative_jobs add column settings_stamp_json text not null default '{}';
alter table creative_artifacts add column settings_stamp_json text not null default '{}';

create table if not exists creative_training_examples (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  dna_artifact_id text not null,
  artifact_id text not null unique,
  kind text not null,
  status text not null check (status in ('candidate', 'training-ready', 'excluded')),
  prompt text not null,
  settings_stamp_json text not null,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_cs_training_examples_owner_project_status
  on creative_training_examples(owner_id, project_id, status, created_at desc);
