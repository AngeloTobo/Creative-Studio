create table if not exists creative_generation_batches (
  id text not null,
  owner_id text not null,
  project_id text not null,
  status text not null check (status in ('waiting', 'running', 'completed', 'failed', 'cancelled')) default 'waiting',
  lane_count integer not null check (lane_count in (1, 2, 4)),
  next_lane integer not null default 1 check (next_lane >= 1 and next_lane <= lane_count + 1),
  request_json text not null check (length(request_json) between 32 and 100000),
  reconcile_email text,
  reconcile_attempts integer not null default 0,
  last_error text,
  failed_lane integer check (failed_lane is null or (failed_lane >= 1 and failed_lane <= lane_count)),
  terminal_reason text check (terminal_reason is null or terminal_reason in ('permanent', 'retry-exhausted')),
  next_attempt_at text,
  reconcile_lease_until text,
  created_at text not null,
  updated_at text not null,
  completed_at text,
  foreign key (project_id, owner_id) references creative_projects(id, owner_id),
  primary key (id, owner_id)
);

create index if not exists creative_generation_batches_owner_pending
  on creative_generation_batches(owner_id, status, next_attempt_at, created_at);
