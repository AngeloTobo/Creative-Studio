alter table creative_dna_training_jobs add column runner_lease_until text;

create index if not exists idx_cs_dna_training_runner_due
  on creative_dna_training_jobs(owner_id, status, runner_lease_until, created_at)
  where status in ('waiting-for-runner', 'running');
