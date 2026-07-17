create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  first_name text,
  last_name text,
  company_name text,
  phone text,
  lifecycle_stage text not null default 'contact'
    check (lifecycle_stage in ('contact', 'subscriber', 'lead', 'opportunity', 'client', 'inactive')),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'suppressed')),
  language text not null default 'es'
    check (language in ('es', 'en')),
  source_type text not null default 'organic',
  source_detail text,
  tags text[] not null default '{}',
  newsletter_status text not null default 'not_subscribed'
    check (newsletter_status in ('not_subscribed', 'subscribed', 'unsubscribed', 'suppressed')),
  newsletter_consented_at timestamptz,
  newsletter_consent_source text,
  newsletter_unsubscribed_at timestamptz,
  unsubscribe_token_hash text,
  resend_contact_id text,
  resend_sync_status text not null default 'not_synced'
    check (resend_sync_status in ('not_synced', 'synced', 'failed')),
  resend_synced_at timestamptz,
  resend_last_error text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_email_format_check check (
    length(email) between 3 and 320
    and email = btrim(email)
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

create unique index contacts_email_lower_uidx on public.contacts ((lower(email)));
create unique index contacts_unsubscribe_token_hash_uidx
  on public.contacts (unsubscribe_token_hash)
  where unsubscribe_token_hash is not null;
create index contacts_created_at_idx on public.contacts (created_at desc);
create index contacts_newsletter_status_idx on public.contacts (newsletter_status, created_at desc);
create index contacts_lifecycle_stage_idx on public.contacts (lifecycle_stage, last_seen_at desc);

alter table public.contacts enable row level security;
revoke all on public.contacts from anon, authenticated;
grant all on public.contacts to service_role;

drop trigger if exists set_contacts_updated_at on public.contacts;
create trigger set_contacts_updated_at
before update on public.contacts
for each row execute function public.set_ai_radar_updated_at();

alter table public.leads
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
create index if not exists leads_contact_id_idx on public.leads (contact_id);

insert into public.contacts (
  email,
  full_name,
  company_name,
  phone,
  lifecycle_stage,
  language,
  source_type,
  source_detail,
  first_seen_at,
  last_seen_at,
  metadata
)
select distinct on (lower(l.email))
  lower(btrim(l.email)),
  nullif(btrim(l.name), ''),
  nullif(btrim(l.company_name), ''),
  nullif(btrim(l.phone), ''),
  'lead',
  case when l.language = 'en' then 'en' else 'es' end,
  'lead',
  nullif(btrim(l.traffic_source), ''),
  l.created_at,
  l.created_at,
  jsonb_build_object('backfilled_from_lead_id', l.id)
from public.leads l
where l.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  and lower(l.email) not like '%@pendiente.rasika.cl'
  and lower(l.email) not like 'pendiente@rasika.cl'
order by lower(l.email), l.created_at desc
on conflict ((lower(email))) do nothing;

update public.leads l
set contact_id = c.id
from public.contacts c
where lower(c.email) = lower(l.email)
  and l.contact_id is distinct from c.id;

create or replace function private.sync_lead_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  synced_contact_id uuid;
begin
  if new.email is null
    or new.email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or lower(new.email) like '%@pendiente.rasika.cl'
    or lower(new.email) = 'pendiente@rasika.cl'
  then
    return new;
  end if;

  insert into public.contacts (
    email,
    full_name,
    company_name,
    phone,
    lifecycle_stage,
    language,
    source_type,
    source_detail,
    first_seen_at,
    last_seen_at,
    metadata
  )
  values (
    lower(btrim(new.email)),
    nullif(btrim(new.name), ''),
    nullif(btrim(new.company_name), ''),
    nullif(btrim(new.phone), ''),
    'lead',
    case when new.language = 'en' then 'en' else 'es' end,
    'lead',
    nullif(btrim(new.traffic_source), ''),
    new.created_at,
    now(),
    jsonb_build_object('last_lead_id', new.id)
  )
  on conflict ((lower(email))) do update set
    full_name = coalesce(nullif(excluded.full_name, ''), public.contacts.full_name),
    company_name = coalesce(nullif(excluded.company_name, ''), public.contacts.company_name),
    phone = coalesce(nullif(excluded.phone, ''), public.contacts.phone),
    lifecycle_stage = case
      when public.contacts.lifecycle_stage in ('client', 'opportunity') then public.contacts.lifecycle_stage
      else 'lead'
    end,
    language = coalesce(excluded.language, public.contacts.language),
    source_detail = coalesce(public.contacts.source_detail, excluded.source_detail),
    first_seen_at = least(public.contacts.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(public.contacts.last_seen_at, excluded.last_seen_at),
    metadata = public.contacts.metadata || excluded.metadata
  returning id into synced_contact_id;

  if new.contact_id is distinct from synced_contact_id then
    update public.leads
    set contact_id = synced_contact_id
    where id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_lead_contact() from public, anon, authenticated;

drop trigger if exists sync_lead_contact_after_write on public.leads;
create trigger sync_lead_contact_after_write
after insert or update of email, name, company_name, phone, traffic_source, language
on public.leads
for each row execute function private.sync_lead_contact();

create table public.contact_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'completed_with_errors', 'failed')),
  total_rows integer not null default 0 check (total_rows >= 0),
  inserted_rows integer not null default 0 check (inserted_rows >= 0),
  updated_rows integer not null default 0 check (updated_rows >= 0),
  skipped_rows integer not null default 0 check (skipped_rows >= 0),
  consented_rows integer not null default 0 check (consented_rows >= 0),
  errors jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.contact_imports enable row level security;
