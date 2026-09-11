create table public.pm_project_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pm_projects(id) on delete restrict,
  token_hash text not null unique,
  token_hint text not null,
  label text not null default 'Vista cliente',
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint pm_project_share_links_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint pm_project_share_links_token_hint_check
    check (length(token_hint) between 6 and 16),
  constraint pm_project_share_links_label_check
    check (length(btrim(label)) between 2 and 120),
  constraint pm_project_share_links_expiry_check
    check (expires_at is null or expires_at > created_at),
  constraint pm_project_share_links_revocation_check
    check (revoked_at is null or revoked_at >= created_at)
);

create index pm_project_share_links_project_idx
  on public.pm_project_share_links (project_id, created_at desc);

create index pm_project_share_links_active_idx
  on public.pm_project_share_links (project_id, expires_at)
  where revoked_at is null;

alter table public.pm_project_share_links enable row level security;
revoke all on table public.pm_project_share_links from public, anon, authenticated;
grant all on table public.pm_project_share_links to service_role;

comment on table public.pm_project_share_links is
  'Opaque, revocable project share links. Only SHA-256 token hashes are stored; public reads are projected through project-admin.';
