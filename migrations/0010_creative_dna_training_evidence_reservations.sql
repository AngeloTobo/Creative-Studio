create table if not exists creative_dna_training_evidence_reservations (
  training_example_id text primary key,
  owner_id text not null,
  project_id text not null,
  training_job_id text not null,
  created_at text not null,
  foreign key (training_example_id) references creative_training_examples(id),
  foreign key (training_job_id) references creative_dna_training_jobs(id)
);

create index if not exists idx_cs_dna_training_evidence_job
  on creative_dna_training_evidence_reservations(training_job_id);

create index if not exists idx_cs_dna_training_evidence_owner_project
  on creative_dna_training_evidence_reservations(owner_id, project_id, created_at desc);

insert or ignore into creative_dna_training_evidence_reservations (
  training_example_id, owner_id, project_id, training_job_id, created_at
)
select cast(example.value as text), job.owner_id, job.project_id, job.id, job.created_at
from creative_dna_training_jobs as job, json_each(job.training_example_ids_json) as example
where job.status in ('waiting-for-runner', 'running', 'completed');
