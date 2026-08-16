alter table creative_jobs add column reconcile_email text;
alter table creative_jobs add column idempotency_key text;
alter table creative_jobs add column retry_of_job_id text;
alter table creative_jobs add column reconcile_attempts integer not null default 0;
alter table creative_jobs add column next_reconcile_at text;
alter table creative_jobs add column timeout_at text;
alter table creative_jobs add column reconcile_lease_until text;
alter table creative_jobs add column last_reconcile_error text;
alter table creative_jobs add column cancelled_at text;

create unique index if not exists idx_cs_jobs_owner_idempotency
  on creative_jobs(owner_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_cs_jobs_background_due
  on creative_jobs(status, next_reconcile_at)
  where status in ('queued', 'running');

create unique index if not exists idx_cs_artifacts_job
  on creative_artifacts(job_id);
