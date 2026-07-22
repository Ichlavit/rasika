update public.services
set
  public_description = 'Nos quedamos con lo mejor de dos mundos: actores reales aportan interpretación, naturalidad y emoción, mientras la IA generativa crea locaciones, vestuario y extras que antes exigían nuevos rodajes. El resultado son escenas más ambiciosas, mayor libertad creativa y una fracción del costo de una producción equivalente.',
  ai_context_description = 'LINEAR ASSET ("The Furniture"). Nombre canónico: Chroma Key con IA Generativa. Es una producción híbrida controlada: conservamos el talento, la interpretación, naturalidad y emoción de actores reales grabados en estudio con chroma key, mientras la IA generativa crea locaciones, fondos animados realistas, vestuario, EPP, iluminación y extras. El beneficio es hacer posibles escenas más ambiciosas con mayor libertad creativa y a una fracción del costo de una producción equivalente, evitando nuevos rodajes por cada locación o vestuario. Preserva los actores, guion, idioma, edición y audio aprobados. Incluye hasta dos fondos realistas y dos sets de vestuario o EPP. Excluye cambios de personajes, guion o idioma; los efectos especiales fuera del alcance base se cotizan por separado. Tarifas por minuto terminado según volumen: 8 UF entre 1 y 5 minutos, 6 UF sobre 5 y hasta 10 minutos, y 5 UF sobre 10 y hasta 20 minutos. La demostración original versus resultado está en /demos/?demo=video-enhance-ia.',
  demo_url = '/demos/?demo=video-enhance-ia'
where id = '0cabec7c-39f7-497d-bdb9-97f1e3124a14';

update public.demo_catalog
set
  description = 'Nos quedamos con lo mejor de dos mundos: actores reales aportan interpretación, naturalidad y emoción, mientras la IA generativa crea locaciones, vestuario y extras que antes exigían nuevos rodajes. El resultado son escenas más ambiciosas, mayor libertad creativa y una fracción del costo de una producción equivalente.',
  card_description = 'Actores reales dan vida a la escena mientras la IA generativa crea locaciones, vestuario y extras a una fracción del costo.',
  metadata = coalesce(metadata, '{}'::jsonb) || '{
    "seo_location": "Santiago de Chile",
    "positioning": "produccion_hibrida_humano_ia",
    "canonical_url": "/demos/?demo=video-enhance-ia"
  }'::jsonb
where slug = 'video-enhance-ia';
