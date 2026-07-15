create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ai_radar_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_radar_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  source_name text not null,
  organization text,
  homepage_url text not null,
  feed_or_api_url text,
  source_section_url text,
  source_type text not null,
  content_format text not null,
  languages text[] not null default '{}'::text[],
  region text,
  authority_reason text not null,
  trust_tier text not null,
  evidence_position text not null,
  editorial_independence text,
  relevant_topics text[] not null default '{}'::text[],
  excluded_topics text[] not null default '{}'::text[],
  update_frequency text,
  access_method text,
  authentication_required boolean not null default false,
  paywall_status text,
  robots_url text,
  robots_or_terms_notes text,
  rate_limit_notes text,
  publication_date_available boolean not null default false,
  author_available text,
  canonical_url_available text,
  full_text_available text,
  recommended_poll_interval text,
  poll_interval_minutes integer,
  active_recommendation text not null,
  is_enabled boolean not null default false,
  health_status text not null default 'unverified',
  etag text,
  last_modified text,
  last_polled_at timestamptz,
  last_success_at timestamptz,
  next_poll_at timestamptz,
  consecutive_failures integer not null default 0,
  research_notes text,
  verified_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_radar_sources_trust_tier_check
    check (trust_tier in ('A', 'B', 'C', 'Exclude')),
  constraint ai_radar_sources_evidence_position_check
    check (evidence_position in ('primary', 'secondary', 'mixed', 'unclear')),
  constraint ai_radar_sources_recommendation_check
    check (
      active_recommendation in (
        'core',
        'secondary',
        'manual-only',
        'monitor-with-caution',
        'exclude'
      )
    ),
  constraint ai_radar_sources_health_status_check
    check (health_status in ('unverified', 'healthy', 'degraded', 'paused')),
  constraint ai_radar_sources_poll_interval_check
    check (poll_interval_minutes is null or poll_interval_minutes >= 60),
  constraint ai_radar_sources_failures_check
    check (consecutive_failures >= 0),
  constraint ai_radar_sources_homepage_url_check
    check (homepage_url ~ '^https://'),
  constraint ai_radar_sources_feed_url_check
    check (feed_or_api_url is null or feed_or_api_url ~ '^https://')
);

create table if not exists public.ai_radar_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_kind text not null,
  status text not null default 'queued',
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  sources_considered integer not null default 0,
  sources_succeeded integer not null default 0,
  candidates_discovered integer not null default 0,
  candidates_created integer not null default 0,
  candidates_deduplicated integer not null default 0,
  candidates_failed integer not null default 0,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_radar_runs_trigger_kind_check
    check (trigger_kind in ('manual', 'cron', 'retry', 'test')),
  constraint ai_radar_runs_status_check
    check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
  constraint ai_radar_runs_counts_check
    check (
      sources_considered >= 0
      and sources_succeeded >= 0
      and candidates_discovered >= 0
      and candidates_created >= 0
      and candidates_deduplicated >= 0
      and candidates_failed >= 0
    )
);

