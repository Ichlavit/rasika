update public.marketing_campaigns c
set
  name = 'El blog de Rasika · OTEC #01',
  preview_text = 'Integridad académica, experiencias que cautivan, CourseMentor y Chroma Key con IA generativa.',
  content_queue_ids = coalesce((
    select array_agg(q.id order by case q.content_id
      when '2cb0cf42-ccd9-4740-a798-86ce84d640ba'::uuid then 1
      when '58447a08-ea4f-417b-bf75-292ad0cd2b0f'::uuid then 2
      when '0cabec7c-39f7-497d-bdb9-97f1e3124a14'::uuid then 3
      when 'f2ab2a6d-2292-47e9-9517-7f9de7b545d6'::uuid then 4
      else 5
    end)
    from public.marketing_content_queue q
    where q.content_id in (
      '2cb0cf42-ccd9-4740-a798-86ce84d640ba'::uuid,
      '58447a08-ea4f-417b-bf75-292ad0cd2b0f'::uuid,
      '0cabec7c-39f7-497d-bdb9-97f1e3124a14'::uuid,
      'f2ab2a6d-2292-47e9-9517-7f9de7b545d6'::uuid
    )
  ), '{}'::uuid[]),
  content_json = jsonb_set(
    jsonb_set(
      jsonb_set(
        c.content_json,
        '{eyebrow}',
        to_jsonb('El blog de Rasika'::text),
        true
      ),
      '{articles}',
      jsonb_build_array(
        jsonb_build_object(
          'id', '2cb0cf42-ccd9-4740-a798-86ce84d640ba',
          'title', 'Mantener la integridad académica en la era de la IA: prioridades institucionales',
          'summary', 'El desafío es diseñar tutores IA que reconozcan el contexto evaluativo, protejan los desafíos formativos y refuercen el aprendizaje.',
          'url', 'https://www.rasika.cl/blog/mantener-la-integridad-academica-en-la-era-de-la-ia-prioridades-institucionales-30eb8095/',
          'image_url', 'https://firnxsegqamdoajycpyf.supabase.co/storage/v1/object/public/ai-radar-thumbnails/30eb8095-b84f-4f2e-9476-693b8f82ef6c.png?v=2026-07-15T18%3A58%3A42.037Z',
          'link_key', 'article-integridad'
        ),
        jsonb_build_object(
          'id', '58447a08-ea4f-417b-bf75-292ad0cd2b0f',
          'title', 'Cautivar para enseñar: una vieja máxima en tiempos de UX & Gamification',
          'summary', 'Los principios de UX y gamificación ayudan a crear experiencias de aprendizaje digital capaces de cautivar, sostener la atención y educar.',
          'url', 'https://www.rasika.cl/blog/cautivar-para-ensenar-ux-y-gamificacion/',
          'image_url', 'https://www.rasika.cl/images/newsletter/cautivar-para-ensenar.jpg',
          'link_key', 'article-cautivar'
        )
      ),
      true
    ),
    '{services,1,image_url}',
    to_jsonb('https://www.rasika.cl/images/newsletter/coursementor-course-chat.png'::text),
    true
  ),
  updated_at = now()
where c.campaign_key = 'otec-insights-01';

delete from public.marketing_campaign_links l
using public.marketing_campaigns c
where l.campaign_id = c.id
  and c.campaign_key = 'otec-insights-01'
  and l.link_key = 'article-adopcion';

insert into public.marketing_campaign_links (
  campaign_id,
  link_key,
  block_type,
  label,
  destination_url,
  position
)
select
  c.id,
  values_to_insert.link_key,
  values_to_insert.block_type,
  values_to_insert.label,
  values_to_insert.destination_url,
  values_to_insert.position
from public.marketing_campaigns c
cross join (
  values
    ('article-integridad', 'article', 'Leer sobre integridad académica', 'https://www.rasika.cl/blog/mantener-la-integridad-academica-en-la-era-de-la-ia-prioridades-institucionales-30eb8095/', 1),
    ('article-cautivar', 'article', 'Leer Cautivar para enseñar', 'https://www.rasika.cl/blog/cautivar-para-ensenar-ux-y-gamificacion/', 2),
    ('service-chroma', 'service', 'Ver Chroma Key con IA', 'https://www.rasika.cl/demos/?demo=video-enhance-ia', 3),
    ('service-coursementor', 'service', 'Conocer CourseMentor', 'https://www.rasika.cl/lms/', 4),
    ('social-linkedin', 'social', 'Seguir a Rasika en LinkedIn', 'https://www.linkedin.com/company/rasika-producciones/', 5),
    ('unsubscribe', 'unsubscribe', 'Cancelar suscripción', 'https://www.rasika.cl/newsletter/unsubscribe/', 6)
) as values_to_insert(link_key, block_type, label, destination_url, position)
where c.campaign_key = 'otec-insights-01'
on conflict (campaign_id, link_key) do update set
  block_type = excluded.block_type,
  label = excluded.label,
  destination_url = excluded.destination_url,
  position = excluded.position;
