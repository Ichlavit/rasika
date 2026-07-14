create extension if not exists pgcrypto with schema extensions;

create table if not exists public.demo_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  service_id uuid not null references public.services(id),
  service_content_id uuid references public.service_content(id),
  section_key text not null,
  sort_order integer not null default 100,
  category text not null,
  demo_name text not null,
  format_type text not null,
  client_name text,
  project_year text,
  description text,
  source_url text not null,
  thumbnail_url text not null,
  media_type text not null default 'video',
  custom_width text,
  tag_label text,
  card_title text not null,
  card_description text not null,
  icon_name text not null default 'play',
  cta_label text not null default 'Ver Demo',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint demo_catalog_category_check
    check (category in ('video', 'interactive')),
  constraint demo_catalog_media_type_check
    check (media_type in ('video', 'interactive')),
  constraint demo_catalog_section_key_check
    check (section_key in ('standalone_videos', 'interactive_scorm'))
);

create index if not exists demo_catalog_active_sort_idx
  on public.demo_catalog (is_active, section_key, sort_order);

create index if not exists demo_catalog_service_id_idx
  on public.demo_catalog (service_id);

create index if not exists demo_catalog_service_content_id_idx
  on public.demo_catalog (service_content_id);

create or replace function public.set_demo_catalog_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_demo_catalog_updated_at on public.demo_catalog;

create trigger set_demo_catalog_updated_at
before update on public.demo_catalog
for each row
execute function public.set_demo_catalog_updated_at();

alter table public.demo_catalog enable row level security;

drop policy if exists "Public can read active demos" on public.demo_catalog;

create policy "Public can read active demos"
on public.demo_catalog
for select
to anon, authenticated
using (is_active);

grant select on table public.demo_catalog
to anon, authenticated;

grant select, insert, update, delete on table public.demo_catalog
to service_role;

