update public.services
set
  service_name = 'Chroma Key con IA Generativa',
  ai_context_description = 'LINEAR ASSET ("The Furniture"). Postproducción con IA generativa para videos grabados en estudio con chroma key. Reemplaza locaciones, vestuario, EPP e iluminación, y puede incorporar efectos especiales cotizados por separado, preservando los actores, guion, idioma, edición y audio aprobados. Se cobra por minuto total de video terminado con una tarifa única según volumen.',
  public_description = 'Transforma tus videos grabados en estudio con nuestra IA generativa. Reemplaza locaciones, vestuarios, iluminación, añade efectos especiales y más.',
  exclusions = '[
    "Cambios de personajes.",
    "Cambios en el guion.",
    "Cambios de idioma.",
    "Efectos especiales fuera del alcance base; se cotizan por separado."
  ]'::jsonb,
  demo_name = 'Chroma Key con IA Generativa: original vs. resultado'
where id = '0cabec7c-39f7-497d-bdb9-97f1e3124a14';

update public.demo_catalog
set
  demo_name = 'Chroma Key con IA Generativa: original vs. resultado',
  format_type = 'Chroma Key con IA Generativa',
  description = 'Transforma tus videos grabados en estudio con nuestra IA generativa. Reemplaza locaciones, vestuarios, iluminación, añade efectos especiales y más.',
  tag_label = 'IA generativa',
  card_title = 'Chroma Key con IA Generativa',
  card_description = 'Desliza para comparar la grabación original con la locación, vestuario e iluminación generados con IA.'
where slug = 'video-enhance-ia';