revoke all on public.contact_imports from anon, authenticated;
grant all on public.contact_imports to service_role;
create index contact_imports_created_at_idx on public.contact_imports (created_at desc);

create table public.site_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  event_type text not null
    check (event_type in ('page_view', 'click', 'session_engagement', 'form_submit', 'newsletter_subscribe', 'article_view', 'chatbot_open', 'quote_requested')),
  page_path text not null,
  source text not null default 'direct',
  referrer text,
  country_code text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint site_events_page_path_check check (left(page_path, 1) = '/' and length(page_path) <= 500),
  constraint site_events_source_check check (length(source) between 1 and 80),
  constraint site_events_country_code_check check (country_code is null or country_code ~ '^[A-Z]{2}$')
);

alter table public.site_events enable row level security;
revoke all on public.site_events from anon, authenticated;
grant all on public.site_events to service_role;
create index site_events_occurred_at_idx on public.site_events (occurred_at desc);
create index site_events_session_idx on public.site_events (session_id, occurred_at);
create index site_events_type_time_idx on public.site_events (event_type, occurred_at desc);
create index site_events_page_time_idx on public.site_events (page_path, occurred_at desc);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  event_url text,
  location text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'cancelled', 'completed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_date_order_check check (ends_at is null or ends_at >= starts_at)
);

alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant all on public.events to service_role;
create index events_status_starts_at_idx on public.events (status, starts_at);
drop trigger if exists set_events_updated_at on public.events;
create trigger set_events_updated_at
before update on public.events
for each row execute function public.set_ai_radar_updated_at();

create table public.marketing_content_queue (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('article', 'service', 'event')),
  content_id uuid not null,
  title text not null,
  summary text,
  public_url text,
  status text not null default 'queued'
    check (status in ('queued', 'included', 'dismissed')),
  detected_at timestamptz not null default now(),
  included_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_type, content_id)
);

alter table public.marketing_content_queue enable row level security;
revoke all on public.marketing_content_queue from anon, authenticated;
grant all on public.marketing_content_queue to service_role;
create index marketing_content_queue_status_idx
  on public.marketing_content_queue (status, detected_at desc);
