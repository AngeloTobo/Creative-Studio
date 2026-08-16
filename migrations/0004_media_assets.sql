create table if not exists creative_media_assets (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  kind text not null check (kind in ('image', 'audio', 'video')),
  name text not null,
  original_file_name text not null,
  mime_type text not null,
  size integer not null check (size > 0),
  r2_key text not null unique,
  source text not null default 'upload' check (source = 'upload'),
  status text not null default 'retained' check (status = 'retained'),
  training_eligible integer not null default 0 check (training_eligible in (0, 1)),
  created_at text not null,
  updated_at text not null,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id)
);

create index if not exists idx_cs_media_owner_project_created
  on creative_media_assets(owner_id, project_id, created_at desc);

create index if not exists idx_cs_media_training_eligible
  on creative_media_assets(owner_id, training_eligible, created_at desc);
