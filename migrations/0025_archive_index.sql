alter table creative_media_assets rename to creative_media_assets_v1;

create table creative_media_assets (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  kind text not null check (kind in ('image', 'audio', 'video')),
  name text not null,
  original_file_name text not null,
  mime_type text not null,
  size integer not null check (size > 0),
  r2_key text not null unique,
  source text not null default 'upload' check (source in ('upload', 'archive-index')),
  status text not null default 'retained' check (status = 'retained'),
  training_eligible integer not null default 0 check (training_eligible in (0, 1)),
  provenance_json text,
  created_at text not null,
  updated_at text not null,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id)
);

insert into creative_media_assets (
  id, owner_id, project_id, kind, name, original_file_name, mime_type, size, r2_key,
  source, status, training_eligible, provenance_json, created_at, updated_at
)
select id, owner_id, project_id, kind, name, original_file_name, mime_type, size, r2_key,
  source, status, training_eligible, null, created_at, updated_at
from creative_media_assets_v1;

drop table creative_media_assets_v1;

create index idx_cs_media_owner_project_created
  on creative_media_assets(owner_id, project_id, created_at desc);

create index idx_cs_media_training_eligible
  on creative_media_assets(owner_id, training_eligible, created_at desc);

create unique index idx_cs_runners_id_owner
  on creative_runners(id, owner_id);

create table creative_archive_catalogs (
  id text not null,
  owner_id text not null,
  runner_id text not null,
  provider text not null check (provider = 'angelo-art-index'),
  schema_version text not null check (schema_version = 'creative-studio-archive-catalog/1.0'),
  source_version text not null,
  source_fingerprint text not null,
  status text not null check (status in ('staging', 'active', 'replaced', 'failed')),
  expected_entry_count integer not null check (expected_entry_count > 0 and expected_entry_count <= 100000),
  expected_verified_count integer not null check (expected_verified_count >= 0),
  expected_unavailable_count integer not null check (expected_unavailable_count >= 0),
  received_entry_count integer not null default 0 check (received_entry_count >= 0 and received_entry_count <= expected_entry_count),
  materializable_entry_count integer not null default 0 check (materializable_entry_count >= 0 and materializable_entry_count <= received_entry_count),
  created_at text not null,
  published_at text,
  primary key (id),
  unique (id, owner_id),
  foreign key (runner_id, owner_id) references creative_runners(id, owner_id)
);

create unique index idx_cs_archive_catalog_source_open
  on creative_archive_catalogs(owner_id, runner_id, provider, source_fingerprint)
  where status in ('staging', 'active');

create unique index idx_cs_archive_catalog_active
  on creative_archive_catalogs(owner_id, provider)
  where status = 'active';

create index idx_cs_archive_catalog_latest
  on creative_archive_catalogs(owner_id, provider, created_at desc, id desc);

create table creative_archive_sync_batches (
  catalog_id text not null,
  owner_id text not null,
  batch_key text not null,
  payload_fingerprint text not null,
  entry_count integer not null check (entry_count > 0 and entry_count <= 100),
  created_at text not null,
  primary key (catalog_id, batch_key),
  foreign key (catalog_id, owner_id) references creative_archive_catalogs(id, owner_id)
);

create table creative_archive_entries (
  id text primary key,
  owner_id text not null,
  catalog_id text not null,
  source_record_type text not null,
  source_record_id text not null,
  inventory_record_id text,
  display_name text not null,
  sort_name text not null,
  extension text not null,
  media_kind text check (media_kind is null or media_kind in ('image', 'audio', 'video')),
  mime_type text,
  technical_category text not null,
  work_bucket text not null,
  archive_disposition text not null,
  observed_year integer check (observed_year is null or (observed_year >= 1900 and observed_year <= 2100)),
  size integer not null check (size >= 0),
  source_status text not null,
  verification_status text not null check (verification_status in ('size-match', 'unavailable')),
  materializable integer not null check (materializable in (0, 1)),
  materialization_block_reason text check (materialization_block_reason is null or materialization_block_reason in ('unavailable', 'review-required', 'unsupported-media', 'empty-media', 'media-too-large')),
  record_fingerprint text not null,
  created_at text not null,
  unique (catalog_id, source_record_type, source_record_id),
  unique (id, catalog_id, owner_id),
  foreign key (catalog_id, owner_id) references creative_archive_catalogs(id, owner_id)
);

create index idx_cs_archive_entries_page
  on creative_archive_entries(owner_id, catalog_id, sort_name, id);

create index idx_cs_archive_entries_filter
  on creative_archive_entries(owner_id, catalog_id, media_kind, materializable, observed_year, sort_name, id);

create table creative_archive_materializations (
  id text primary key,
  owner_id text not null,
  catalog_id text not null,
  entry_id text not null,
  project_id text not null,
  runner_id text not null,
  status text not null check (status in ('waiting-for-runner', 'running', 'completed', 'failed')),
  training_eligible integer not null default 0 check (training_eligible in (0, 1)),
  idempotency_key text not null,
  media_asset_id text not null,
  r2_key text not null unique,
  claim_token text,
  runner_lease_until text,
  error text,
  created_at text not null,
  updated_at text not null,
  started_at text,
  completed_at text,
  unique (owner_id, idempotency_key),
  unique (entry_id, project_id, idempotency_key),
  foreign key (catalog_id, owner_id) references creative_archive_catalogs(id, owner_id),
  foreign key (entry_id, catalog_id, owner_id) references creative_archive_entries(id, catalog_id, owner_id),
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (runner_id, owner_id) references creative_runners(id, owner_id)
);

create index idx_cs_archive_materialization_claim
  on creative_archive_materializations(owner_id, runner_id, status, runner_lease_until, created_at, id);

create unique index idx_cs_archive_materialization_project_copy
  on creative_archive_materializations(owner_id, catalog_id, entry_id, project_id)
  where status in ('waiting-for-runner', 'running', 'completed');

create index idx_cs_archive_materialization_owner_created
  on creative_archive_materializations(owner_id, created_at desc, id desc);
