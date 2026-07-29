alter table public.contacts
  add column if not exists deliverability_status text not null default 'unknown'
    check (deliverability_status in ('unknown', 'deliverable', 'bounced', 'complained', 'suppressed')),
  add column if not exists last_delivered_at timestamptz,
  add column if not exists last_bounced_at timestamptz,
  add column if not exists last_complained_at timestamptz,
  add column if not exists deliverability_detail text;

create index if not exists contacts_deliverability_status_idx
  on public.contacts (deliverability_status, newsletter_status);

alter table public.marketing_campaigns
  add column if not exists campaign_key text,
  add column if not exists from_name text not null default 'Rasika Insights',
  add column if not exists from_email text not null default 'newsletter@rasika.cl',
  add column if not exists reply_to text,
  add column if not exists content_json jsonb not null default '{}'::jsonb,
  add column if not exists text_content text,
  add column if not exists audience_source text not null default 'newsletter_subscribers',
  add column if not exists eligible_count integer not null default 0 check (eligible_count >= 0),
  add column if not exists excluded_count integer not null default 0 check (excluded_count >= 0),
  add column if not exists reserved_transactional_quota integer not null default 100
    check (reserved_transactional_quota between 0 and 10000),
  add column if not exists test_recipient_count integer not null default 0 check (test_recipient_count >= 0),
  add column if not exists test_sent_at timestamptz,
  add column if not exists safety_status text not null default 'blocked'
    check (safety_status in ('blocked', 'test_ready', 'approval_required', 'send_ready')),
  add column if not exists safety_notes text,
  add column if not exists metrics jsonb not null default '{}'::jsonb;

create unique index if not exists marketing_campaigns_key_uidx
  on public.marketing_campaigns (campaign_key)
  where campaign_key is not null;

create table public.marketing_campaign_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  link_key text not null,
  block_type text not null
    check (block_type in ('article', 'service', 'social', 'unsubscribe', 'other')),
  label text not null,
  destination_url text not null,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (campaign_id, link_key),
  constraint marketing_campaign_links_key_check check (link_key ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  constraint marketing_campaign_links_url_check check (destination_url ~ '^https://')
);

alter table public.marketing_campaign_links enable row level security;
revoke all on public.marketing_campaign_links from anon, authenticated;
grant all on public.marketing_campaign_links to service_role;
create index marketing_campaign_links_campaign_idx
  on public.marketing_campaign_links (campaign_id, position);

create table public.marketing_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'candidate'
    check (status in (
      'candidate', 'eligible', 'excluded', 'queued', 'sent', 'delivered',
      'opened', 'clicked', 'bounced', 'complained', 'unsubscribed', 'failed', 'suppressed'
    )),
  eligibility_reason text,
  tracking_token_hash text,
  resend_email_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  unsubscribed_at timestamptz,
  open_count integer not null default 0 check (open_count >= 0),
  click_count integer not null default 0 check (click_count >= 0),
  last_clicked_url text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

alter table public.marketing_campaign_recipients enable row level security;
revoke all on public.marketing_campaign_recipients from anon, authenticated;
grant all on public.marketing_campaign_recipients to service_role;
create unique index marketing_campaign_recipients_tracking_hash_uidx
  on public.marketing_campaign_recipients (tracking_token_hash)
  where tracking_token_hash is not null;
create unique index marketing_campaign_recipients_resend_email_uidx
  on public.marketing_campaign_recipients (resend_email_id)
  where resend_email_id is not null;
create index marketing_campaign_recipients_campaign_status_idx
  on public.marketing_campaign_recipients (campaign_id, status);
create index marketing_campaign_recipients_contact_idx
  on public.marketing_campaign_recipients (contact_id, created_at desc);
drop trigger if exists set_marketing_campaign_recipients_updated_at on public.marketing_campaign_recipients;
create trigger set_marketing_campaign_recipients_updated_at
before update on public.marketing_campaign_recipients
for each row execute function public.set_ai_radar_updated_at();

