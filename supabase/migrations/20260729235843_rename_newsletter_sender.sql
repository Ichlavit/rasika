update public.marketing_campaigns
set
  from_name = 'Rasika Newsletter',
  updated_at = now()
where campaign_key = 'otec-insights-01'
  and status = 'draft';
