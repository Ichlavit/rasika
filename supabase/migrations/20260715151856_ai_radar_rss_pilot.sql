alter table public.ai_radar_sources
  add column if not exists last_error text,
  add column if not exists last_item_count integer not null default 0;

alter table public.ai_radar_sources
  drop constraint if exists ai_radar_sources_last_item_count_check;

alter table public.ai_radar_sources
  add constraint ai_radar_sources_last_item_count_check
  check (last_item_count >= 0);

update public.ai_radar_sources
set
  feed_or_api_url = 'https://moodle.com/feed/',
  research_notes = concat_ws(
    ' ',
    nullif(research_notes, ''),
    'Operational correction 2026-07-15: /news/feed/ returned a closed-comments 403; the verified publication feed is /feed/.'
  )
where source_key = 'SRC-13';

update public.ai_radar_sources
set
  is_enabled = true,
  health_status = 'unverified',
  last_error = null
where source_key in ('SRC-13', 'SRC-38')
  and content_format = 'RSS';
