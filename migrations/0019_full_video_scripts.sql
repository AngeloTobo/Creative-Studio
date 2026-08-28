-- Preserve every 0018 dialogue draft while making all new drafts explicitly full-script v2.
alter table creative_video_script_drafts
  add column script_format text not null default 'dialogue-v1'
    check (script_format in ('dialogue-v1', 'full-script-v2'));

alter table creative_video_script_drafts add column workflow_id text;
alter table creative_video_script_drafts add column workflow_revision_id text;
alter table creative_video_script_drafts add column workflow_name text;
alter table creative_video_script_drafts add column workflow_version integer;
alter table creative_video_script_drafts add column prompt_profile_id text;
alter table creative_video_script_drafts add column prompt_profile_label text;
alter table creative_video_script_drafts add column target_model text;
alter table creative_video_script_drafts add column output_format text;
alter table creative_video_script_drafts add column prompt_minimum_words integer;
alter table creative_video_script_drafts add column prompt_maximum_words integer;
alter table creative_video_script_drafts add column input_mode text;
alter table creative_video_script_drafts add column source_id text;
alter table creative_video_script_drafts add column source_origin text;
alter table creative_video_script_drafts add column source_kind text;
alter table creative_video_script_drafts add column source_name text;
alter table creative_video_script_drafts add column generated_spoken_text text;
alter table creative_video_script_drafts add column current_spoken_text text;

create index if not exists idx_cs_video_script_drafts_workflow_revision
  on creative_video_script_drafts(owner_id, workflow_id, workflow_revision_id, updated_at desc)
  where script_format = 'full-script-v2';
