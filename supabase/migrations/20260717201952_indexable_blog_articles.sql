alter table public.blog_posts
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_blog_posts_updated_at on public.blog_posts;
create trigger set_blog_posts_updated_at
before update on public.blog_posts
for each row execute function public.set_ai_radar_updated_at();

update public.blog_posts
set
  slug = 'que-es-el-diseno-instruccional',
  excerpt = 'El diseño instruccional combina una disciplina basada en la psicología del aprendizaje con un proceso para crear experiencias que facilitan la generación de nuevos conocimientos.',
  published_at = created_at,
  updated_at = now()
where id = '8ec3b734-45c6-4444-9207-8ccad4c65493'
  and (slug is null or published_at is null or excerpt is null);

update public.blog_posts
set
  slug = 'interactividad-en-el-aprendizaje-digital',
  excerpt = 'La interactividad transforma la presentación de información en una experiencia activa que favorece un aprendizaje más efectivo, significativo y duradero.',
  published_at = created_at,
  updated_at = now()
where id = '76eac748-625e-4780-991e-d6b99e6a67da'
  and (slug is null or published_at is null or excerpt is null);

update public.blog_posts
set
  slug = 'cautivar-para-ensenar-ux-y-gamificacion',
  excerpt = 'Los principios de UX y gamificación pueden utilizarse para crear experiencias de aprendizaje digital capaces de cautivar, sostener la atención y educar.',
  published_at = created_at,
  updated_at = now()
where id = '58447a08-ea4f-417b-bf75-292ad0cd2b0f'
  and (slug is null or published_at is null or excerpt is null);

alter table public.blog_posts
  drop constraint if exists blog_posts_slug_format_check;

alter table public.blog_posts
  add constraint blog_posts_slug_format_check
  check (slug is null or slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

alter table public.blog_posts
  drop constraint if exists blog_posts_published_slug_check;

alter table public.blog_posts
  add constraint blog_posts_published_slug_check
  check (published_at is null or slug is not null);
