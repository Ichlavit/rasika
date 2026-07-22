update public.services
set
  demo_name = 'Chroma Key con IA'
where id = '0cabec7c-39f7-497d-bdb9-97f1e3124a14';

update public.demo_catalog
set
  demo_name = 'Chroma Key con IA',
  tag_label = 'Producción híbrida',
  card_title = 'Chroma Key con IA',
  updated_at = now()
where slug = 'video-enhance-ia';
