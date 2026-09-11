-- Keep recurring client meetings attached to the phase they review so the
-- list and Gantt inherit the correct department color. Apply the same mapping
-- to the active service blueprint and to already-instantiated projects.

update public.pm_service_blueprint_tasks as task
set department_id = department.id,
    updated_at = now()
from (
  values
    ('weekly_meeting_2', 'audiovisual'),
    ('weekly_meeting_3', 'motion_graphics'),
    ('weekly_meeting_4', 'development_lms'),
    ('weekly_meeting_5', 'development_lms'),
    ('weekly_meeting_6', 'sence_coding')
) as assignment(task_key, department_code)
join public.pm_departments as department
  on department.code = assignment.department_code
where task.task_key = assignment.task_key;

update public.pm_tasks as task
set department_id = department.id,
    metadata = task.metadata || jsonb_build_object('task_type', 'meeting')
from (
  values
    ('weekly_meeting_2', 'audiovisual'),
    ('weekly_meeting_3', 'motion_graphics'),
    ('weekly_meeting_4', 'development_lms'),
    ('weekly_meeting_5', 'development_lms'),
    ('weekly_meeting_6', 'sence_coding')
) as assignment(task_key, department_code)
join public.pm_departments as department
  on department.code = assignment.department_code
where substring(task.task_key from '[^:]+$') = assignment.task_key;

update public.pm_tasks
set metadata = metadata || jsonb_build_object('task_type', 'meeting')
where substring(task_key from '[^:]+$') in ('kickoff', 'weekly_meeting_1');

insert into public.pm_activity_log (
  project_id,
  actor_type,
  event_type,
  entity_type,
  entity_id,
  summary,
  metadata
)
select distinct
  task.project_id,
  'system',
  'project.meeting_departments_calibrated',
  'project',
  task.project_id::text,
  'Reuniones asociadas a sus departamentos operativos.',
  jsonb_build_object('source', 'planner_ui_calibration')
from public.pm_tasks as task
where substring(task.task_key from '[^:]+$') in (
  'weekly_meeting_1',
  'weekly_meeting_2',
  'weekly_meeting_3',
  'weekly_meeting_4',
  'weekly_meeting_5',
  'weekly_meeting_6'
);
