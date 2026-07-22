create table if not exists public.blog_post_translations (
  id uuid primary key default gen_random_uuid(),
  blog_post_id uuid not null references public.blog_posts(id) on delete cascade,
  locale text not null,
  title text not null,
  slug text not null,
  excerpt text not null,
  content_html text not null,
  status text not null default 'draft',
  source_title text not null,
  source_slug text not null,
  source_excerpt text not null,
  source_hash text,
  generated_by text,
  translated_at timestamptz not null default now(),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_post_translations_locale_check
    check (locale in ('en')),
  constraint blog_post_translations_status_check
    check (status in ('draft', 'published', 'archived')),
  constraint blog_post_translations_slug_format_check
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint blog_post_translations_published_check
    check (status <> 'published' or published_at is not null),
  unique (blog_post_id, locale),
  unique (locale, slug)
);

create index if not exists blog_post_translations_public_idx
  on public.blog_post_translations (locale, published_at desc)
  where status = 'published';

drop trigger if exists set_blog_post_translations_updated_at
  on public.blog_post_translations;
create trigger set_blog_post_translations_updated_at
before update on public.blog_post_translations
for each row execute function public.set_ai_radar_updated_at();

alter table public.blog_post_translations enable row level security;

revoke all on table public.blog_post_translations from public, anon, authenticated;
grant select on table public.blog_post_translations to anon, authenticated;
grant select, insert, update, delete on table public.blog_post_translations to service_role;

drop policy if exists "Published blog translations are public"
  on public.blog_post_translations;
create policy "Published blog translations are public"
on public.blog_post_translations
for select
to anon, authenticated
using (status = 'published' and published_at is not null);

alter table public.ai_radar_candidates
  add column if not exists editorial_summary_en text,
  add column if not exists why_it_matters_en text,
  add column if not exists rasika_parallelism_en text,
  add column if not exists suggested_headline_en text,
  add column if not exists linkedin_copy_en text;

comment on table public.blog_post_translations is
  'Human-reviewable localized blog content. Spanish remains in blog_posts; one English row is published atomically with its source article.';

comment on column public.blog_post_translations.source_hash is
  'Hash of source title, excerpt, and HTML used to detect stale translations.';
