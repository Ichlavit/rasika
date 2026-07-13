create extension if not exists pgcrypto with schema extensions;

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  service_id uuid references public.services(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'pending quote',
  quoted_service text,
  quoted_price numeric,
  quoted_currency text not null default 'UF',
  billing_basis text,
  ai_summary text,
  language text default 'es',
  sent_at timestamptz,
  clicked_scheduling_link_at timestamptz
);

alter table public.quotes
  add column if not exists lead_id uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists service_id uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists status text not null default 'pending quote',
  add column if not exists quoted_service text,
  add column if not exists quoted_price numeric,
  add column if not exists quoted_currency text not null default 'UF',
  add column if not exists billing_basis text,
  add column if not exists ai_summary text,
  add column if not exists language text default 'es',
  add column if not exists sent_at timestamptz,
  add column if not exists clicked_scheduling_link_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_lead_id_fkey'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_lead_id_fkey
      foreign key (lead_id)
      references public.leads(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_service_id_fkey'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_service_id_fkey
      foreign key (service_id)
      references public.services(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_status_check'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_status_check
      check (
        status in (
          'pending quote',
          'quote processing',
          'quote sent',
          'quote failed',
          'clicked scheduling link'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_quoted_currency_check'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_quoted_currency_check
      check (quoted_currency in ('UF', 'CLP', 'USD'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_billing_basis_check'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_billing_basis_check
      check (
        billing_basis is null
        or billing_basis in (
          'one_time_project',
          'user_month',
          'user_year',
          'monthly_subscription',
          'yearly_subscription'
        )
      );
  end if;
end $$;

create index if not exists quotes_lead_id_created_at_idx
  on public.quotes (lead_id, created_at desc);

create index if not exists quotes_status_created_at_idx
  on public.quotes (status, created_at asc);

create or replace function public.set_quotes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_quotes_updated_at on public.quotes;

create trigger set_quotes_updated_at
before update on public.quotes
for each row
execute function public.set_quotes_updated_at();

alter table public.quotes enable row level security;

revoke select, insert, update, delete on table public.quotes
from anon, authenticated;

grant select, insert, update, delete on table public.quotes
to service_role;
