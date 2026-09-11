create or replace function public.create_pm_project(
  p_project_input jsonb,
  p_idempotency_key text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_request jsonb;
  existing_response jsonb;
  project_row public.pm_projects%rowtype;
  service_item jsonb;
  service_row public.services%rowtype;
  project_service_id uuid;
  v_blueprint_id uuid;
  service_count integer := 0;
  v_response_payload jsonb;
  input_organization_id uuid;
  input_contact_id uuid;
  input_planned_start date;
begin
  if p_project_input is null or jsonb_typeof(p_project_input) <> 'object' then
    raise exception 'Project input must be an object';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 160 then
    raise exception 'A valid idempotency key is required';
  end if;
  if p_actor_user_id is null or not exists (
    select 1 from public.pm_staff_profiles
    where user_id = p_actor_user_id and is_active
  ) then
    raise exception 'Active project staff access is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_idempotency_key));

  select key_row.request_payload, key_row.response_payload
  into existing_request, existing_response
  from public.pm_idempotency_keys key_row
  where key_row.idempotency_key = p_idempotency_key
    and key_row.expires_at > now();

  if existing_response is not null then
    if existing_request <> p_project_input then
      raise exception 'Idempotency key was already used with different input';
    end if;
    return existing_response;
  end if;

  input_organization_id := nullif(p_project_input->>'organization_id', '')::uuid;
  input_contact_id := nullif(p_project_input->>'primary_contact_id', '')::uuid;
  input_planned_start := nullif(p_project_input->>'planned_start', '')::date;

  if input_organization_id is null or input_contact_id is null then
    raise exception 'Organization and primary contact are required';
  end if;
  if not exists (
    select 1
    from public.organization_contacts oc
    join public.contacts c on c.id = oc.contact_id
    where oc.organization_id = input_organization_id
      and oc.contact_id = input_contact_id
      and c.lifecycle_stage = 'client'
      and c.status = 'active'
  ) then
    raise exception 'Primary contact must be an active CRM client linked to the organization';
  end if;
  if jsonb_typeof(p_project_input->'services') <> 'array'
    or jsonb_array_length(p_project_input->'services') < 1
    or jsonb_array_length(p_project_input->'services') > 20 then
    raise exception 'Select between 1 and 20 services';
  end if;

  insert into public.pm_projects (
    organization_id,
    primary_contact_id,
    quote_id,
    name,
    project_type,
    manager_user_id,
    status,
    priority,
    risk_level,
    planned_start,
    committed_completion_date,
    forecast_completion_date,
    initial_estimated_working_days,
    forecast_working_days,
    currency,
    contract_status,
    metadata,
    created_by
  ) values (
    input_organization_id,
    input_contact_id,
    nullif(p_project_input->>'quote_id', '')::uuid,
    btrim(p_project_input->>'name'),
    nullif(btrim(p_project_input->>'project_type'), ''),
    p_actor_user_id,
    coalesce(nullif(p_project_input->>'status', ''), 'planned'),
    coalesce(nullif(p_project_input->>'priority', ''), 'normal'),
    coalesce(nullif(p_project_input->>'risk_level', ''), 'low'),
    input_planned_start,
    nullif(p_project_input->>'committed_completion_date', '')::date,
    coalesce(nullif(p_project_input->>'forecast_completion_date', '')::date, nullif(p_project_input->>'committed_completion_date', '')::date),
    nullif(p_project_input->>'estimated_working_days', '')::numeric,
    nullif(p_project_input->>'estimated_working_days', '')::numeric,
    coalesce(nullif(p_project_input->>'currency', ''), 'UF'),
    coalesce(nullif(p_project_input->>'contract_status', ''), 'not_required'),
    coalesce(p_project_input->'metadata', '{}'::jsonb),
    p_actor_user_id
  )
  returning * into project_row;

  insert into public.pm_project_contacts (project_id, contact_id, role, is_primary, client_visible)
  values (project_row.id, input_contact_id, 'primary_client', true, true);

  for service_item in select value from jsonb_array_elements(p_project_input->'services')
  loop
    select * into service_row
    from public.services
    where id = nullif(service_item->>'service_id', '')::uuid;
    if not found then
      raise exception 'Unknown service in project selection';
    end if;

    service_count := service_count + 1;
    v_blueprint_id := null;
    select id into v_blueprint_id
    from public.pm_service_blueprints
    where service_id = service_row.id and status = 'active'
    order by version desc
    limit 1;

    insert into public.pm_project_services (
      project_id,
      service_id,
      quote_id,
      baseline_blueprint_id,
      quantity,
      estimated_working_days,
      estimated_effort_minutes,
      price_snapshot,
      service_snapshot
    ) values (
      project_row.id,
      service_row.id,
      nullif(service_item->>'quote_id', '')::uuid,
      v_blueprint_id,
      coalesce(nullif(service_item->>'quantity', '')::numeric, 1),
      coalesce(
        nullif(service_item->>'estimated_working_days', '')::numeric,
        (select baseline_working_days from public.pm_service_blueprints where id = v_blueprint_id)
      ),
      coalesce(
        nullif(service_item->>'estimated_effort_minutes', '')::integer,
        (select baseline_effort_minutes from public.pm_service_blueprints where id = v_blueprint_id)
      ),
      coalesce(service_row.pricing_tiers, '{}'::jsonb),
      jsonb_build_object(
        'service_name', service_row.service_name,
        'category', service_row.category,
        'production_time_days', service_row.production_time_days,
        'captured_at', now()
      )
    )
    returning id into project_service_id;

    if v_blueprint_id is not null then
      insert into public.pm_tasks (
        project_id,
        project_service_id,
        source_template_task_id,
        department_id,
        task_key,
        title,
        description,
        sort_order,
        planned_start,
        planned_end,
        forecast_start,
        forecast_end,
        planned_effort_minutes,
        assignee_user_id,
        is_milestone,
        required_inputs,
        client_visible,
        created_by
      )
      select
        project_row.id,
        project_service_id,
        template.id,
        template.department_id,
        concat(service_count, ':', template.task_key),
        template.title,
        template.description,
        (service_count * 10000) + template.sort_order,
        private.pm_add_working_days(input_planned_start, template.start_offset_working_days),
        private.pm_add_working_days(
          input_planned_start,
          template.start_offset_working_days + greatest(ceil(template.duration_working_days)::integer - 1, 0)
        ),
        private.pm_add_working_days(input_planned_start, template.start_offset_working_days),
        private.pm_add_working_days(
          input_planned_start,
          template.start_offset_working_days + greatest(ceil(template.duration_working_days)::integer - 1, 0)
        ),
        template.planned_effort_minutes,
        p_actor_user_id,
        template.is_milestone,
        template.required_inputs,
        template.client_visible,
        p_actor_user_id
      from public.pm_service_blueprint_tasks template
      where template.blueprint_id = v_blueprint_id;
    end if;
  end loop;

  update public.pm_tasks child
  set parent_task_id = parent.id
  from public.pm_service_blueprint_tasks child_template,
       public.pm_tasks parent
  where child.project_id = project_row.id
    and child.source_template_task_id = child_template.id
    and child_template.parent_template_task_id is not null
    and parent.project_id = child.project_id
    and parent.project_service_id = child.project_service_id
    and parent.source_template_task_id = child_template.parent_template_task_id;

  insert into public.pm_task_dependencies (
    predecessor_task_id,
    successor_task_id,
    dependency_type,
    lag_working_days
  )
  select
    predecessor.id,
    successor.id,
    blueprint_dependency.dependency_type,
    blueprint_dependency.lag_working_days
  from public.pm_service_blueprint_dependencies blueprint_dependency
  join public.pm_tasks predecessor
    on predecessor.project_id = project_row.id
   and predecessor.source_template_task_id = blueprint_dependency.predecessor_template_task_id
  join public.pm_tasks successor
    on successor.project_id = project_row.id
   and successor.project_service_id = predecessor.project_service_id
   and successor.source_template_task_id = blueprint_dependency.successor_template_task_id
  on conflict do nothing;

  insert into public.pm_activity_log (
    project_id,
    actor_user_id,
    actor_type,
    event_type,
    entity_type,
    entity_id,
    summary,
    metadata
  ) values (
    project_row.id,
    p_actor_user_id,
    'user',
    'project.created',
    'project',
    project_row.id::text,
    concat('Proyecto ', project_row.project_code, ' creado'),
    jsonb_build_object('service_count', service_count)
  );

  select to_jsonb(p) into v_response_payload
  from public.pm_projects p
  where p.id = project_row.id;

  v_response_payload := jsonb_build_object('project', v_response_payload, 'instantiated_services', service_count);

  insert into public.pm_idempotency_keys (
    idempotency_key,
    action_type,
    request_payload,
    response_payload,
    created_by
  ) values (
    p_idempotency_key,
    'project.create',
    p_project_input,
    v_response_payload,
    p_actor_user_id
  );

  return v_response_payload;
end;
$$;

revoke all on function public.create_pm_project(jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.create_pm_project(jsonb, text, uuid) to service_role;