insert into public.demo_catalog (
  slug,
  service_id,
  service_content_id,
  section_key,
  sort_order,
  category,
  demo_name,
  format_type,
  client_name,
  project_year,
  description,
  source_url,
  thumbnail_url,
  media_type,
  custom_width,
  tag_label,
  card_title,
  card_description,
  icon_name,
  cta_label,
  is_active,
  metadata
) values
(
  'video-operacional-amsa',
  '083651d6-9f56-479f-9aec-36279119aeda',
  'fb8f838d-c2ac-45ae-9c34-8598ee9b0cae',
  'standalone_videos',
  10,
  'video',
  'Video operacional para operarios en faenas mineras',
  '2D Motion Graphics (Flat Design)',
  'AMSA',
  '2023',
  'Videos explicativos utilizando Flat design moderno. Incluye: Storyboard a medida, animación 2D, locución, música de fondo y subtítulos.',
  '/videos/standalone/2D_motion_graphics.mp4',
  '/videos/standalone/2D_motion_graphics.mp4',
  'video',
  null,
  'Flat Design Moderno',
  'Video Operacional AMSA',
  'Animación 2D con diseño de storyboard a medida y elementos visuales dinámicos.',
  'play',
  'Ver Demo',
  true,
  '{"source":"hardcoded_demos_page"}'::jsonb
),
(
  'capsula-transformacion-digital-estado',
  '8010eada-20de-45b1-b1c4-e618a94cd8f1',
  '60ff483c-fd62-41de-b4e1-4f48d6e23c55',
  'standalone_videos',
  20,
  'video',
  'Cápsula de video del curso Transformación Digital en el Estado',
  'Cápsulas de Video (IA + Boards)',
  'Clase Ejecutiva UC',
  '2024',
  'Secuencias de video con IA combinadas con boards animados. Incluye: Generación de video con IA, transiciones en motion graphics, boards de texto e íconos.',
  '/videos/standalone/ai_plus_boards.mp4',
  '/videos/standalone/ai_plus_boards.mp4',
  'video',
  null,
  'Cápsula de Video IA',
  'Clase Ejecutiva UC',
  'Secuencias de video con IA combinadas de forma fluida con gráficas y textos animados.',
  'play',
  'Ver Demo',
  true,
  '{"source":"hardcoded_demos_page"}'::jsonb
),
(
  'estrategia-corporativa-ejecutivos',
  '5e452688-9ad1-4857-ad71-11259886dbfa',
  '3bfed660-2a31-4443-a2ec-b2b3534518db',
  'standalone_videos',
  30,
  'video',
  'Curso Estrategia Corporativa para Ejecutivos',
  'Video con IA Ultra-Realista',
  'Clase Ejecutiva UC',
  '2024',
  'Videos en alta definición. Permite elementos de marca o adición de personajes, e incluye locución generada por IA y subtítulos opcionales.',
  '/videos/standalone/ai_ultrarealistic.mp4',
  '/videos/standalone/ai_ultrarealistic.mp4',
  'video',
  null,
  'Alta Definición IA',
  'Secuencia Clase Ejecutiva',
  'Generación de presentadores hiperrealistas mediante Inteligencia Artificial de vanguardia.',
  'play',
  'Ver Demo',
  true,
  '{"source":"hardcoded_demos_page"}'::jsonb
),
(
  'video-promocional-glencore',
  '515473fb-6e6e-434c-a4b8-c33678368c42',
  'ea40634f-8962-47ec-b998-e45c65d503eb',
  'standalone_videos',
  40,
  'video',
  'Video de nuevas tecnologías de Glencore para inversionistas',
  'Videos de Marketing de Alta Calidad',
  'Glencore',
  '2023',
  'Videos promocionales o explicativos premium. Incluye: Videos de stock en 4K de primer nivel, locutor humano profesional, licenciamiento de música y edición de alto nivel.',
  '/videos/standalone/premium_marketing_4K_stock.mp4',
  '/videos/standalone/premium_marketing_4K_stock.mp4',
  'video',
  null,
  'Producción Premium 4K',
  'Video Promocional Glencore',
  'Pieza audiovisual de alta gama con material de stock 4K y locución profesional.',
  'play',
  'Ver Demo',
  true,
  '{"source":"hardcoded_demos_page"}'::jsonb
),
(
  'cencosud-liderazgo-presentador',
  '5594e6ab-917a-487a-8a1d-dca4bf12e185',
  '006c73c7-3c18-439b-bfe6-7f7c3f4e32f5',
  'standalone_videos',
  50,
  'video',
  'Video de cierre del curso Líderes por primera vez',
  'Video Presentador (Estudio)',
  'Cencosud',
  '2023',
  'Presentador humano profesional grabado en estudio. Incluye: Tiempo de estudio, vestuario, edición de video, corrección de color, postproducción y chroma key.',
  '/videos/standalone/presenter_actor.mp4',
  '/videos/standalone/presenter_actor.mp4',
  'video',
  null,
  'Grabación en Estudio',
  'Cencosud Liderazgo',
  'Comunicación oficial y directa a través de un actor presentador profesional.',
  'play',
  'Ver Demo',
  true,
  '{"source":"hardcoded_demos_page"}'::jsonb
),
(
  'lideres-primera-vez-roleplay',
  '994f43f1-e367-4001-b1b8-b3433754a654',
  'a16266c8-e1ec-4d23-99e2-28ecec0239dc',
  'standalone_videos',
  60,
  'video',
  'Líderes por primera vez',
  'Video Role-Playing (Estudio)',
  'Cencosud',
  '2024',
  'Escenarios con múltiples actores grabados en estudio para demostrar habilidades blandas o procedimientos. Incluye: Hasta 2 actores, tiempo de estudio, edición y postproducción.',
  '/videos/standalone/roleplay_actors.mp4',
  '/videos/standalone/roleplay_actors.mp4',
  'video',
  null,
  'Role-Playing Estudio',
  'Líderes por primera vez',
  'Entrenamiento de habilidades blandas usando múltiples actores y escenarios reales.',
  'play',
  'Ver Demo',
  true,
  '{"source":"hardcoded_demos_page"}'::jsonb
),
(
  'curso-transformacion-digital-rise',
  '4fb10ea3-8293-4890-9120-cd9984a9f2ba',
  '53c86869-8df4-4dfb-ad6b-38397f68b5fe',
  'interactive_scorm',
  110,
  'interactive',
  'Curso de Transformación Digital en el Estado',
  'SCORM/HTML en Rise',
  'Genérico',
  '2024',
  'Módulo responsivo de navegación libre con diseño modular.',
  '/courses/rise_template_SCORM/index.html',
  '/videos/glimpses/tde_scorm.mp4',
  'interactive',
  null,
  'Articulate Rise',
  'SCORM/HTML en Rise',
  'Módulo responsivo de navegación ágil y diseño fluido.',
  'mouse-pointer-2',
  'Ver Demo',
  true,
  '{"source":"hardcoded_demos_page"}'::jsonb
),
(
  'gobierno-datos-codelco',
  '8128db5d-c236-4f69-a15e-8b03a7d1358e',
  '46904d02-693d-4699-adb5-529cde35c442',
  'interactive_scorm',
  120,
  'interactive',
  'Gobierno de Datos en Codelco',
  'SCORM/HTML personalizado',
  'Codelco',
  '2023',
  'Experiencia gamificada a la medida para Codelco.',
  '/courses/custom_SCORM/index.html',
  '/videos/glimpses/codelco_scorm.mp4',
  'interactive',
  '1024px',
  'Desarrollo Custom',
  'SCORM/HTML personalizado',
  'Experiencia interactiva programada a medida con elementos de gamificación.',
  'mouse-pointer-2',
  'Ver Demo',
  true,
  '{"source":"hardcoded_demos_page"}'::jsonb
),
(
  'simulador-software-erp',
  'd67ed392-c635-419f-b35a-149babb2a4d2',
  '1bb3a4e6-a962-4a57-b885-d19bd3b2e6db',
  'interactive_scorm',
  130,
  'interactive',
  'Simulador de software de una plataforma ERP.',
  'Simulación de Software (HTML/SCORM)',
  'Tech',
  '2024',
  'Práctica en entornos seguros simulando software real.',
  '/courses/software_simulator.html',
  '/videos/glimpses/software_simulator.mp4',
  'interactive',
  '1024px',
  'Simulación Guiada',
  'Simulador de Software',
  'Práctica en entornos seguros con feedback inmediato emulando sistemas reales.',
  'monitor-play',
  'Ver Demo',
  true,
  '{"source":"hardcoded_demos_page"}'::jsonb
)
on conflict (slug) do update set
  service_id = excluded.service_id,
  service_content_id = excluded.service_content_id,
  section_key = excluded.section_key,
  sort_order = excluded.sort_order,
  category = excluded.category,
  demo_name = excluded.demo_name,
  format_type = excluded.format_type,
  client_name = excluded.client_name,
  project_year = excluded.project_year,
  description = excluded.description,
  source_url = excluded.source_url,
  thumbnail_url = excluded.thumbnail_url,
  media_type = excluded.media_type,
  custom_width = excluded.custom_width,
  tag_label = excluded.tag_label,
  card_title = excluded.card_title,
  card_description = excluded.card_description,
  icon_name = excluded.icon_name,
  cta_label = excluded.cta_label,
  is_active = excluded.is_active,
  metadata = public.demo_catalog.metadata || excluded.metadata,
  updated_at = now();
