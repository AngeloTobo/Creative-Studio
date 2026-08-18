alter table creative_jobs add column started_at text;
alter table creative_jobs add column execution_stage text;
alter table creative_jobs add column stage_updated_at text;

update creative_jobs
set started_at = case when status in ('running', 'completed', 'failed') then created_at else null end,
    execution_stage = case
      when status = 'completed' then 'completed'
      when status = 'failed' then 'failed'
      when status = 'cancelled' then 'cancelled'
      when artifact_id is not null then 'retaining'
      when status = 'running' then 'rendering'
      else 'queued'
    end,
    stage_updated_at = updated_at;
