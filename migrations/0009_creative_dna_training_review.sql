alter table creative_projects add column active_dna_artifact_id text;

create table if not exists creative_dna_training_reviews (
  id text primary key,
  owner_id text not null,
  project_id text not null,
  training_job_id text not null,
  dna_artifact_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  note text not null check (length(trim(note)) > 0),
  actor text not null check (actor in ('angelo', 'development-user')),
  active_dna_artifact_id text,
  created_at text not null,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  foreign key (training_job_id) references creative_dna_training_jobs(id),
  foreign key (dna_artifact_id) references creative_dna_artifacts(id)
);

create index if not exists idx_cs_dna_training_reviews_owner_created
  on creative_dna_training_reviews(owner_id, created_at desc);

create index if not exists idx_cs_dna_training_reviews_job_created
  on creative_dna_training_reviews(training_job_id, created_at desc);
