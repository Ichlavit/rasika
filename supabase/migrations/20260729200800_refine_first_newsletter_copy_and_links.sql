update public.marketing_campaigns
set
  name = 'Newsletter Rasika · OTEC #01',
  content_json = jsonb_set(
    content_json || jsonb_build_object(
      'eyebrow', 'Newsletter Rasika',
      'linkedin_url', 'https://www.linkedin.com/company/135814277'
    ),
    '{services,1,image_url}',
    to_jsonb('https://www.rasika.cl/images/newsletter/coursementor-course-chat-exact.png?v=20260729-3'::text),
    true
  ),
  updated_at = now()
where campaign_key = 'otec-insights-01';

update public.marketing_campaign_links l
set
  label = '¡Síguenos!',
  destination_url = 'https://www.linkedin.com/company/135814277'
from public.marketing_campaigns c
where l.campaign_id = c.id
  and c.campaign_key = 'otec-insights-01'
  and l.link_key = 'social-linkedin';
