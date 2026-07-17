create table if not exists public.ai_radar_editorial_policy (
  policy_key text primary key,
  owner_name text not null,
  policy_version text not null,
  evidence_rule text not null,
  model_rule text not null,
  service_rule text not null,
  human_rule text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_radar_editorial_policy_one_active_idx
  on public.ai_radar_editorial_policy (is_active)
  where is_active;

drop trigger if exists set_ai_radar_editorial_policy_updated_at
  on public.ai_radar_editorial_policy;
create trigger set_ai_radar_editorial_policy_updated_at
before update on public.ai_radar_editorial_policy
for each row execute function public.set_ai_radar_updated_at();

alter table public.ai_radar_editorial_policy enable row level security;
revoke all on table public.ai_radar_editorial_policy from anon, authenticated;
grant select, insert, update, delete on table public.ai_radar_editorial_policy
to service_role;

insert into public.ai_radar_editorial_policy (
  policy_key,
  owner_name,
  policy_version,
  evidence_rule,
  model_rule,
  service_rule,
  human_rule,
  is_active
)
values (
  'rasika-editorial-v1',
  'Rasika Producciones',
  '1.0',
  'Las fuentes controlan los hechos. Toda cifra, resultado, autoría o conclusión sobre terceros debe estar sustentada por el artículo revisado o una fuente primaria identificable.',
  'La IA propone síntesis, relevancia y redacción. No decide la posición editorial, no completa vacíos de evidencia y debe declarar cuando solo dispone de metadatos RSS.',
  'El catálogo de servicios controla las afirmaciones sobre Rasika. Solo se pueden describir capacidades registradas en public_description o ai_context_description, respetando sus condiciones de integración.',
  'El equipo editorial de Rasika revisa, corrige, aprueba y publica. Ningún candidato se publica únicamente por decisión del modelo.',
  true
)
on conflict (policy_key) do update set
  owner_name = excluded.owner_name,
  policy_version = excluded.policy_version,
  evidence_rule = excluded.evidence_rule,
  model_rule = excluded.model_rule,
  service_rule = excluded.service_rule,
  human_rule = excluded.human_rule,
  is_active = excluded.is_active;

update public.services
set
  public_description = 'Asistente IA para cursos y LMS que responde dudas en tiempo real usando el contenido del curso. En integraciones con LMS, SCORM o xAPI, utiliza eventos de progreso y estado de evaluación para restringir ayuda durante desafíos evaluados, orientar refuerzo ante bajo desempeño y guiar al estudiante hacia contenidos o prácticas específicas.',
  ai_context_description = 'MONTHLY/YEARLY SAAS. You embody this service: CourseMentor, an AI conversational assistant for courses and LMS platforms. VERIFIED PRODUCT CAPABILITIES: 24/7 contextual tutoring grounded in authorized course content; multimodal context from available text, image analysis, and video transcripts; progress-aware guidance when the LMS, SCORM package, or xAPI integration provides progress and assessment-state events. Assessment integrity is conditional on those events and institutional configuration, so never claim universal automatic detection without telemetry. When a quiz, drag-and-drop challenge, graded activity, or test is active, CourseMentor enters assessment-safe mode: it refuses answers or hints that would bypass the challenge and can temporarily disable answer generation when configured by the institution. Outside an active assessment, progress telemetry can identify subjects where the learner underperforms, guide the learner to specific authorized course content, and generate custom practice interactions to check understanding. Safeguards, escalation criteria, privacy, and retention are configured per institution and require human oversight. Integrations vary by LMS; do not claim they are identical. Priced in CLP per user/month or user/year.'
where id = 'f2ab2a6d-2292-47e9-9517-7f9de7b545d6';

update public.ai_radar_candidates
set
  editorial_summary = 'El uso de IA en educación superior ya no es marginal. El artículo del Observatorio cita a Ruskulis et al. (2026): en una encuesta a 248 estudiantes, el 76 % declaró usar IA constantemente para tareas académicas y el 65 % prefirió ChatGPT. Los propios estudiantes asociaron la dependencia excesiva con una vulneración de la integridad académica. El reto no consiste solo en detectar fraude, sino en establecer políticas claras, alfabetización en IA y evaluaciones que preserven pensamiento crítico, autoría y aprendizaje auténtico.',
  why_it_matters = 'Un tutor IA puede apoyar el aprendizaje o, si ignora el contexto evaluativo, convertirse en una vía para resolver quizzes, actividades interactivas o pruebas sin demostrar dominio. La integridad debe formar parte de la arquitectura del asistente: qué eventos escucha, cuándo restringe ayuda, qué registra y cómo devuelve al estudiante a una práctica formativa legítima.',
  rasika_parallelism = 'En una integración de CourseMentor con LMS, SCORM o xAPI, el asistente escucha eventos de progreso y estado de evaluación. Cuando detecta que el estudiante está resolviendo un quiz, un drag-and-drop u otra actividad evaluada, activa un modo de integridad: no entrega respuestas ni pistas que permitan eludir el desafío y puede limitar temporalmente la generación de respuestas. Fuera de ese contexto, la misma telemetría permite detectar bajo desempeño, recomendar contenido específico del curso y generar interacciones de práctica para comprobar dominio antes de continuar. Estas reglas se configuran con la institución y mantienen criterios de escalamiento y revisión humana.',
  linkedin_copy = 'La pregunta ya no es si el estudiantado utiliza IA, sino cómo diseñamos sistemas que protejan el aprendizaje. Un estudio citado por el Observatorio del Instituto para el Futuro de la Educación reporta que el 76 % de su muestra usa IA constantemente para tareas académicas y que la dependencia excesiva es percibida por los propios estudiantes como una vulneración de la integridad. En un tutor virtual, la respuesta debe ser arquitectónica: reconocer el contexto evaluativo, restringir ayuda que eluda desafíos y usar la telemetría para reforzar contenidos donde existe bajo desempeño. Esa es la frontera entre responder y acompañar el aprendizaje.',
  claims_to_attribute = jsonb_build_array(
    jsonb_build_object(
      'claim', 'El 76 % de la muestra declaró usar IA constantemente para tareas académicas.',
      'source_title', '¿Cómo asegurar la integridad académica en tiempos de IA?',
      'source_url', 'https://observatorio.tec.mx/como-asegurar-la-integridad-academica-en-tiempos-de-ia/'
    ),
    jsonb_build_object(
      'claim', 'El 65 % de la muestra prefirió ChatGPT frente a otras herramientas.',
      'source_title', '¿Cómo asegurar la integridad académica en tiempos de IA?',
      'source_url', 'https://observatorio.tec.mx/como-asegurar-la-integridad-academica-en-tiempos-de-ia/'
    ),
    jsonb_build_object(
      'claim', 'El estudio incluyó una encuesta a 248 estudiantes y entrevistas no estructuradas a 28 docentes.',
      'source_title', 'An Academic Text: The Balance Between Academic Integrity and Artificial Intelligence',
      'source_url', 'https://jtl.uwindsor.ca/index.php/jtl/article/view/9538'
    )
  ),
  necessary_caveats = jsonb_build_array(
    'Los porcentajes describen la muestra del estudio y no deben generalizarse automáticamente a toda la educación superior.',
    'Las salvaguardas de CourseMentor requieren que la integración LMS, SCORM o xAPI entregue eventos de progreso y estado evaluativo, además de configuración institucional.'
  ),
  evaluation = evaluation || jsonb_build_object(
    'source_basis', 'full_article_and_primary_study_human_reviewed',
    'source_reviewed_at', now(),
    'editorial_policy_key', 'rasika-editorial-v1'
  ),
  review_notes = 'Revisión editorial humana: se incorporó la evidencia del artículo completo y del estudio primario, y se precisaron las salvaguardas de integridad de CourseMentor.',
  reviewed_at = now()
where id = '30eb8095-b84f-4f2e-9476-693b8f82ef6c';

update public.ai_radar_candidate_services
set rationale = 'CourseMentor puede usar eventos de progreso y estado evaluativo para restringir ayuda durante pruebas o desafíos, y usar la misma telemetría fuera de la evaluación para orientar refuerzo, contenido específico y práctica adicional.'
where candidate_id = '30eb8095-b84f-4f2e-9476-693b8f82ef6c'
  and service_id = 'f2ab2a6d-2292-47e9-9517-7f9de7b545d6';

update public.blog_posts
set
  excerpt = 'El reto no es solo detectar fraude, sino diseñar tutores IA que reconozcan el contexto evaluativo, protejan los desafíos formativos y refuercen el aprendizaje donde existe bajo desempeño.',
  read_time = '3 min read',
  content_html = '<p>El uso de IA en educación superior ya no es marginal. El artículo del Observatorio cita a Ruskulis et al. (2026): en una encuesta a 248 estudiantes, el 76 % declaró usar IA constantemente para tareas académicas y el 65 % prefirió ChatGPT. Los propios estudiantes asociaron la dependencia excesiva con una vulneración de la integridad académica. El reto no consiste solo en detectar fraude, sino en establecer políticas claras, alfabetización en IA y evaluaciones que preserven pensamiento crítico, autoría y aprendizaje auténtico.</p><h2>La evidencia</h2><p>El estudio combinó una encuesta a estudiantes con entrevistas a docentes para examinar cómo se usa la IA y qué tensiones produce en la escritura académica. Sus resultados apuntan a una paradoja importante: el estudiantado reconoce el riesgo ético de depender excesivamente de estas herramientas y, al mismo tiempo, las incorpora de forma habitual a sus tareas. Esto exige reglas transparentes y experiencias de evaluación que mantengan activo el esfuerzo cognitivo.</p><h2>Por qué importa</h2><p>Un tutor IA puede apoyar el aprendizaje o, si ignora el contexto evaluativo, convertirse en una vía para resolver quizzes, actividades interactivas o pruebas sin demostrar dominio. La integridad debe formar parte de la arquitectura del asistente: qué eventos escucha, cuándo restringe ayuda, qué registra y cómo devuelve al estudiante a una práctica formativa legítima.</p><h2>La mirada de Rasika</h2><p>En una integración de CourseMentor con LMS, SCORM o xAPI, el asistente escucha eventos de progreso y estado de evaluación. Cuando detecta que el estudiante está resolviendo un quiz, un drag-and-drop u otra actividad evaluada, activa un modo de integridad: no entrega respuestas ni pistas que permitan eludir el desafío y puede limitar temporalmente la generación de respuestas. Fuera de ese contexto, la misma telemetría permite detectar bajo desempeño, recomendar contenido específico del curso y generar interacciones de práctica para comprobar dominio antes de continuar. Estas reglas se configuran con la institución y mantienen criterios de escalamiento y revisión humana.</p><div class="rasika-service-bridge"><h3>Servicio relacionado</h3><ul><li><strong><a href="/lms/">CourseMentor SaaS (Asistente IA)</a></strong>: protección contextual durante evaluaciones y refuerzo personalizado a partir de eventos de progreso del curso.</li></ul><p><a href="/lms/">Conocer CourseMentor y su integración LMS</a></p></div><p><strong>Fuente editorial:</strong> <a href="https://observatorio.tec.mx/como-asegurar-la-integridad-academica-en-tiempos-de-ia/" target="_blank" rel="noopener noreferrer">¿Cómo asegurar la integridad académica en tiempos de IA?</a></p><p><strong>Estudio citado:</strong> <a href="https://jtl.uwindsor.ca/index.php/jtl/article/view/9538" target="_blank" rel="noopener noreferrer">Ruskulis et al. (2026), An Academic Text: The Balance Between Academic Integrity and Artificial Intelligence</a></p>'
where radar_candidate_id = '30eb8095-b84f-4f2e-9476-693b8f82ef6c';