create table if not exists public.ai_radar_candidates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.ai_radar_sources(id) on delete restrict,
  run_id uuid references public.ai_radar_runs(id) on delete set null,
  canonical_url text not null unique,
  source_title text not null,
  source_author text,
  source_published_at timestamptz,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  language text,
  source_excerpt text,
  content_hash text,
  status text not null default 'discovered',
  evidence_score smallint,
  authority_score smallint,
  innovation_score smallint,
  rasika_alignment_score smallint,
  practical_relevance_score smallint,
  freshness_score smallint,
  score_total smallint generated always as (
    coalesce(evidence_score, 0)
    + coalesce(authority_score, 0)
    + coalesce(innovation_score, 0)
    + coalesce(rasika_alignment_score, 0)
    + coalesce(practical_relevance_score, 0)
    + coalesce(freshness_score, 0)
  ) stored,
  latam_relevance_score smallint,
  hype_or_marketing_risk smallint,
  hard_reject boolean not null default false,
  passes_research_threshold boolean generated always as (
    not hard_reject
    and coalesce(evidence_score, 0) >= 15
    and coalesce(authority_score, 0) >= 12
    and coalesce(rasika_alignment_score, 0) >= 12
    and (
      coalesce(evidence_score, 0)
      + coalesce(authority_score, 0)
      + coalesce(innovation_score, 0)
      + coalesce(rasika_alignment_score, 0)
      + coalesce(practical_relevance_score, 0)
      + coalesce(freshness_score, 0)
    ) >= 70
  ) stored,
  confidence numeric(4, 3),
  decision_reason text,
  editorial_summary text,
  why_it_matters text,
  rasika_parallelism text,
  suggested_headline text,
  linkedin_copy text,
  suggested_hashtags text[] not null default '{}'::text[],
  thumbnail_prompt text,
  thumbnail_url text,
  matched_topics text[] not null default '{}'::text[],
  claims_to_attribute jsonb not null default '[]'::jsonb,
  necessary_caveats jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  evaluation jsonb not null default '{}'::jsonb,
  model_name text,
  prompt_version text,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  failure_reason text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_radar_candidates_status_check
    check (
      status in (
        'discovered',
        'evaluating',
        'suggested',
        'needs_review',
        'approved',
        'rejected',
        'published',
        'archived',
        'failed'
      )
    ),
  constraint ai_radar_candidates_url_check
    check (canonical_url ~ '^https://'),
  constraint ai_radar_candidates_excerpt_check
    check (source_excerpt is null or char_length(source_excerpt) <= 5000),
  constraint ai_radar_candidates_evidence_score_check
    check (evidence_score is null or evidence_score between 0 and 25),
  constraint ai_radar_candidates_authority_score_check
    check (authority_score is null or authority_score between 0 and 20),
  constraint ai_radar_candidates_innovation_score_check
    check (innovation_score is null or innovation_score between 0 and 20),
  constraint ai_radar_candidates_alignment_score_check
    check (rasika_alignment_score is null or rasika_alignment_score between 0 and 20),
  constraint ai_radar_candidates_practical_score_check
    check (practical_relevance_score is null or practical_relevance_score between 0 and 10),
  constraint ai_radar_candidates_freshness_score_check
    check (freshness_score is null or freshness_score between 0 and 5),
  constraint ai_radar_candidates_latam_score_check
    check (latam_relevance_score is null or latam_relevance_score between 0 and 5),
  constraint ai_radar_candidates_hype_score_check
    check (hype_or_marketing_risk is null or hype_or_marketing_risk between 0 and 5),
  constraint ai_radar_candidates_confidence_check
    check (confidence is null or confidence between 0 and 1),
  constraint ai_radar_candidates_attempt_count_check
    check (attempt_count >= 0)
);

