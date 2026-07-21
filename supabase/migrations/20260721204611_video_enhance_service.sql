alter table public.demo_catalog
  add column if not exists comparison_source_url text;

alter table public.demo_catalog
  drop constraint if exists demo_catalog_media_type_check;

alter table public.demo_catalog
  add constraint demo_catalog_media_type_check
  check (media_type in ('video', 'interactive', 'video_enhance'));

insert into public.services (
  id,
  service_name,
  category,
  ai_context_description,
  pricing_tiers,
  inclusions,
  exclusions,
  public_description,
  client_example,
  industry_example,
  demo_url,
  demo_name,
  tech_specs,
  production_time_days
) values (
  '0cabec7c-39f7-497d-bdb9-97f1e3124a14',
  'Video Enhance con IA',
  'video',
  'LINEAR ASSET ("The Furniture"). AI-assisted post-production for studio-recorded chroma key footage. Replaces sets and wardrobe or PPE while preserving the approved actors, script, language and edit. Priced per total finished video minute using a volume rate.',
  '{
    "currency": "UF",
    "billing_basis": "one_time_project",
    "pricing_model": "rate_by_total_video_minutes",
    "short_1_to_5_min_uf_per_minute": 8,
    "medium_over_5_to_10_min_uf_per_minute": 6,
    "long_over_10_to_20_min_uf_per_minute": 5
  }'::jsonb,
  '[
    "Hasta dos fondos animados realistas generados con inteligencia artificial.",
    "Hasta dos sets de vestuario o elementos de protección personal (EPP).",
    "Composición, integración visual y postproducción sobre material grabado en estudio con chroma key."
  ]'::jsonb,
  '[
    "Cambios de personajes.",
    "Cambios en el guion.",
    "Cambios de idioma.",
    "Efectos especiales adicionales."
  ]'::jsonb,
  'Potencia escenas con múltiples actores grabados en estudio mediante fondos animados realistas, vestuario o EPP generados con inteligencia artificial, reduciendo costos de locación, arte y producción.',
  'Rasika Producciones',
  'Capacitación corporativa / Producción audiovisual',
  '/demos/?demo=video-enhance-ia',
  'AI Chroma: original vs. resultado',
  '{
    "material_requerido": "Video grabado en estudio con chroma key y edición aprobada",
    "formatos_entrega": ["MP4", "ProRes (a pedido)"],
    "audio": "Se conserva la pista aprobada del video maestro"
  }'::jsonb,
  '{
    "tier_corto_1_5_min": "5 días hábiles",
    "tier_medio_5_10_min": "7 a 10 días hábiles",
    "tier_largo_10_20_min": "10 a 14 días hábiles"
  }'::jsonb
)
on conflict (id) do update set
  service_name = excluded.service_name,
  category = excluded.category,
  ai_context_description = excluded.ai_context_description,
  pricing_tiers = excluded.pricing_tiers,
  inclusions = excluded.inclusions,
  exclusions = excluded.exclusions,
  public_description = excluded.public_description,
  client_example = excluded.client_example,
  industry_example = excluded.industry_example,
  demo_url = excluded.demo_url,
  demo_name = excluded.demo_name,
  tech_specs = excluded.tech_specs,
  production_time_days = excluded.production_time_days;

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
  comparison_source_url,
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
) values (
  'video-enhance-ia',
  '0cabec7c-39f7-497d-bdb9-97f1e3124a14',
  null,
  'standalone_videos',
  70,
  'video',
  'AI Chroma: original vs. resultado',
  'Video Enhance con IA',
  'Rasika Producciones',
  '2026',
  'Compara la grabación original en chroma key con el escenario de oficina generado mediante inteligencia artificial.',
  '/videos/standalone/video_enhance_result.mp4',
  '/videos/standalone/video_enhance_original.mp4',
  '/videos/standalone/video_enhance_result.mp4',
  'video_enhance',
  null,
  'Postproducción IA',
  'AI Chroma: transforma el escenario',
  'Desliza para comparar la grabación en estudio con el resultado profesional generado por IA.',
  'scan-line',
  'Comparar',
  true,
  '{
    "source": "video_enhance_launch",
    "comparison_labels": {"before": "Original", "after": "Resultado IA"},
    "audio_source": "result",
    "initial_position": 50
  }'::jsonb
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
  comparison_source_url = excluded.comparison_source_url,
  thumbnail_url = excluded.thumbnail_url,
  media_type = excluded.media_type,
  custom_width = excluded.custom_width,
  tag_label = excluded.tag_label,
  card_title = excluded.card_title,
  card_description = excluded.card_description,
  icon_name = excluded.icon_name,
  cta_label = excluded.cta_label,
  is_active = excluded.is_active,
  metadata = excluded.metadata;
