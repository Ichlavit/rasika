update public.demo_catalog
set
  source_url = '/videos/standalone/video_enhance_result.mp4?v=ef52afa0939e',
  comparison_source_url = '/videos/standalone/video_enhance_original.mp4?v=634993a3a63d',
  thumbnail_url = '/videos/standalone/video_enhance_result.mp4?v=ef52afa0939e',
  metadata = coalesce(metadata, '{}'::jsonb) || '{
    "media_version": "20260731-web-720p",
    "duration_seconds": 19.333333,
    "frame_rate": 30,
    "frame_count": 580,
    "width": 1280,
    "height": 720,
    "preload_bytes": 5872171
  }'::jsonb
where slug = 'video-enhance-ia';
