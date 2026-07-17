drop policy if exists "Allow anon insert" on public.leads;
drop policy if exists "Allow anon select" on public.leads;
drop policy if exists "Allow anon update" on public.leads;
drop policy if exists "Allow anonymous inserts to leads" on public.leads;
drop policy if exists "Allow anonymous updates to leads" on public.leads;

alter function public.set_ai_radar_updated_at() set search_path = '';
