create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  organization_type text not null default 'company',
  external_id text,
  legal_name text not null,
  display_name text,
  phone text,
  address text,
  municipality text,
  region text,
  country_code text not null default 'CL'
    check (country_code ~ '^[A-Z]{2}$'),
  status text not null default 'unknown'
    check (status in ('active', 'inactive', 'unknown')),
  source_type text not null,
  source_detail text,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_external_id_length_check
    check (external_id is null or length(external_id) between 3 and 80)
);

alter table public.organizations
  add constraint organizations_source_external_id_key
  unique (source_type, external_id);

create index organizations_type_status_idx
  on public.organizations (organization_type, status);
create index organizations_tags_gin_idx
  on public.organizations using gin (tags);
create index organizations_region_idx
  on public.organizations (region)
  where region is not null;

alter table public.organizations enable row level security;
revoke all on public.organizations from public, anon, authenticated;
grant all on public.organizations to service_role;

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
before update on public.organizations
for each row execute function public.set_ai_radar_updated_at();

create table public.organization_contacts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  relationship_type text not null default 'general',
  is_primary boolean not null default false,
  source_detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, contact_id)
);

create index organization_contacts_contact_idx
  on public.organization_contacts (contact_id, organization_id);

alter table public.organization_contacts enable row level security;
revoke all on public.organization_contacts from public, anon, authenticated;
grant all on public.organization_contacts to service_role;

drop trigger if exists set_organization_contacts_updated_at on public.organization_contacts;
create trigger set_organization_contacts_updated_at
before update on public.organization_contacts
for each row execute function public.set_ai_radar_updated_at();

create index if not exists contacts_tags_gin_idx
  on public.contacts using gin (tags);

alter table public.contact_imports
  add column if not exists label text,
  add column if not exists source_file_sha256 text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists contact_imports_label_created_idx
  on public.contact_imports (label, created_at desc);
create index if not exists contact_imports_source_file_sha256_idx
  on public.contact_imports (source_file_sha256)
  where source_file_sha256 is not null;

