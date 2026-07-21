update public.demo_catalog
set
  source_url = '/videos/standalone/video_enhance_result.mp4?v=ec0150223449',
  comparison_source_url = '/videos/standalone/video_enhance_original.mp4?v=15be1e49bd50',
  thumbnail_url = '/videos/standalone/video_enhance_result.mp4?v=ec0150223449',
  metadata = coalesce(metadata, '{}'::jsonb) || '{
    "media_version": "20260721-2",
    "duration_seconds": 19.333333,
    "frame_rate": 30,
    "frame_count": 580
  }'::jsonb
where slug = 'video-enhance-ia';
