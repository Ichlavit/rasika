alter table public.ai_radar_sources
  add column if not exists publisher_name text;

update public.ai_radar_sources
set publisher_name = coalesce(nullif(organization, ''), source_name)
where publisher_name is null or btrim(publisher_name) = '';

update public.ai_radar_sources
set publisher_name = case source_key
  when 'SRC-13' then 'Moodle'
  when 'SRC-24' then 'EdSurge'
  when 'SRC-27' then 'Khan Academy'
  when 'SRC-30' then 'Training Industry'
  when 'SRC-31' then 'Chief Learning Officer'
  when 'SRC-32' then 'eLearning Industry'
  when 'SRC-37' then 'Work-Learning Research'
  when 'SRC-38' then 'Observatorio del Instituto para el Futuro de la Educación, Tecnológico de Monterrey'
  when 'SRC-39' then 'OpenAI'
  when 'SRC-40' then 'The Josh Bersin Company'
  else publisher_name
end
where source_key in (
  'SRC-13', 'SRC-24', 'SRC-27', 'SRC-30', 'SRC-31',
  'SRC-32', 'SRC-37', 'SRC-38', 'SRC-39', 'SRC-40'
);

alter table public.ai_radar_sources
  alter column publisher_name set not null;

alter table public.ai_radar_candidates
  add column if not exists thumbnail_status text not null default 'not_requested',
  add column if not exists thumbnail_error text,
  add column if not exists thumbnail_generated_at timestamptz,
  add column if not exists thumbnail_model text,
  add column if not exists thumbnail_storage_path text;

alter table public.ai_radar_candidates
  drop constraint if exists ai_radar_candidates_thumbnail_status_check;

alter table public.ai_radar_candidates
  add constraint ai_radar_candidates_thumbnail_status_check
  check (thumbnail_status in ('not_requested', 'generating', 'ready', 'failed'));

alter table public.ai_radar_review_events
  drop constraint if exists ai_radar_review_events_action_check;

alter table public.ai_radar_review_events
  add constraint ai_radar_review_events_action_check
  check (
    action in (
      'suggest', 'approve', 'reject', 'return', 'publish', 'archive', 'restore',
      'generate_thumbnail'
    )
  );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'ai-radar-thumbnails',
  'ai-radar-thumbnails',
  true,
  10485760,
  array['image/png']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

update public.ai_radar_sources
set
  is_enabled = true,
  health_status = case when health_status = 'healthy' then 'healthy' else 'unverified' end,
  last_error = case when health_status = 'healthy' then last_error else null end
where source_key in (
  'SRC-13', 'SRC-24', 'SRC-27', 'SRC-31', 'SRC-32',
  'SRC-37', 'SRC-38', 'SRC-39', 'SRC-40'
)
  and content_format = 'RSS';

update public.ai_radar_sources
set
  is_enabled = false,
  health_status = 'degraded',
  last_error = 'Feed returned HTTP 403 during verification on 2026-07-15.'
where source_key = 'SRC-30'
  and content_format = 'RSS';

update public.ai_radar_candidates
set linkedin_copy = replace(
  replace(
    replace(
      linkedin_copy,
      'El Observatorio del Tec',
      'El Observatorio del Instituto para el Futuro de la Educación, Tecnológico de Monterrey'
    ),
    'el Observatorio del Tec',
    'el Observatorio del Instituto para el Futuro de la Educación, Tecnológico de Monterrey'
  ),
  'Observatorio del Tec',
  'Observatorio del Instituto para el Futuro de la Educación, Tecnológico de Monterrey'
)
where source_id = (
  select id from public.ai_radar_sources where source_key = 'SRC-38'
)
  and linkedin_copy ilike '%Observatorio del Tec%';
