update public.blog_posts
set category = 'Radar de tendencias en EdTech'
where radar_candidate_id is not null;

update public.ai_radar_candidates
set rasika_parallelism = 'Rasika puede convertir estas políticas en apoyo operativo dentro del LMS mediante CourseMentor SaaS (Asistente IA): cargar lineamientos y contenidos autorizados, responder consultas del estudiante con ese contexto y acompañar actividades y evaluaciones en el momento de uso. El primer entregable sería un piloto acotado a un curso, con una base de conocimiento validada y criterios de respuesta revisados por el equipo académico.'
where id = '30eb8095-b84f-4f2e-9476-693b8f82ef6c';

update public.ai_radar_candidate_services
set rationale = 'Permite llevar lineamientos y contenidos autorizados al punto donde el estudiante consulta y aprende, dentro de su curso o LMS.'
where candidate_id = '30eb8095-b84f-4f2e-9476-693b8f82ef6c'
  and service_id = 'f2ab2a6d-2292-47e9-9517-7f9de7b545d6';

update public.blog_posts
set content_html =
  split_part(content_html, '<h2>La mirada de Rasika</h2>', 1)
  || '<h2>La mirada de Rasika</h2><p>Rasika puede convertir estas políticas en apoyo operativo dentro del LMS mediante CourseMentor SaaS (Asistente IA): cargar lineamientos y contenidos autorizados, responder consultas del estudiante con ese contexto y acompañar actividades y evaluaciones en el momento de uso. El primer entregable sería un piloto acotado a un curso, con una base de conocimiento validada y criterios de respuesta revisados por el equipo académico.</p><div class="rasika-service-bridge"><h3>Servicio relacionado</h3><ul><li><strong><a href="/lms/">CourseMentor SaaS (Asistente IA)</a></strong>: Permite llevar lineamientos y contenidos autorizados al punto donde el estudiante consulta y aprende, dentro de su curso o LMS.</li></ul><p><a href="/lms/">Conocer nuestros asistentes IA para LMS</a></p></div>'
  || '<p><strong>Fuente original:'
  || split_part(content_html, '<p><strong>Fuente original:', 2)
where radar_candidate_id = '30eb8095-b84f-4f2e-9476-693b8f82ef6c'
  and position('<h2>La mirada de Rasika</h2>' in content_html) > 0
  and position('<p><strong>Fuente original:' in content_html) > 0;
