alter table creative_artifacts add column thumbnail_key text;
alter table creative_artifacts add column thumbnail_content_type text;
alter table creative_artifacts add column thumbnail_size integer;

create unique index if not exists idx_cs_artifacts_thumbnail_key
  on creative_artifacts(thumbnail_key)
  where thumbnail_key is not null;
