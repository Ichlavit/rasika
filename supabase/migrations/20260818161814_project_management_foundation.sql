create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.pm_staff_profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  email text not null,
  full_name text,
  timezone text not null default 'America/Santiago',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pm_staff_profiles_email_check check (
    email = lower(btrim(email))
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

create unique index pm_staff_profiles_email_uidx
  on public.pm_staff_profiles ((lower(email)));

insert into public.pm_staff_profiles (user_id, email, full_name)
select id, lower(email), coalesce(raw_user_meta_data->>'full_name', email)
from auth.users
where lower(email) = 'jose.contreras@rasika.cl'
on conflict (user_id) do update set
  email = excluded.email,
  full_name = coalesce(public.pm_staff_profiles.full_name, excluded.full_name),
  is_active = true,
  updated_at = now();

create table public.pm_departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  color text not null default '#5EA6B0'
    check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pm_departments_code_check check (code ~ '^[a-z][a-z0-9_]{1,39}$')
);

insert into public.pm_departments (code, name, color, sort_order) values
  ('project_management', 'Gestión de proyecto', '#5EA6B0', 10),
  ('commercial_admin', 'Comercial y administración', '#D8A25E', 20),
  ('instructional_design', 'Diseño instruccional', '#8B9EE8', 30),
  ('audiovisual', 'Audiovisual', '#CF7FB4', 40),
  ('development_lms', 'Desarrollo y LMS', '#6EC89B', 50),
  ('qa_client_review', 'QA y revisión de cliente', '#E77B68', 60)
on conflict (code) do update set
  name = excluded.name,
  color = excluded.color,
  sort_order = excluded.sort_order,
  updated_at = now();

create table public.pm_project_code_counters (
  project_year integer primary key check (project_year between 2020 and 2200),
  last_value integer not null check (last_value > 0),
  updated_at timestamptz not null default now()
);

create or replace function private.next_pm_project_code()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  code_year integer := extract(year from timezone('America/Santiago', now()))::integer;
  code_number integer;
begin
  insert into public.pm_project_code_counters (project_year, last_value)
  values (code_year, 1)
  on conflict (project_year) do update set
    last_value = public.pm_project_code_counters.last_value + 1,
    updated_at = now()
  returning last_value into code_number;

  return format('RAS-%s-%s', code_year, lpad(code_number::text, 4, '0'));
end;
$$;

revoke all on function private.next_pm_project_code() from public, anon, authenticated;
grant execute on function private.next_pm_project_code() to service_role;

