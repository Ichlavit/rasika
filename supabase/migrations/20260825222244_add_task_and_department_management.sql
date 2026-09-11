alter table public.pm_tasks
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id) on delete set null;

drop index public.pm_tasks_project_key_uidx;
create unique index pm_tasks_project_key_uidx
  on public.pm_tasks (project_id, task_key)
  where task_key is not null and deleted_at is null;

create index pm_tasks_deleted_idx
  on public.pm_tasks (project_id, deleted_at, updated_at desc);

create or replace function public.delete_pm_task(
  p_project_id uuid,
  p_task_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  task_row public.pm_tasks%rowtype;
  removed_dependencies integer := 0;
  reparented_tasks integer := 0;
begin
  select task.* into task_row
  from public.pm_tasks as task
  where task.id = p_task_id
    and task.project_id = p_project_id
    and task.deleted_at is null
  for update;

  if not found then
    raise exception 'Task not found or already deleted';
  end if;
  if task_row.version <> p_expected_version then
    raise exception 'This task changed in another session. Refresh it before deleting.';
  end if;

  update public.pm_tasks
  set parent_task_id = task_row.parent_task_id
  where parent_task_id = task_row.id
    and deleted_at is null;
  get diagnostics reparented_tasks = row_count;

  delete from public.pm_task_dependencies
  where predecessor_task_id = task_row.id
     or successor_task_id = task_row.id;
  get diagnostics removed_dependencies = row_count;

  update public.pm_tasks
  set
    deleted_at = now(),
    deleted_by = p_actor_user_id,
    client_visible = false
  where id = task_row.id;

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
    task_row.project_id,
    p_actor_user_id,
    'user',
    'task.deleted',
    'task',
    task_row.id::text,
    concat('Tarea eliminada del plan: ', task_row.title),
    jsonb_build_object(
      'task_key', task_row.task_key,
      'previous_version', task_row.version,
      'department_id', task_row.department_id,
      'removed_dependencies', removed_dependencies,
      'reparented_tasks', reparented_tasks,
      'deletion_mode', 'soft_delete'
    )
  );

  return jsonb_build_object(
    'id', task_row.id,
    'title', task_row.title,
    'deleted', true,
    'removed_dependencies', removed_dependencies,
    'reparented_tasks', reparented_tasks
  );
end;
$$;

revoke all on function public.delete_pm_task(uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.delete_pm_task(uuid, uuid, integer, uuid) to service_role;

create or replace function public.manage_pm_department(
  p_action text,
  p_department_id uuid,
  p_name text,
  p_color text,
  p_replacement_department_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  department_row public.pm_departments%rowtype;
  replacement_row public.pm_departments%rowtype;
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_color text := upper(coalesce(p_color, ''));
  generated_code text;
  task_count integer := 0;
  blueprint_task_count integer := 0;
  active_department_count integer := 0;
begin
  if p_action = 'create' then
    if length(normalized_name) not between 2 and 120 then
      raise exception 'Department name must contain 2 to 120 characters';
    end if;
    if normalized_color !~ '^#[0-9A-F]{6}$' then
      raise exception 'Department color must use hexadecimal format';
    end if;
    generated_code := 'custom_' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 12);
    insert into public.pm_departments (code, name, color, sort_order)
    values (
      generated_code,
      normalized_name,
      normalized_color,
      coalesce((select max(sort_order) + 10 from public.pm_departments), 10)
    )
    returning * into department_row;

    insert into public.pm_activity_log (
      actor_user_id, actor_type, event_type, entity_type, entity_id, summary, metadata
    ) values (
      p_actor_user_id, 'user', 'department.created', 'department', department_row.id::text,
      concat('Departamento creado: ', department_row.name),
      jsonb_build_object('code', department_row.code, 'color', department_row.color)
    );
  elsif p_action = 'update' then
    select department.* into department_row
    from public.pm_departments as department
    where department.id = p_department_id and department.is_active = true
    for update;
    if not found then raise exception 'Active department not found'; end if;
    if length(normalized_name) not between 2 and 120 then
      raise exception 'Department name must contain 2 to 120 characters';
    end if;
    if normalized_color !~ '^#[0-9A-F]{6}$' then
      raise exception 'Department color must use hexadecimal format';
    end if;

    update public.pm_departments
    set name = normalized_name, color = normalized_color
    where id = department_row.id
    returning * into department_row;

    insert into public.pm_activity_log (
      actor_user_id, actor_type, event_type, entity_type, entity_id, summary, metadata
    ) values (
      p_actor_user_id, 'user', 'department.updated', 'department', department_row.id::text,
      concat('Departamento actualizado: ', department_row.name),
      jsonb_build_object('code', department_row.code, 'color', department_row.color)
    );
  elsif p_action = 'delete' then
    select department.* into department_row
    from public.pm_departments as department
    where department.id = p_department_id and department.is_active = true
    for update;
    if not found then raise exception 'Active department not found'; end if;

    select count(*) into active_department_count
    from public.pm_departments
    where is_active = true;
    if active_department_count <= 1 then
      raise exception 'The final active department cannot be deleted';
    end if;

    select count(*) into task_count
    from public.pm_tasks
    where department_id = department_row.id and deleted_at is null;
    select count(*) into blueprint_task_count
    from public.pm_service_blueprint_tasks
    where department_id = department_row.id;

    if task_count + blueprint_task_count > 0 then
      select department.* into replacement_row
      from public.pm_departments as department
      where department.id = p_replacement_department_id
        and department.id <> department_row.id
        and department.is_active = true
      for update;
      if not found then
        raise exception 'Choose an active replacement department before deleting this department';
      end if;

      insert into public.pm_activity_log (
        project_id, actor_user_id, actor_type, event_type, entity_type, entity_id, summary, metadata
      )
      select distinct
        task.project_id,
        p_actor_user_id,
        'user',
        'department.tasks_reassigned',
        'department',
        department_row.id::text,
        concat('Tareas movidas de ', department_row.name, ' a ', replacement_row.name),
        jsonb_build_object('replacement_department_id', replacement_row.id)
      from public.pm_tasks as task
      where task.department_id = department_row.id and task.deleted_at is null;

      update public.pm_tasks
      set department_id = replacement_row.id
      where department_id = department_row.id and deleted_at is null;

      update public.pm_service_blueprint_tasks
      set department_id = replacement_row.id
      where department_id = department_row.id;
    end if;

    update public.pm_departments
    set is_active = false
    where id = department_row.id
    returning * into department_row;

    insert into public.pm_activity_log (
      actor_user_id, actor_type, event_type, entity_type, entity_id, summary, metadata
    ) values (
      p_actor_user_id, 'user', 'department.deleted', 'department', department_row.id::text,
      concat('Departamento eliminado: ', department_row.name),
      jsonb_build_object(
        'deletion_mode', 'deactivated',
        'replacement_department_id', replacement_row.id,
        'reassigned_tasks', task_count,
        'reassigned_blueprint_tasks', blueprint_task_count
      )
    );
  else
    raise exception 'Unsupported department action';
  end if;

  return jsonb_build_object(
    'id', department_row.id,
    'code', department_row.code,
    'name', department_row.name,
    'color', department_row.color,
    'sort_order', department_row.sort_order,
    'is_active', department_row.is_active,
    'reassigned_tasks', task_count,
    'reassigned_blueprint_tasks', blueprint_task_count
  );
end;
$$;

revoke all on function public.manage_pm_department(text, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.manage_pm_department(text, uuid, text, text, uuid, uuid) to service_role;
