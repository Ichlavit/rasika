-- Meetings remain timeline records, but they have a meeting-specific contract:
-- exactly one Calendar event, people/commitments, and one Gemini notes slot.
-- Existing task inputs are deliberately preserved for historical traceability.
with meeting_source as (
  select
    task.id,
    task.project_id,
    task.status,
    task.planned_effort_minutes,
    coalesce(task.metadata, '{}'::jsonb) as metadata,
    contact.full_name as primary_contact_name,
    contact.email as primary_contact_email
  from public.pm_tasks as task
  join public.pm_projects as project on project.id = task.project_id
  left join public.contacts as contact on contact.id = project.primary_contact_id
  where coalesce(task.metadata->>'task_type', '') = 'meeting'
     or coalesce(task.task_key, '') ~ '(^|:)weekly_meeting_'
     or coalesce(task.task_key, '') ~ '(^|:)kickoff$'
     or task.title ~* '(reuni[oó]n|kick-off)'
), normalized as (
  select
    source.id,
    source.project_id,
    (
      source.metadata - 'calendar_blocks'
      || jsonb_build_object(
        'task_type', 'meeting',
        'calendar_event', jsonb_build_object(
          'id', coalesce(nullif(source.metadata #>> '{calendar_event,id}', ''), gen_random_uuid()::text),
          'duration_minutes', case
            when coalesce(source.metadata #>> '{calendar_event,duration_minutes}', '') ~ '^\d+$'
              then greatest(15, least(1440, (source.metadata #>> '{calendar_event,duration_minutes}')::integer))
            else greatest(15, least(1440, coalesce(nullif(source.planned_effort_minutes, 0), 60)))
          end,
          'status', case source.status
            when 'completed' then 'completed'
            when 'in_progress' then 'in_progress'
            when 'cancelled' then 'cancelled'
            else 'not_started'
          end,
          'event_id', coalesce(
            nullif(source.metadata #>> '{calendar_event,event_id}', ''),
            nullif(source.metadata #>> '{calendar_blocks,0,event_id}', '')
          ),
          'event_url', coalesce(
            nullif(source.metadata #>> '{calendar_event,event_url}', ''),
            nullif(source.metadata #>> '{calendar_blocks,0,event_url}', '')
          )
        ),
        'meeting_details', jsonb_build_object(
          'attendees', case
            when jsonb_array_length(case
              when jsonb_typeof(source.metadata #> '{meeting_details,attendees}') = 'array'
                then source.metadata #> '{meeting_details,attendees}'
              else '[]'::jsonb
            end) > 0
              then source.metadata #> '{meeting_details,attendees}'
            else jsonb_build_array(jsonb_build_object(
              'id', gen_random_uuid()::text,
              'name', 'José Contreras',
              'email', 'jose.contreras@rasika.cl',
              'role', 'Rasika'
            )) || case
              when coalesce(source.primary_contact_name, source.primary_contact_email, '') <> ''
                then jsonb_build_array(jsonb_build_object(
                  'id', gen_random_uuid()::text,
                  'name', coalesce(source.primary_contact_name, ''),
                  'email', coalesce(source.primary_contact_email, ''),
                  'role', 'Cliente'
                ))
              else '[]'::jsonb
            end
          end,
          'responsible_people', case
            when jsonb_array_length(case
              when jsonb_typeof(source.metadata #> '{meeting_details,responsible_people}') = 'array'
                then source.metadata #> '{meeting_details,responsible_people}'
              else '[]'::jsonb
            end) > 0
              then source.metadata #> '{meeting_details,responsible_people}'
            else jsonb_build_array(jsonb_build_object(
              'id', gen_random_uuid()::text,
              'name', 'José Contreras',
              'email', 'jose.contreras@rasika.cl',
              'role', 'Responsable Rasika'
            ))
          end,
          'commitments', case
            when jsonb_typeof(source.metadata #> '{meeting_details,commitments}') = 'array'
              then source.metadata #> '{meeting_details,commitments}'
            else '[]'::jsonb
          end
        ),
        'gemini_notes', case
          when jsonb_typeof(source.metadata->'gemini_notes') = 'object'
            then source.metadata->'gemini_notes'
          else jsonb_build_object('status', 'pending', 'document_id', null)
        end
      )
    ) as metadata
  from meeting_source as source
), updated as (
  update public.pm_tasks as task
  set
    metadata = normalized.metadata,
    planned_end = task.planned_start,
    forecast_start = null,
    forecast_end = null,
    progress = case when task.status = 'completed' then 100 else 0 end
  from normalized
  where task.id = normalized.id
  returning task.project_id
)
insert into public.pm_activity_log (
  project_id,
  actor_type,
  event_type,
  entity_type,
  entity_id,
  summary,
  metadata
)
select
  project_id,
  'system',
  'meeting.metadata.normalized',
  'project',
  project_id,
  'Reuniones normalizadas para Calendar y Notes by Gemini',
  jsonb_build_object('meeting_count', count(*), 'calendar_contract', 'one_meeting_one_event')
from updated
group by project_id;