create or replace function public.import_organization_contacts_batch(batch jsonb)
returns table (
  processed_rows integer,
  organizations_written integer,
  contacts_written integer,
  relationships_written integer,
  skipped_contacts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  organization_id uuid;
  contact_id uuid;
  normalized_external_id text;
  normalized_email text;
  organization_source_type text;
  organization_legal_name text;
  organization_display_name text;
  organization_tags text[];
  contact_tags text[];
begin
  if jsonb_typeof(batch) <> 'array' then
    raise exception 'Batch must be a JSON array';
  end if;
  if jsonb_array_length(batch) < 1 or jsonb_array_length(batch) > 500 then
    raise exception 'Batch must contain between 1 and 500 rows';
  end if;

  processed_rows := 0;
  organizations_written := 0;
  contacts_written := 0;
  relationships_written := 0;
  skipped_contacts := 0;

  for item in select value from jsonb_array_elements(batch)
  loop
    processed_rows := processed_rows + 1;
    normalized_external_id := regexp_replace(
      upper(btrim(coalesce(item->>'organization_external_id', ''))),
      '[^0-9K]',
      '',
      'g'
    );
    organization_source_type := left(btrim(coalesce(item->>'organization_source_type', 'registry_import')), 80);
    organization_legal_name := left(btrim(coalesce(item->>'organization_legal_name', '')), 240);
    organization_display_name := nullif(left(btrim(coalesce(item->>'organization_display_name', '')), 240), '');

    if length(normalized_external_id) < 3 or organization_legal_name = '' then
      raise exception 'Organization external ID and legal name are required';
    end if;

    select coalesce(array_agg(distinct left(btrim(value), 80)) filter (where btrim(value) <> ''), '{}'::text[])
    into organization_tags
    from jsonb_array_elements_text(coalesce(item->'organization_tags', '[]'::jsonb));

    insert into public.organizations (
      organization_type,
      external_id,
      legal_name,
      display_name,
      phone,
      address,
      municipality,
      region,
      country_code,
      status,
      source_type,
      source_detail,
      tags,
      metadata
    ) values (
      left(lower(btrim(coalesce(item->>'organization_type', 'company'))), 80),
      normalized_external_id,
      organization_legal_name,
      organization_display_name,
      nullif(left(btrim(coalesce(item->>'organization_phone', '')), 60), ''),
      nullif(left(btrim(coalesce(item->>'organization_address', '')), 300), ''),
      nullif(left(btrim(coalesce(item->>'organization_municipality', '')), 120), ''),
      nullif(left(btrim(coalesce(item->>'organization_region', '')), 160), ''),
      case when coalesce(item->>'organization_country_code', 'CL') ~ '^[A-Z]{2}$'
        then item->>'organization_country_code' else 'CL' end,
      case when item->>'organization_status' in ('active', 'inactive', 'unknown')
        then item->>'organization_status' else 'unknown' end,
      organization_source_type,
      nullif(left(btrim(coalesce(item->>'source_detail', '')), 200), ''),
      organization_tags,
      coalesce(item->'organization_metadata', '{}'::jsonb)
    )
    on conflict (source_type, external_id) do update set
      legal_name = excluded.legal_name,
      display_name = coalesce(excluded.display_name, public.organizations.display_name),
      phone = coalesce(excluded.phone, public.organizations.phone),
      address = coalesce(excluded.address, public.organizations.address),
      municipality = coalesce(excluded.municipality, public.organizations.municipality),
      region = coalesce(excluded.region, public.organizations.region),
      status = excluded.status,
      source_detail = coalesce(excluded.source_detail, public.organizations.source_detail),
      tags = (
        select coalesce(array_agg(distinct tag), '{}'::text[])
        from unnest(public.organizations.tags || excluded.tags) as tag
      ),
      metadata = public.organizations.metadata || excluded.metadata
    returning id into organization_id;

    organizations_written := organizations_written + 1;
    normalized_email := lower(btrim(coalesce(item->>'email', '')));
    if normalized_email = '' or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      skipped_contacts := skipped_contacts + 1;
      continue;
    end if;

    select coalesce(array_agg(distinct left(btrim(value), 80)) filter (where btrim(value) <> ''), '{}'::text[])
    into contact_tags
    from jsonb_array_elements_text(coalesce(item->'contact_tags', '[]'::jsonb));

    insert into public.contacts (
      email,
      company_name,
      phone,
      lifecycle_stage,
      status,
      language,
      source_type,
      source_detail,
      tags,
      newsletter_status,
      resend_sync_status,
      metadata
    ) values (
      normalized_email,
      coalesce(organization_display_name, organization_legal_name),
      nullif(left(btrim(coalesce(item->>'organization_phone', '')), 60), ''),
      'contact',
      'active',
      case when item->>'language' = 'en' then 'en' else 'es' end,
      left(btrim(coalesce(item->>'contact_source_type', 'registry_import')), 80),
      nullif(left(btrim(coalesce(item->>'source_detail', '')), 200), ''),
      contact_tags,
      'not_subscribed',
      'not_synced',
      coalesce(item->'contact_metadata', '{}'::jsonb)
    )
    on conflict ((lower(email))) do update set
      company_name = coalesce(public.contacts.company_name, excluded.company_name),
      phone = coalesce(public.contacts.phone, excluded.phone),
      tags = (
        select coalesce(array_agg(distinct tag), '{}'::text[])
        from unnest(public.contacts.tags || excluded.tags) as tag
      ),
      metadata = public.contacts.metadata || excluded.metadata
    returning id into contact_id;

    contacts_written := contacts_written + 1;

    insert into public.organization_contacts (
      organization_id,
      contact_id,
      relationship_type,
      is_primary,
      source_detail,
      metadata
    ) values (
      organization_id,
      contact_id,
      left(btrim(coalesce(item->>'relationship_type', 'general')), 80),
      case when lower(coalesce(item->>'is_primary', 'false')) in ('true', '1', 'yes')
        then true else false end,
      nullif(left(btrim(coalesce(item->>'source_detail', '')), 200), ''),
      jsonb_build_object(
        'source_row',
        case when coalesce(item->>'source_row', '') ~ '^[0-9]+$'
          then (item->>'source_row')::integer else null end
      )
    )
    on conflict (organization_id, contact_id) do update set
      relationship_type = excluded.relationship_type,
      is_primary = public.organization_contacts.is_primary or excluded.is_primary,
      source_detail = coalesce(excluded.source_detail, public.organization_contacts.source_detail),
      metadata = public.organization_contacts.metadata || excluded.metadata;

    relationships_written := relationships_written + 1;
  end loop;

  return next;
end;
$$;

revoke all on function public.import_organization_contacts_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.import_organization_contacts_batch(jsonb)
  to service_role;