drop trigger if exists set_marketing_content_queue_updated_at on public.marketing_content_queue;
create trigger set_marketing_content_queue_updated_at
before update on public.marketing_content_queue
for each row execute function public.set_ai_radar_updated_at();

create table public.marketing_integrations (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  status text not null default 'not_configured'
    check (status in ('not_configured', 'connected', 'error')),
  config jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_integrations enable row level security;
revoke all on public.marketing_integrations from anon, authenticated;
grant all on public.marketing_integrations to service_role;
drop trigger if exists set_marketing_integrations_updated_at on public.marketing_integrations;
create trigger set_marketing_integrations_updated_at
before update on public.marketing_integrations
for each row execute function public.set_ai_radar_updated_at();

insert into public.marketing_integrations (provider)
values ('resend')
on conflict (provider) do nothing;

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text,
  preview_text text,
  html_content text,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approved', 'scheduled', 'sent', 'cancelled')),
  segment text not null default 'newsletter_subscribers',
  content_queue_ids uuid[] not null default '{}',
  audience_count integer check (audience_count is null or audience_count >= 0),
  resend_broadcast_id text,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_campaigns enable row level security;
revoke all on public.marketing_campaigns from anon, authenticated;
grant all on public.marketing_campaigns to service_role;
create index marketing_campaigns_status_idx on public.marketing_campaigns (status, created_at desc);
drop trigger if exists set_marketing_campaigns_updated_at on public.marketing_campaigns;
create trigger set_marketing_campaigns_updated_at
before update on public.marketing_campaigns
for each row execute function public.set_ai_radar_updated_at();

create or replace function private.queue_marketing_content(
  queued_type text,
  queued_id uuid,
  queued_title text,
  queued_summary text,
  queued_url text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.marketing_content_queue (
    content_type,
    content_id,
    title,
    summary,
    public_url
  )
  values (
    queued_type,
    queued_id,
    queued_title,
    queued_summary,
    queued_url
  )
  on conflict (content_type, content_id) do update set
    title = excluded.title,
    summary = excluded.summary,
    public_url = excluded.public_url;
$$;

revoke all on function private.queue_marketing_content(text, uuid, text, text, text)
from public, anon, authenticated;

create or replace function private.queue_published_blog_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.published_at is not null and new.slug is not null then
    perform private.queue_marketing_content(
      'article',
      new.id,
      new.title,
      new.excerpt,
      '/blog/' || new.slug || '/'
    );
  end if;
  return new;
end;
$$;

revoke all on function private.queue_published_blog_post() from public, anon, authenticated;
drop trigger if exists queue_published_blog_post_after_write on public.blog_posts;
create trigger queue_published_blog_post_after_write
after insert or update of published_at, slug, title, excerpt
on public.blog_posts
for each row execute function private.queue_published_blog_post();

create or replace function private.queue_new_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.queue_marketing_content(
    'service',
    new.id,
    new.service_name,
    new.public_description,
    '/pricing/'
  );
  return new;
end;
$$;

revoke all on function private.queue_new_service() from public, anon, authenticated;
drop trigger if exists queue_new_service_after_insert on public.services;
create trigger queue_new_service_after_insert
after insert on public.services
for each row execute function private.queue_new_service();

create or replace function private.queue_published_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' then
    perform private.queue_marketing_content(
      'event',
      new.id,
      new.title,
      new.summary,
      new.event_url
    );
  end if;
  return new;
end;
$$;

revoke all on function private.queue_published_event() from public, anon, authenticated;
drop trigger if exists queue_published_event_after_write on public.events;
create trigger queue_published_event_after_write
after insert or update of status, title, summary, event_url
on public.events
for each row execute function private.queue_published_event();

insert into public.marketing_content_queue (
  content_type,
  content_id,
  title,
  summary,
  public_url,
  detected_at
)
select
  'article',
  id,
  title,
  excerpt,
  '/blog/' || slug || '/',
  published_at
from public.blog_posts
where published_at is not null and slug is not null
on conflict (content_type, content_id) do nothing;
