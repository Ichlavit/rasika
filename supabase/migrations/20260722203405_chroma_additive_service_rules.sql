update public.services
set
  ai_context_description = 'LINEAR ASSET ("The Furniture"). Nombre canónico: Chroma Key con IA Generativa. Es una postproducción aditiva para material grabado en estudio con chroma key: nunca reemplaza ni descuenta el costo del video base. Puede aplicarse sobre metraje chroma provisto por el cliente o agregarse exclusivamente a Video Presentador (Estudio) y Video Role-Playing (Estudio) cuando Rasika produce el video. Si esos videos forman parte de un paquete SCORM/HTML, primero se usa el total del bundle correspondiente y luego se suma Chroma Key con IA Generativa como línea adicional. No es compatible como adicional con Video con IA Ultra-Realista, Cápsulas de Video (IA + Boards), Motion Graphics ni Videos de Marketing. Conserva el talento, interpretación, naturalidad y emoción de actores reales, mientras la IA generativa crea locaciones, fondos animados realistas, vestuario, EPP, iluminación y extras. Preserva los actores, guion, idioma, edición y audio aprobados. Incluye hasta dos fondos realistas y dos sets de vestuario o EPP. Excluye cambios de personajes, guion o idioma; los efectos especiales fuera del alcance base se cotizan por separado. Su único descuento es la tarifa por compromiso de minutos: suma todos los minutos de metraje chroma del proyecto y aplica una sola tarifa al total, 8 UF/min entre 1 y 5 minutos, 6 UF/min sobre 5 y hasta 10 minutos, o 5 UF/min sobre 10 y hasta 20 minutos. No mezcles tarifas ni apliques descuentos adicionales. La demostración está en /demos/?demo=video-enhance-ia.',
  pricing_tiers = coalesce(pricing_tiers, '{}'::jsonb) || jsonb_build_object(
    'combination_mode', 'additive_postproduction',
    'discount_policy', 'commitment_tier_only',
    'rate_selection_basis', 'total_chroma_minutes_in_project',
    'eligible_input_modes', jsonb_build_array(
      'client_supplied_chroma_footage',
      'rasika_studio_video'
    ),
    'eligible_base_service_ids', jsonb_build_array(
      '5594e6ab-917a-487a-8a1d-dca4bf12e185',
      '994f43f1-e367-4001-b1b8-b3433754a654'
    ),
    'eligible_base_service_names', jsonb_build_array(
      'Video Presentador (Estudio)',
      'Video Role-Playing (Estudio)'
    ),
    'bundle_application', 'add_after_base_video_or_scorm_video_bundle',
    'selection_rule', 'Apply one rate to all eligible chroma minutes, then add that amount to the full base video or SCORM plus video bundle price. Use the base video service ID for standalone combinations and the bundle service ID for SCORM combinations. Do not discount the base service or the add-on.'
  )
where id = '0cabec7c-39f7-497d-bdb9-97f1e3124a14';
