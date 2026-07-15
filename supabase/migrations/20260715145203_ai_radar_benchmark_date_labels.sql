alter table public.ai_radar_benchmarks
  add column if not exists published_at_label text,
  add column if not exists accessed_at_label text;