create table public.marketing_campaign_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  campaign_id uuid references public.marketing_campaigns(id) on delete cascade,
  recipient_id uuid references public.marketing_campaign_recipients(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  event_type text not null
    check (event_type in (
      'sent', 'delivered', 'delivery_delayed', 'failed', 'opened', 'clicked',
      'bounced', 'complained', 'suppressed', 'unsubscribed', 'test_sent'
    )),
  resend_email_id text,
  link_key text,
  link_url text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.marketing_campaign_events enable row level security;
revoke all on public.marketing_campaign_events from anon, authenticated;
grant all on public.marketing_campaign_events to service_role;
create index marketing_campaign_events_campaign_time_idx
  on public.marketing_campaign_events (campaign_id, occurred_at desc);
create index marketing_campaign_events_recipient_time_idx
  on public.marketing_campaign_events (recipient_id, occurred_at desc);
create index marketing_campaign_events_type_time_idx
  on public.marketing_campaign_events (event_type, occurred_at desc);

create table public.newsletter_unsubscribe_feedback (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  reason_code text
    check (reason_code is null or reason_code in ('too_frequent', 'not_relevant', 'not_requested', 'other')),
  feedback text,
  created_at timestamptz not null default now(),
  unique (contact_id, campaign_id),
  constraint newsletter_unsubscribe_feedback_length_check
    check (feedback is null or length(feedback) <= 1000)
);

alter table public.newsletter_unsubscribe_feedback enable row level security;
revoke all on public.newsletter_unsubscribe_feedback from anon, authenticated;
grant all on public.newsletter_unsubscribe_feedback to service_role;

alter table public.leads
  add column if not exists marketing_campaign_recipient_id uuid
    references public.marketing_campaign_recipients(id) on delete set null;
create index if not exists leads_marketing_campaign_recipient_idx
  on public.leads (marketing_campaign_recipient_id)
  where marketing_campaign_recipient_id is not null;

alter table public.quotes
  add column if not exists marketing_campaign_recipient_id uuid
    references public.marketing_campaign_recipients(id) on delete set null;
create index if not exists quotes_marketing_campaign_recipient_idx
  on public.quotes (marketing_campaign_recipient_id)
  where marketing_campaign_recipient_id is not null;

alter table public.site_events
  drop constraint if exists site_events_event_type_check;
alter table public.site_events
  add constraint site_events_event_type_check check (
    event_type in (
      'page_view', 'click', 'session_engagement', 'form_submit', 'newsletter_subscribe',
      'article_view', 'chatbot_open', 'quote_requested', 'campaign_landing',
      'campaign_click', 'meeting_scheduled'
    )
  );

insert into public.marketing_campaigns (
  campaign_key,
  name,
  subject,
  preview_text,
  status,
  segment,
  audience_source,
  content_queue_ids,
  content_json,
  reserved_transactional_quota,
  safety_status,
  safety_notes
)
select
  'otec-insights-01',
  'Rasika Insights · OTEC #01',
  'IA aplicada al aprendizaje: dos ideas y dos servicios para llevarlas a la práctica',
  'Integridad académica, adopción tecnológica, CourseMentor y Chroma Key con IA generativa.',
  'draft',
  'otec',
  'OTEC registry contacts; consent review required',
  coalesce(array_agg(q.id order by q.detected_at desc) filter (where q.id is not null), '{}'),
  jsonb_build_object(
    'edition_label', 'Primera edición',
    'eyebrow', 'Rasika Insights',
    'headline', 'Ideas que conectan aprendizaje, tecnología y producción',
    'intro', 'Una selección editorial para equipos de capacitación que buscan convertir nuevas herramientas en experiencias de aprendizaje concretas y medibles.',
    'articles', jsonb_build_array(
      jsonb_build_object(
        'id', '8108a490-cae8-4c52-9673-3d8e7196e082',
        'title', 'Completar cursos no es lo mismo que adoptar herramientas: qué medir para saber si funciona',
        'summary', 'Completar un curso no demuestra adopción. Conviene medir uso sostenido, cambios de comportamiento y reducción de solicitudes de soporte.',
        'url', 'https://www.rasika.cl/blog/completar-cursos-no-es-lo-mismo-que-adoptar-herramientas-que-medir-para-saber-si-funciona-83e5f05b/',
        'image_url', 'https://firnxsegqamdoajycpyf.supabase.co/storage/v1/object/public/ai-radar-thumbnails/83e5f05b-6f53-4cd0-96e3-726f18be4e5c.png?v=2026-07-17T18%3A57%3A07.101Z',
        'link_key', 'article-adopcion'
      ),
      jsonb_build_object(
        'id', '2cb0cf42-ccd9-4740-a798-86ce84d640ba',
        'title', 'Mantener la integridad académica en la era de la IA: prioridades institucionales',
        'summary', 'El desafío es diseñar tutores IA que reconozcan el contexto evaluativo, protejan los desafíos formativos y refuercen el aprendizaje.',
        'url', 'https://www.rasika.cl/blog/mantener-la-integridad-academica-en-la-era-de-la-ia-prioridades-institucionales-30eb8095/',
        'image_url', 'https://firnxsegqamdoajycpyf.supabase.co/storage/v1/object/public/ai-radar-thumbnails/30eb8095-b84f-4f2e-9476-693b8f82ef6c.png?v=2026-07-15T18%3A58%3A42.037Z',
        'link_key', 'article-integridad'
      )
    ),
    'services', jsonb_build_array(
      jsonb_build_object(
        'id', '0cabec7c-39f7-497d-bdb9-97f1e3124a14',
        'title', 'Chroma Key con IA generativa',
        'summary', 'Actores reales aportan interpretación y emoción; la IA crea locaciones, vestuario y extras para producir escenas más ambiciosas a una fracción del costo.',
        'url', 'https://www.rasika.cl/demos/?demo=video-enhance-ia',
        'image_url', 'https://www.rasika.cl/images/demos/video-enhance-ia.jpg',
        'link_key', 'service-chroma'
      ),
      jsonb_build_object(
        'id', 'f2ab2a6d-2292-47e9-9517-7f9de7b545d6',
        'title', 'CourseMentor',
        'summary', 'Un asistente IA conectado al contenido y progreso del curso: responde dudas, protege evaluaciones y orienta refuerzo donde existe bajo desempeño.',
        'url', 'https://www.rasika.cl/lms/',
        'image_url', 'https://www.rasika.cl/images/newsletter/coursementor.png',
        'link_key', 'service-coursementor'
      )
    ),
    'linkedin_url', 'https://www.linkedin.com/company/rasika-producciones/',
    'linkedin_link_key', 'social-linkedin'
  ),
  100,
  'blocked',
  'Imported OTEC contacts are not subscribed. Test delivery only until consent, quota and approval checks pass.'
from public.marketing_content_queue q
where q.content_id in (
  '8108a490-cae8-4c52-9673-3d8e7196e082'::uuid,
  '2cb0cf42-ccd9-4740-a798-86ce84d640ba'::uuid,
  '0cabec7c-39f7-497d-bdb9-97f1e3124a14'::uuid,
  'f2ab2a6d-2292-47e9-9517-7f9de7b545d6'::uuid
)
on conflict (campaign_key) where campaign_key is not null do update set
  subject = excluded.subject,
  preview_text = excluded.preview_text,
  content_queue_ids = excluded.content_queue_ids,
  content_json = excluded.content_json,
  reserved_transactional_quota = excluded.reserved_transactional_quota,
  safety_notes = excluded.safety_notes;

insert into public.marketing_campaign_links (
  campaign_id,
  link_key,
  block_type,
  label,
  destination_url,
  position
)
select c.id, values_to_insert.link_key, values_to_insert.block_type, values_to_insert.label,
  values_to_insert.destination_url, values_to_insert.position
from public.marketing_campaigns c
cross join (
  values
    ('article-adopcion', 'article', 'Leer sobre adopción tecnológica', 'https://www.rasika.cl/blog/completar-cursos-no-es-lo-mismo-que-adoptar-herramientas-que-medir-para-saber-si-funciona-83e5f05b/', 1),
    ('article-integridad', 'article', 'Leer sobre integridad académica', 'https://www.rasika.cl/blog/mantener-la-integridad-academica-en-la-era-de-la-ia-prioridades-institucionales-30eb8095/', 2),
    ('service-chroma', 'service', 'Ver Chroma Key con IA', 'https://www.rasika.cl/demos/?demo=video-enhance-ia', 3),
    ('service-coursementor', 'service', 'Conocer CourseMentor', 'https://www.rasika.cl/lms/', 4),
    ('social-linkedin', 'social', 'Seguir a Rasika en LinkedIn', 'https://www.linkedin.com/company/rasika-producciones/', 5),
    ('unsubscribe', 'unsubscribe', 'Cancelar suscripción', 'https://www.rasika.cl/newsletter/unsubscribe/', 6)
) as values_to_insert(link_key, block_type, label, destination_url, position)
where c.campaign_key = 'otec-insights-01'
on conflict (campaign_id, link_key) do update set
  label = excluded.label,
  destination_url = excluded.destination_url,
  position = excluded.position;

create or replace function public.record_marketing_campaign_event(
  event_provider_id text,
  event_type_value text,
  event_resend_email_id text,
  event_link_key text,
  event_link_url text,
  event_occurred_at timestamptz,
  event_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient public.marketing_campaign_recipients%rowtype;
begin
  if event_type_value not in (
    'sent', 'delivered', 'delivery_delayed', 'failed', 'opened', 'clicked',
    'bounced', 'complained', 'suppressed', 'unsubscribed'
  ) then
    return false;
  end if;

  select * into recipient
  from public.marketing_campaign_recipients
  where resend_email_id = event_resend_email_id
  limit 1;

  if recipient.id is null then
    return false;
  end if;

  insert into public.marketing_campaign_events (
    provider_event_id,
    campaign_id,
    recipient_id,
    contact_id,
    event_type,
    resend_email_id,
    link_key,
    link_url,
    metadata,
    occurred_at
  ) values (
    event_provider_id,
    recipient.campaign_id,
    recipient.id,
    recipient.contact_id,
    event_type_value,
    event_resend_email_id,
    nullif(event_link_key, ''),
    nullif(event_link_url, ''),
    coalesce(event_metadata, '{}'::jsonb),
    coalesce(event_occurred_at, now())
  )
  on conflict (provider_event_id) do nothing;

  if not found then
    return false;
  end if;

  update public.marketing_campaign_recipients
  set
    status = case
      when event_type_value = 'complained' then 'complained'
      when event_type_value = 'bounced' then 'bounced'
      when event_type_value = 'suppressed' then 'suppressed'
      when event_type_value = 'unsubscribed' then 'unsubscribed'
      when event_type_value = 'failed' and status not in ('clicked', 'opened', 'delivered') then 'failed'
      when event_type_value = 'clicked' and status not in ('complained', 'bounced', 'suppressed', 'unsubscribed') then 'clicked'
      when event_type_value = 'opened' and status not in ('clicked', 'complained', 'bounced', 'suppressed', 'unsubscribed') then 'opened'
      when event_type_value = 'delivered' and status in ('candidate', 'eligible', 'queued', 'sent') then 'delivered'
      when event_type_value = 'sent' and status in ('candidate', 'eligible', 'queued') then 'sent'
      else status
    end,
    sent_at = case when event_type_value = 'sent' then coalesce(sent_at, event_occurred_at) else sent_at end,
    delivered_at = case when event_type_value = 'delivered' then coalesce(delivered_at, event_occurred_at) else delivered_at end,
    first_opened_at = case when event_type_value = 'opened' then coalesce(first_opened_at, event_occurred_at) else first_opened_at end,
    last_opened_at = case when event_type_value = 'opened' then event_occurred_at else last_opened_at end,
    first_clicked_at = case when event_type_value = 'clicked' then coalesce(first_clicked_at, event_occurred_at) else first_clicked_at end,
    last_clicked_at = case when event_type_value = 'clicked' then event_occurred_at else last_clicked_at end,
    bounced_at = case when event_type_value = 'bounced' then event_occurred_at else bounced_at end,
    complained_at = case when event_type_value = 'complained' then event_occurred_at else complained_at end,
    unsubscribed_at = case when event_type_value = 'unsubscribed' then event_occurred_at else unsubscribed_at end,
    open_count = open_count + case when event_type_value = 'opened' then 1 else 0 end,
    click_count = click_count + case when event_type_value = 'clicked' then 1 else 0 end,
    last_clicked_url = case when event_type_value = 'clicked' then nullif(event_link_url, '') else last_clicked_url end,
    last_error = case when event_type_value in ('failed', 'bounced', 'complained', 'suppressed')
      then left(coalesce(event_metadata->>'reason', event_type_value), 500)
      else last_error
    end
  where id = recipient.id;

  if event_type_value = 'delivered' then
    update public.contacts
    set deliverability_status = 'deliverable', last_delivered_at = event_occurred_at
    where id = recipient.contact_id
      and deliverability_status not in ('complained', 'suppressed');
  elsif event_type_value in ('bounced', 'complained', 'suppressed') then
    update public.contacts
    set
      status = 'suppressed',
      newsletter_status = 'suppressed',
      deliverability_status = case
        when event_type_value = 'bounced' then 'bounced'
        when event_type_value = 'complained' then 'complained'
        else 'suppressed'
      end,
      last_bounced_at = case when event_type_value = 'bounced' then event_occurred_at else last_bounced_at end,
      last_complained_at = case when event_type_value = 'complained' then event_occurred_at else last_complained_at end,
      deliverability_detail = left(coalesce(event_metadata->>'reason', event_type_value), 500)
    where id = recipient.contact_id;
  elsif event_type_value = 'unsubscribed' then
    update public.contacts
    set newsletter_status = 'unsubscribed', newsletter_unsubscribed_at = event_occurred_at
    where id = recipient.contact_id;
  end if;

  return true;
end;
$$;

revoke all on function public.record_marketing_campaign_event(text, text, text, text, text, timestamptz, jsonb)
from public, anon, authenticated;
grant execute on function public.record_marketing_campaign_event(text, text, text, text, text, timestamptz, jsonb)
to service_role;
