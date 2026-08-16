create table if not exists creative_runners (
  id text primary key,
  owner_id text not null,
  name text not null,
  token_hash text not null unique,
  version text,
  comfy_url text,
  comfy_version text,
  device text,
  active_job_id text,
  last_error text,
  last_heartbeat_at text,
  created_at text not null,
  revoked_at text
);

create index if not exists idx_cs_runners_owner_created
  on creative_runners(owner_id, created_at desc);

alter table creative_jobs add column execution_target text not null default 'afdfw';
alter table creative_jobs add column workflow_id text;
alter table creative_jobs add column workflow_revision_id text;
alter table creative_jobs add column runner_id text;
alter table creative_jobs add column runner_lease_until text;

create index if not exists idx_cs_jobs_local_runner_due
  on creative_jobs(owner_id, execution_target, status, runner_lease_until, created_at)
  where execution_target = 'local-comfyui' and status in ('queued', 'running');
