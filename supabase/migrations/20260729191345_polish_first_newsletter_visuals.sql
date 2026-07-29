update public.marketing_campaigns
set
  content_json = jsonb_set(
    jsonb_set(
      content_json,
      '{articles,1,image_url}',
      to_jsonb('https://www.rasika.cl/images/newsletter/cautivar-engaged-learner.jpg'::text),
      true
    ),
    '{services,1,image_url}',
    to_jsonb('https://www.rasika.cl/images/newsletter/coursementor-course-chat-exact.png'::text),
    true
  ),
  updated_at = now()
where campaign_key = 'otec-insights-01';
