update public.marketing_campaigns
set content_json = jsonb_set(
  content_json,
  '{services,1,image_url}',
  to_jsonb('https://www.rasika.cl/images/newsletter/coursementor.png'::text),
  true
)
where campaign_key = 'otec-insights-01';
