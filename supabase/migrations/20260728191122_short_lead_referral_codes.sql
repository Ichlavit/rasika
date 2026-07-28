alter table public.leads
  add column if not exists referral_code text,
  add column if not exists referred_by_lead_id uuid references public.leads(id) on delete set null;

update public.leads
set referral_code = translate(
  encode(substring(uuid_send(gen_random_uuid()) from 1 for 6), 'base64'),
  '/+',
  '_-'
)
where referral_code is null;

alter table public.leads
  alter column referral_code set default translate(
    encode(substring(uuid_send(gen_random_uuid()) from 1 for 6), 'base64'),
    '/+',
    '_-'
  ),
  alter column referral_code set not null;

create unique index if not exists leads_referral_code_key
  on public.leads (referral_code);

create index if not exists leads_referred_by_lead_id_idx
  on public.leads (referred_by_lead_id);

alter table public.leads
  drop constraint if exists leads_referral_code_format,
  add constraint leads_referral_code_format
    check (referral_code ~ '^[A-Za-z0-9_-]{8}$'),
  drop constraint if exists leads_no_self_referral,
  add constraint leads_no_self_referral
    check (referred_by_lead_id is null or referred_by_lead_id <> id);