create table if not exists public.ai_radar_candidate_services (
  candidate_id uuid not null references public.ai_radar_candidates(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  match_score numeric(4, 3) not null,
  rationale text not null,
  created_at timestamptz not null default now(),
  primary key (candidate_id, service_id),
  constraint ai_radar_candidate_services_score_check
    check (match_score between 0 and 1)
);

create table if not exists public.ai_radar_candidate_posts (
  candidate_id uuid not null references public.ai_radar_candidates(id) on delete cascade,
  blog_post_id uuid not null references public.blog_posts(id) on delete cascade,
  match_score numeric(4, 3) not null,
  rationale text not null,
  created_at timestamptz not null default now(),
  primary key (candidate_id, blog_post_id),
  constraint ai_radar_candidate_posts_score_check
    check (match_score between 0 and 1)
);

create table if not exists public.ai_radar_review_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.ai_radar_candidates(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  from_status text,
  to_status text,
  notes text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_radar_review_events_action_check
    check (action in ('suggest', 'approve', 'reject', 'return', 'publish', 'archive', 'restore'))
);

create table if not exists public.ai_radar_rubric (
  criterion_key text primary key,
  criterion_name text not null,
  weight_percent smallint not null,
  operational_definition text not null,
  score_0 text,
  score_3 text,
  score_5 text,
  evidence_to_inspect text,
  decision_rule text,
  source_version text not null default '2026-07-15',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_radar_rubric_weight_check
    check (weight_percent between 0 and 100)
);

create table if not exists public.ai_radar_taxonomy (
  topic_key text primary key,
  topic_es text not null,
  topic_en text not null,
  parent_topic text,
  keywords_es text[] not null default '{}'::text[],
  keywords_en text[] not null default '{}'::text[],
  synonyms text[] not null default '{}'::text[],
  related_rasika_service text,
  related_rasika_article text,
  target_audience text,
  commercial_relevance text,
  editorial_priority text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_radar_exclusions (
  exclusion_key text primary key,
  pattern_name text not null,
  pattern_type text not null,
  description text not null,
  example_url text,
  default_action text not null,
  exception_rule text,
  rationale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_radar_benchmarks (
  benchmark_key text primary key,
  article_title text not null,
  article_url text not null unique,
  source_name text not null,
  published_at date,
  accessed_at date,
  expected_decision text not null,
  decision_reason text not null,
  innovation_score smallint,
  evidence_score smallint,
  authority_score smallint,
  rasika_alignment_score smallint,
  practical_relevance_score smallint,
  latam_relevance_score smallint,
  freshness_score smallint,
  hype_or_marketing_risk smallint,
  matched_rasika_services text[] not null default '{}'::text[],
  matched_rasika_articles text[] not null default '{}'::text[],
  claims_worth_preserving text,
  necessary_caveats text,
  suggested_editorial_angle text,
  suggested_headline text,
  source_attribution_required text,
  researcher_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_radar_benchmarks_decision_check
    check (expected_decision in ('accept', 'reject', 'ambiguous')),
  constraint ai_radar_benchmarks_scores_check
    check (
      (innovation_score is null or innovation_score between 0 and 5)
      and (evidence_score is null or evidence_score between 0 and 5)
      and (authority_score is null or authority_score between 0 and 5)
      and (rasika_alignment_score is null or rasika_alignment_score between 0 and 5)
      and (practical_relevance_score is null or practical_relevance_score between 0 and 5)
      and (latam_relevance_score is null or latam_relevance_score between 0 and 5)
      and (freshness_score is null or freshness_score between 0 and 5)
      and (hype_or_marketing_risk is null or hype_or_marketing_risk between 0 and 5)
    )
);

create index if not exists ai_radar_sources_enabled_poll_idx
  on public.ai_radar_sources (is_enabled, next_poll_at)
  where is_enabled;

create index if not exists ai_radar_runs_status_created_idx
  on public.ai_radar_runs (status, created_at desc);

create index if not exists ai_radar_admins_granted_by_idx
  on public.ai_radar_admins (granted_by);

create index if not exists ai_radar_runs_requested_by_idx
  on public.ai_radar_runs (requested_by);

create index if not exists ai_radar_candidates_source_id_idx
  on public.ai_radar_candidates (source_id);

create index if not exists ai_radar_candidates_run_id_idx
  on public.ai_radar_candidates (run_id);

create index if not exists ai_radar_candidates_status_discovered_idx
  on public.ai_radar_candidates (status, discovered_at desc);

create index if not exists ai_radar_candidates_review_queue_idx
  on public.ai_radar_candidates (status, score_total desc, source_published_at desc)
  where status in ('suggested', 'needs_review', 'approved');

create index if not exists ai_radar_candidates_next_attempt_idx
  on public.ai_radar_candidates (next_attempt_at)
  where status in ('discovered', 'failed');

create unique index if not exists ai_radar_candidates_content_hash_idx
  on public.ai_radar_candidates (content_hash)
  where content_hash is not null;

create index if not exists ai_radar_candidates_reviewed_by_idx
  on public.ai_radar_candidates (reviewed_by);

create index if not exists ai_radar_candidate_services_service_id_idx
  on public.ai_radar_candidate_services (service_id);

create index if not exists ai_radar_candidate_posts_blog_post_id_idx
  on public.ai_radar_candidate_posts (blog_post_id);

create index if not exists ai_radar_review_events_candidate_created_idx
  on public.ai_radar_review_events (candidate_id, created_at desc);

create index if not exists ai_radar_review_events_actor_id_idx
  on public.ai_radar_review_events (actor_id);

create or replace function public.set_ai_radar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ai_radar_sources_updated_at on public.ai_radar_sources;
create trigger set_ai_radar_sources_updated_at
before update on public.ai_radar_sources
for each row execute function public.set_ai_radar_updated_at();

drop trigger if exists set_ai_radar_candidates_updated_at on public.ai_radar_candidates;
create trigger set_ai_radar_candidates_updated_at
before update on public.ai_radar_candidates
for each row execute function public.set_ai_radar_updated_at();

drop trigger if exists set_ai_radar_rubric_updated_at on public.ai_radar_rubric;
create trigger set_ai_radar_rubric_updated_at
before update on public.ai_radar_rubric
for each row execute function public.set_ai_radar_updated_at();

drop trigger if exists set_ai_radar_taxonomy_updated_at on public.ai_radar_taxonomy;
create trigger set_ai_radar_taxonomy_updated_at
before update on public.ai_radar_taxonomy
for each row execute function public.set_ai_radar_updated_at();

drop trigger if exists set_ai_radar_exclusions_updated_at on public.ai_radar_exclusions;
create trigger set_ai_radar_exclusions_updated_at
before update on public.ai_radar_exclusions
for each row execute function public.set_ai_radar_updated_at();

drop trigger if exists set_ai_radar_benchmarks_updated_at on public.ai_radar_benchmarks;
create trigger set_ai_radar_benchmarks_updated_at
before update on public.ai_radar_benchmarks
for each row execute function public.set_ai_radar_updated_at();

alter table public.blog_posts
  add column if not exists slug text,
  add column if not exists excerpt text,
  add column if not exists source_name text,
  add column if not exists source_url text,
  add column if not exists source_published_at timestamptz,
  add column if not exists published_at timestamptz;

alter table public.blog_posts
  add column if not exists radar_candidate_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'blog_posts_radar_candidate_id_fkey'
      and conrelid = 'public.blog_posts'::regclass
  ) then
    alter table public.blog_posts
      add constraint blog_posts_radar_candidate_id_fkey
      foreign key (radar_candidate_id)
      references public.ai_radar_candidates(id)
      on delete restrict;
  end if;
end $$;

create unique index if not exists blog_posts_slug_idx
  on public.blog_posts (slug)
  where slug is not null;

create unique index if not exists blog_posts_radar_candidate_id_idx
  on public.blog_posts (radar_candidate_id)
  where radar_candidate_id is not null;

create index if not exists blog_posts_published_at_idx
  on public.blog_posts (published_at desc)
  where published_at is not null;

alter table public.ai_radar_admins enable row level security;
alter table public.ai_radar_sources enable row level security;
alter table public.ai_radar_runs enable row level security;
alter table public.ai_radar_candidates enable row level security;
alter table public.ai_radar_candidate_services enable row level security;
alter table public.ai_radar_candidate_posts enable row level security;
alter table public.ai_radar_review_events enable row level security;
alter table public.ai_radar_rubric enable row level security;
alter table public.ai_radar_taxonomy enable row level security;
alter table public.ai_radar_exclusions enable row level security;
alter table public.ai_radar_benchmarks enable row level security;

revoke all on table
  public.ai_radar_admins,
  public.ai_radar_sources,
  public.ai_radar_runs,
  public.ai_radar_candidates,
  public.ai_radar_candidate_services,
  public.ai_radar_candidate_posts,
  public.ai_radar_review_events,
  public.ai_radar_rubric,
  public.ai_radar_taxonomy,
  public.ai_radar_exclusions,
  public.ai_radar_benchmarks
from anon, authenticated;

grant select, insert, update, delete on table
  public.ai_radar_admins,
  public.ai_radar_sources,
  public.ai_radar_runs,
  public.ai_radar_candidates,
  public.ai_radar_candidate_services,
  public.ai_radar_candidate_posts,
  public.ai_radar_review_events,
  public.ai_radar_rubric,
  public.ai_radar_taxonomy,
  public.ai_radar_exclusions,
  public.ai_radar_benchmarks
to service_role;

revoke execute on function public.set_ai_radar_updated_at()
from public, anon, authenticated;

grant execute on function public.set_ai_radar_updated_at()
to service_role;

insert into public.ai_radar_admins (user_id, granted_by, notes)
select
  id,
  id,
  'Seeded automatically because this project had exactly one existing auth user.'
from auth.users
where (select count(*) from auth.users) = 1
on conflict (user_id) do nothing;