create table public.pm_projects (
  id uuid primary key default gen_random_uuid(),
  project_code text not null unique default private.next_pm_project_code(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  primary_contact_id uuid not null references public.contacts(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete set null,
  name text not null,
  project_type text,
  manager_user_id uuid not null references public.pm_staff_profiles(user_id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'planned', 'active', 'on_hold', 'completed', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  risk_level text not null default 'low'
    check (risk_level in ('low', 'medium', 'high', 'critical')),
  timezone text not null default 'America/Santiago',
  planned_start date,
  committed_completion_date date,
  forecast_completion_date date,
  actual_start_at timestamptz,
  completed_at timestamptz,
  initial_estimated_working_days numeric(8,2)
    check (initial_estimated_working_days is null or initial_estimated_working_days >= 0),
  forecast_working_days numeric(8,2)
    check (forecast_working_days is null or forecast_working_days >= 0),
  currency text not null default 'UF'
    check (currency in ('UF', 'CLP', 'USD')),
  contract_status text not null default 'not_required'
    check (contract_status in ('not_required', 'pending', 'sent', 'signed', 'expired')),
  drive_root_id text,
  client_visibility_config jsonb not null default '{"timeline":true,"documents":true,"internal_notes":false,"costs":false}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pm_projects_name_check check (length(btrim(name)) between 2 and 240),
  constraint pm_projects_code_check check (project_code ~ '^RAS-[0-9]{4}-[0-9]{4,}$'),
  constraint pm_projects_dates_check check (
    committed_completion_date is null
    or planned_start is null
    or committed_completion_date >= planned_start
  ),
  constraint pm_projects_client_visibility_object_check
    check (jsonb_typeof(client_visibility_config) = 'object'),
  constraint pm_projects_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index pm_projects_status_dates_idx
  on public.pm_projects (status, committed_completion_date, forecast_completion_date);
create index pm_projects_organization_idx
  on public.pm_projects (organization_id, created_at desc);
create index pm_projects_manager_idx
  on public.pm_projects (manager_user_id, status);

create table public.pm_project_contacts (
  project_id uuid not null references public.pm_projects(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  role text not null default 'collaborator',
  is_primary boolean not null default false,
  client_visible boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (project_id, contact_id)
);

create table public.pm_service_blueprints (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete restrict,
  name text not null,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  baseline_working_days numeric(8,2)
    check (baseline_working_days is null or baseline_working_days >= 0),
  baseline_effort_minutes integer
    check (baseline_effort_minutes is null or baseline_effort_minutes >= 0),
  assumptions jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, version),
  constraint pm_service_blueprints_name_check check (length(btrim(name)) between 2 and 200),
  constraint pm_service_blueprints_assumptions_object_check check (jsonb_typeof(assumptions) = 'object')
);

create unique index pm_service_blueprints_one_active_idx
  on public.pm_service_blueprints (service_id)
  where status = 'active';

create table public.pm_service_blueprint_tasks (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references public.pm_service_blueprints(id) on delete restrict,
  parent_template_task_id uuid references public.pm_service_blueprint_tasks(id) on delete restrict,
  department_id uuid not null references public.pm_departments(id) on delete restrict,
  task_key text not null,
  title text not null,
  description text,
  sort_order integer not null default 0,
  start_offset_working_days integer not null default 0 check (start_offset_working_days >= 0),
  duration_working_days numeric(7,2) not null default 1 check (duration_working_days > 0),
  planned_effort_minutes integer not null default 0 check (planned_effort_minutes >= 0),
  is_milestone boolean not null default false,
  required_inputs jsonb not null default '[]'::jsonb,
  client_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (blueprint_id, task_key),
  constraint pm_blueprint_tasks_title_check check (length(btrim(title)) between 2 and 240),
  constraint pm_blueprint_tasks_required_inputs_array_check check (jsonb_typeof(required_inputs) = 'array')
);

create index pm_service_blueprint_tasks_order_idx
  on public.pm_service_blueprint_tasks (blueprint_id, sort_order, created_at);

create table public.pm_service_blueprint_dependencies (
  blueprint_id uuid not null references public.pm_service_blueprints(id) on delete restrict,
  predecessor_template_task_id uuid not null references public.pm_service_blueprint_tasks(id) on delete restrict,
  successor_template_task_id uuid not null references public.pm_service_blueprint_tasks(id) on delete restrict,
  dependency_type text not null default 'finish_to_start'
    check (dependency_type in ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
  lag_working_days integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (predecessor_template_task_id, successor_template_task_id),
  constraint pm_blueprint_dependency_distinct_check
    check (predecessor_template_task_id <> successor_template_task_id)
);

create table public.pm_project_services (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pm_projects(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete set null,
  baseline_blueprint_id uuid references public.pm_service_blueprints(id) on delete restrict,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  estimated_working_days numeric(8,2)
    check (estimated_working_days is null or estimated_working_days >= 0),
  actual_working_days numeric(8,2)
    check (actual_working_days is null or actual_working_days >= 0),
  estimated_effort_minutes integer
    check (estimated_effort_minutes is null or estimated_effort_minutes >= 0),
  actual_effort_minutes integer
    check (actual_effort_minutes is null or actual_effort_minutes >= 0),
  price_snapshot jsonb not null default '{}'::jsonb,
  service_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, service_id),
  constraint pm_project_services_price_snapshot_object_check check (jsonb_typeof(price_snapshot) = 'object'),
  constraint pm_project_services_service_snapshot_object_check check (jsonb_typeof(service_snapshot) = 'object')
);

create index pm_project_services_service_idx
  on public.pm_project_services (service_id, created_at desc);

create table public.pm_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pm_projects(id) on delete restrict,
  project_service_id uuid references public.pm_project_services(id) on delete restrict,
  source_template_task_id uuid references public.pm_service_blueprint_tasks(id) on delete set null,
  parent_task_id uuid references public.pm_tasks(id) on delete restrict,
  department_id uuid not null references public.pm_departments(id) on delete restrict,
  task_key text,
  title text not null,
  description text,
  status text not null default 'not_started'
    check (status in ('not_started', 'ready', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled')),
  progress smallint not null default 0 check (progress between 0 and 100),
  sort_order integer not null default 0,
  planned_start date,
  planned_end date,
  forecast_start date,
  forecast_end date,
  actual_start_at timestamptz,
  completed_at timestamptz,
  planned_effort_minutes integer not null default 0 check (planned_effort_minutes >= 0),
  actual_effort_minutes integer not null default 0 check (actual_effort_minutes >= 0),
  assignee_user_id uuid references public.pm_staff_profiles(user_id) on delete restrict,
  is_milestone boolean not null default false,
  required_inputs jsonb not null default '[]'::jsonb,
  client_visible boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pm_tasks_title_check check (length(btrim(title)) between 2 and 240),
  constraint pm_tasks_planned_dates_check check (planned_end is null or planned_start is null or planned_end >= planned_start),
  constraint pm_tasks_forecast_dates_check check (forecast_end is null or forecast_start is null or forecast_end >= forecast_start),
  constraint pm_tasks_required_inputs_array_check check (jsonb_typeof(required_inputs) = 'array'),
  constraint pm_tasks_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create unique index pm_tasks_project_key_uidx
  on public.pm_tasks (project_id, task_key)
  where task_key is not null;
create index pm_tasks_timeline_idx
  on public.pm_tasks (project_id, department_id, planned_start, planned_end, sort_order);
create index pm_tasks_deviation_idx
  on public.pm_tasks (status, planned_end)
  where status not in ('completed', 'cancelled');

create table public.pm_task_dependencies (
  predecessor_task_id uuid not null references public.pm_tasks(id) on delete restrict,
  successor_task_id uuid not null references public.pm_tasks(id) on delete restrict,
  dependency_type text not null default 'finish_to_start'
    check (dependency_type in ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
  lag_working_days integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (predecessor_task_id, successor_task_id),
  constraint pm_task_dependency_distinct_check check (predecessor_task_id <> successor_task_id)
);

create table public.pm_project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pm_projects(id) on delete restrict,
  provider text not null default 'google_drive' check (provider = 'google_drive'),
  external_file_id text not null,
  external_parent_id text,
  name text not null,
  mime_type text,
  document_type text not null default 'supporting'
    check (document_type in ('quote', 'contract', 'meeting_transcript', 'brief', 'input', 'deliverable', 'supporting')),
  access_mode text not null default 'read_only'
    check (access_mode in ('read_only', 'suggest_only')),
  is_required boolean not null default false,
  client_visible boolean not null default false,
  last_revision_id text,
  metadata jsonb not null default '{}'::jsonb,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_file_id),
  constraint pm_project_documents_name_check check (length(btrim(name)) between 1 and 300),
  constraint pm_project_documents_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index pm_project_documents_project_idx
  on public.pm_project_documents (project_id, document_type, name);

create table public.pm_document_change_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pm_projects(id) on delete restrict,
  project_document_id uuid not null references public.pm_project_documents(id) on delete restrict,
  base_revision_id text not null,
  summary text not null,
  proposed_changes jsonb not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'applied', 'expired', 'failed')),
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  applied_at timestamptz,
  execution_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pm_document_change_proposals_summary_check check (length(btrim(summary)) between 3 and 1000),
  constraint pm_document_change_proposals_changes_object_check check (jsonb_typeof(proposed_changes) = 'object'),
  constraint pm_document_change_proposals_execution_object_check
    check (execution_result is null or jsonb_typeof(execution_result) = 'object')
);

create index pm_document_change_proposals_status_idx
  on public.pm_document_change_proposals (project_id, status, created_at desc);

create table public.pm_agent_action_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pm_projects(id) on delete restrict,
  action_type text not null
    check (action_type in (
      'task.create',
      'task.update',
      'task.assign',
      'calendar.event.propose',
      'calendar.event.upsert',
      'document.suggestion.propose'
    )),
  summary text not null,
  action_payload jsonb not null,
  risk_level text not null default 'medium'
    check (risk_level in ('low', 'medium', 'high')),
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'executing', 'executed', 'expired', 'failed')),
  idempotency_key text not null unique,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  executed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  execution_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pm_agent_actions_summary_check check (length(btrim(summary)) between 3 and 1000),
  constraint pm_agent_actions_payload_object_check check (jsonb_typeof(action_payload) = 'object'),
  constraint pm_agent_actions_no_destructive_name_check
    check (lower(action_type) !~ '(delete|trash|remove|destroy|permission)')
);

create index pm_agent_action_proposals_status_idx
  on public.pm_agent_action_proposals (project_id, status, created_at desc);

create table public.pm_activity_log (
  id bigint generated always as identity primary key,
  project_id uuid references public.pm_projects(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user'
    check (actor_type in ('user', 'agent', 'system', 'integration')),
  event_type text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint pm_activity_log_event_type_check check (event_type ~ '^[a-z][a-z0-9_.]{1,79}$'),
  constraint pm_activity_log_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index pm_activity_log_project_idx
  on public.pm_activity_log (project_id, occurred_at desc);

create table public.pm_idempotency_keys (
  idempotency_key text primary key,
  action_type text not null,
  request_payload jsonb not null,
  response_payload jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  constraint pm_idempotency_key_length_check check (length(idempotency_key) between 16 and 160),
  constraint pm_idempotency_request_object_check check (jsonb_typeof(request_payload) = 'object'),
  constraint pm_idempotency_response_object_check check (jsonb_typeof(response_payload) = 'object')
);

create or replace function private.pm_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  if to_jsonb(new) ? 'version' then
    new.version = old.version + 1;
  end if;
  return new;
end;
$$;

revoke all on function private.pm_set_updated_at() from public, anon, authenticated;

create or replace function private.pm_prevent_project_code_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_code is distinct from old.project_code then
    raise exception 'Project code is immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.pm_prevent_project_code_change() from public, anon, authenticated;

create or replace function private.pm_prevent_activity_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Project activity log is append-only';
end;
$$;

revoke all on function private.pm_prevent_activity_mutation() from public, anon, authenticated;

create trigger pm_staff_profiles_updated_at
before update on public.pm_staff_profiles
for each row execute function private.pm_set_updated_at();
create trigger pm_departments_updated_at
before update on public.pm_departments
for each row execute function private.pm_set_updated_at();
create trigger pm_projects_updated_at
before update on public.pm_projects
for each row execute function private.pm_set_updated_at();
create trigger pm_projects_immutable_code
before update on public.pm_projects
for each row execute function private.pm_prevent_project_code_change();
create trigger pm_service_blueprints_updated_at
before update on public.pm_service_blueprints
for each row execute function private.pm_set_updated_at();
create trigger pm_service_blueprint_tasks_updated_at
before update on public.pm_service_blueprint_tasks
for each row execute function private.pm_set_updated_at();
create trigger pm_project_services_updated_at
before update on public.pm_project_services
for each row execute function private.pm_set_updated_at();
create trigger pm_tasks_updated_at
before update on public.pm_tasks
for each row execute function private.pm_set_updated_at();
create trigger pm_project_documents_updated_at
before update on public.pm_project_documents
for each row execute function private.pm_set_updated_at();
create trigger pm_document_change_proposals_updated_at
before update on public.pm_document_change_proposals
for each row execute function private.pm_set_updated_at();
create trigger pm_agent_action_proposals_updated_at
before update on public.pm_agent_action_proposals
for each row execute function private.pm_set_updated_at();
create trigger pm_activity_log_append_only
before update or delete on public.pm_activity_log
for each row execute function private.pm_prevent_activity_mutation();

create or replace function private.pm_add_working_days(start_date date, working_days integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  result_date date := start_date;
  remaining integer := greatest(coalesce(working_days, 0), 0);
begin
  if result_date is null then
    return null;
  end if;

  while extract(isodow from result_date) in (6, 7) loop
    result_date := result_date + 1;
  end loop;

  while remaining > 0 loop
    result_date := result_date + 1;
    if extract(isodow from result_date) not in (6, 7) then
      remaining := remaining - 1;
    end if;
  end loop;

  return result_date;
end;
$$;

revoke all on function private.pm_add_working_days(date, integer) from public, anon, authenticated;

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

create view public.pm_project_service_performance
with (security_invoker = true)
as
select
  service.id as service_id,
  service.service_name,
  service.category,
  count(project_service.id) as project_instances,
  count(project_service.id) filter (where project.status = 'completed') as completed_instances,
  round(avg(project_service.estimated_working_days), 2) as average_estimated_working_days,
  round(avg(project_service.actual_working_days) filter (where project.status = 'completed'), 2) as average_actual_working_days,
  round(avg(project_service.estimated_effort_minutes) / 60.0, 2) as average_estimated_hours,
  round(avg(project_service.actual_effort_minutes) filter (where project.status = 'completed') / 60.0, 2) as average_actual_hours,
  round(
    100.0 * sum(project_service.estimated_effort_minutes) filter (where project.status = 'completed')
      / nullif(sum(project_service.actual_effort_minutes) filter (where project.status = 'completed'), 0),
    2
  ) as effort_efficiency_percent
from public.services service
left join public.pm_project_services project_service on project_service.service_id = service.id
left join public.pm_projects project on project.id = project_service.project_id
group by service.id, service.service_name, service.category;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'pm_staff_profiles',
    'pm_departments',
    'pm_project_code_counters',
    'pm_projects',
    'pm_project_contacts',
    'pm_service_blueprints',
    'pm_service_blueprint_tasks',
    'pm_service_blueprint_dependencies',
    'pm_project_services',
    'pm_tasks',
    'pm_task_dependencies',
    'pm_project_documents',
    'pm_document_change_proposals',
    'pm_agent_action_proposals',
    'pm_activity_log',
    'pm_idempotency_keys'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

revoke all on table public.pm_project_service_performance from public, anon, authenticated;
grant select on table public.pm_project_service_performance to service_role;
