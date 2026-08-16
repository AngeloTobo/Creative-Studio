alter table creative_artifacts add column retained_key text;
alter table creative_artifacts add column retained_content_type text;
alter table creative_artifacts add column retained_size integer;

create unique index if not exists idx_cs_artifacts_retained_key on creative_artifacts(retained_key);
