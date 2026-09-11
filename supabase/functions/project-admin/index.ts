import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createCalendarEvent,
  getCalendarEvent,
  listCalendarEvents,
  listProjectDriveTree,
  provisionDriveConnectionTest,
  type DriveItem,
} from "../_shared/google-project-control.ts";

type JsonRow = Record<string, unknown>;
type AuthUser = { id: string; email?: string };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_STATUSES = new Set(["draft", "planned", "active", "on_hold", "completed", "cancelled"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const CURRENCIES = new Set(["UF", "CLP", "USD"]);
const CONTRACT_STATUSES = new Set(["not_required", "pending", "sent", "signed", "expired"]);
const TASK_STATUSES = new Set(["not_started", "ready", "in_progress", "blocked", "in_review", "completed", "cancelled"]);
const CALENDAR_BLOCK_STATUSES = new Set(["not_started", "in_progress", "completed"]);
const MEETING_EVENT_STATUSES = new Set(["not_started", "in_progress", "completed", "cancelled"]);

function cleanText(value: unknown, maxLength = 500) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanMultilineText(value: unknown, maxLength = 5000) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

function cleanStringArray(value: unknown, maxItems = 100, maxItemLength = 300) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, maxItems).map((item) => cleanText(item, maxItemLength)).filter(Boolean))];
}

function cleanUuidArray(value: unknown, maxItems = 100) {
  return cleanStringArray(value, maxItems, 36).filter((item) => UUID_REGEX.test(item));
}

function cleanRequiredInputs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    if (typeof item === "string") {
      const label = cleanText(item, 300);
      return label ? [{ id: crypto.randomUUID(), label, completed: false }] : [];
    }
    const input = cleanObject(item, 8);
    const label = cleanText(input.label || input.name || input.type, 300);
    if (!label) return [];
    return [{
      id: cleanText(input.id, 80) || crypto.randomUUID(),
      label,
      completed: input.completed === true,
    }];
  });
}

function cleanHttpsUrl(value: unknown) {
  const text = cleanText(value, 1000);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanCalendarBlocks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((item) => {
    const input = cleanObject(item, 10);
    const durationHours = Number(input.duration_hours) === 4 ? 4 : 2;
    const status = cleanText(input.status, 30);
    return [{
      id: cleanText(input.id, 80) || crypto.randomUUID(),
      duration_hours: durationHours,
      status: CALENDAR_BLOCK_STATUSES.has(status) ? status : "not_started",
      title: cleanText(input.title, 240) || `Bloque de trabajo · ${durationHours} h`,
      event_id: cleanText(input.event_id, 300) || null,
      calendar_id: cleanText(input.calendar_id, 500) || null,
      event_url: cleanHttpsUrl(input.event_url),
      starts_at: cleanLocalDateTime(input.starts_at),
    }];
  });
}

function cleanMeetingPeople(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    const input = cleanObject(item, 8);
    const name = cleanText(input.name, 200);
    const email = cleanText(input.email, 320).toLowerCase();
    const role = cleanText(input.role, 160);
    if (!name && !email) return [];
    return [{
      id: cleanText(input.id, 80) || crypto.randomUUID(),
      name,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
      role,
    }];
  });
}

function cleanMeetingCommitments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    const input = cleanObject(item, 10);
    const title = cleanText(input.title || input.label, 500);
    if (!title) return [];
    const status = cleanText(input.status, 30);
    return [{
      id: cleanText(input.id, 80) || crypto.randomUUID(),
      title,
      owner: cleanText(input.owner, 240),
      due_date: cleanDate(input.due_date),
      status: status === "completed" ? "completed" : "pending",
    }];
  });
}

function cleanMeetingDetails(value: unknown) {
  const input = cleanObject(value, 10);
  return {
    attendees: cleanMeetingPeople(input.attendees),
    responsible_people: cleanMeetingPeople(input.responsible_people),
    commitments: cleanMeetingCommitments(input.commitments),
  };
}

function cleanMeetingEvent(value: unknown, fallbackDurationMinutes = 60, fallbackStatus = "not_started") {
  const input = cleanObject(value, 12);
  const status = cleanText(input.status, 30);
  return {
    id: cleanText(input.id, 80) || crypto.randomUUID(),
    duration_minutes: Math.round(cleanNumber(input.duration_minutes, 15, 1440) ?? fallbackDurationMinutes),
    status: MEETING_EVENT_STATUSES.has(status)
      ? status
      : (MEETING_EVENT_STATUSES.has(fallbackStatus) ? fallbackStatus : "not_started"),
    event_id: cleanText(input.event_id, 300) || null,
    calendar_id: cleanText(input.calendar_id, 500) || null,
    event_url: cleanHttpsUrl(input.event_url),
    starts_at: cleanLocalDateTime(input.starts_at),
    conference_url: cleanHttpsUrl(input.conference_url),
  };
}

function isMeetingRecord(value: JsonRow) {
  const metadata = cleanObject(value.metadata, 100);
  return cleanText(metadata.task_type, 30) === "meeting" ||
    /(^|:)weekly_meeting_|(^|:)kickoff$/.test(cleanText(value.task_key, 300)) ||
    /reuni[oó]n|kick-off/i.test(cleanText(value.title, 240));
}

function createOpaqueShareToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cleanNumber(value: unknown, min = 0, max = 1000000) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function cleanDate(value: unknown) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanLocalDateTime(value: unknown) {
  const text = cleanText(value, 19);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text) ? text.slice(0, 16) : null;
}

function cleanObject(value: unknown, maxKeys = 30): JsonRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as JsonRow).slice(0, maxKeys));
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === "https://www.rasika.cl" ||
    origin === "https://rasika.cl" ||
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://www.rasika.cl",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function restRequest(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
  init: RequestInit = {},
) {
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(init.headers || {}),
    },
  });
}

async function restJson(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
): Promise<JsonRow[]> {
  const response = await restRequest(supabaseUrl, serviceRoleKey, path);
  if (!response.ok) throw new Error(`Database request failed (${response.status})`);
  const value = await response.json();
  return Array.isArray(value) ? value : value ? [value] : [];
}

async function requireProjectStaff(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Response("Missing authorization", { status: 401 });
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!userResponse.ok) throw new Response("Invalid or expired session", { status: 401 });
  const user = (await userResponse.json()) as AuthUser;
  if (!UUID_REGEX.test(user.id || "")) throw new Response("Invalid user", { status: 401 });

  const staff = await restJson(
    supabaseUrl,
    serviceRoleKey,
    `pm_staff_profiles?user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=user_id,email,full_name,timezone&limit=1`,
  );
  if (staff.length !== 1) throw new Response("Project staff access required", { status: 403 });
  return { user, profile: staff[0] };
}

async function getBootstrap(supabaseUrl: string, serviceRoleKey: string) {
  const [projects, services, departments, blueprints, contacts, relationships, organizations, performance, departmentTasks, blueprintDepartmentTasks] = await Promise.all([
    restJson(
      supabaseUrl,
      serviceRoleKey,
      "pm_projects?select=id,project_code,name,status,priority,risk_level,planned_start,committed_completion_date,forecast_completion_date,initial_estimated_working_days,updated_at,organization:organizations!pm_projects_organization_id_fkey(id,legal_name,display_name),primary_contact:contacts!pm_projects_primary_contact_id_fkey(id,full_name,email),project_services:pm_project_services!pm_project_services_project_id_fkey(id,service_id,estimated_working_days,estimated_effort_minutes,actual_working_days,actual_effort_minutes,service_snapshot)&order=updated_at.desc&limit=200",
    ),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      "services?select=id,service_name,category,public_description,pricing_tiers,production_time_days&order=service_name.asc",
    ),
    restJson(supabaseUrl, serviceRoleKey, "pm_departments?is_active=eq.true&select=id,code,name,color,sort_order&order=sort_order.asc"),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      "pm_service_blueprints?select=id,service_id,name,version,status,baseline_working_days,baseline_effort_minutes,updated_at&order=service_id.asc,version.desc",
    ),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      "contacts?lifecycle_stage=eq.client&status=eq.active&select=id,full_name,email,company_name&order=full_name.asc&limit=1000",
    ),
    restJson(supabaseUrl, serviceRoleKey, "organization_contacts?select=organization_id,contact_id,relationship_type,is_primary&limit=5000"),
    restJson(supabaseUrl, serviceRoleKey, "organizations?select=id,legal_name,display_name,status&order=display_name.asc.nullslast,legal_name.asc&limit=1000"),
    restJson(supabaseUrl, serviceRoleKey, "pm_project_service_performance?select=*&order=project_instances.desc,service_name.asc"),
    restJson(supabaseUrl, serviceRoleKey, "pm_tasks?deleted_at=is.null&select=id,department_id&limit=100000"),
    restJson(supabaseUrl, serviceRoleKey, "pm_service_blueprint_tasks?select=id,department_id&limit=100000"),
  ]);

  const clientContactIds = new Set(contacts.map((contact) => String(contact.id)));
  const existingProjectOrganizationIds = new Set(projects.map((project) => {
    const organization = project.organization as JsonRow | null;
    return String(organization?.id || "");
  }).filter(Boolean));
  const clientOrganizationIds = new Set(
    relationships
      .filter((relationship) => clientContactIds.has(String(relationship.contact_id)))
      .map((relationship) => String(relationship.organization_id)),
  );
  const clientOrganizations = organizations.filter((organization) => (
    clientOrganizationIds.has(String(organization.id)) || existingProjectOrganizationIds.has(String(organization.id))
  ));
  const contactsWithOrganizations = contacts.map((contact) => ({
    ...contact,
    organization_ids: relationships
      .filter((relationship) => String(relationship.contact_id) === String(contact.id))
      .map((relationship) => String(relationship.organization_id)),
  }));

  const activeProjects = projects.filter((project) => ["planned", "active", "on_hold"].includes(String(project.status)));
  const overdueProjects = activeProjects.filter((project) => {
    const date = cleanDate(project.committed_completion_date);
    return date && date < new Date().toISOString().slice(0, 10);
  });
  const departmentsWithUsage = departments.map((department) => ({
    ...department,
    task_count: departmentTasks.filter((task) => String(task.department_id) === String(department.id)).length,
    blueprint_task_count: blueprintDepartmentTasks.filter((task) => String(task.department_id) === String(department.id)).length,
  }));

  return {
    projects,
    services,
    departments: departmentsWithUsage,
    blueprints,
    clients: { organizations: clientOrganizations, contacts: contactsWithOrganizations },
    service_performance: performance,
    metrics: {
      total_projects: projects.length,
      active_projects: activeProjects.length,
      overdue_projects: overdueProjects.length,
      services_with_active_blueprints: new Set(
        blueprints.filter((blueprint) => blueprint.status === "active").map((blueprint) => String(blueprint.service_id)),
      ).size,
    },
  };
}

async function getProject(projectId: string, supabaseUrl: string, serviceRoleKey: string) {
  if (!UUID_REGEX.test(projectId)) throw new Response("Invalid project ID", { status: 400 });
  const encodedId = encodeURIComponent(projectId);
  const [project, tasks, services, documents, activity] = await Promise.all([
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_projects?id=eq.${encodedId}&select=*,organization:organizations!pm_projects_organization_id_fkey(id,legal_name,display_name),primary_contact:contacts!pm_projects_primary_contact_id_fkey(id,full_name,email)&limit=1`,
    ),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_tasks?project_id=eq.${encodedId}&deleted_at=is.null&select=id,project_id,project_service_id,parent_task_id,department_id,task_key,title,description,status,progress,sort_order,planned_start,planned_end,forecast_start,forecast_end,planned_effort_minutes,actual_effort_minutes,assignee_user_id,is_milestone,required_inputs,client_visible,metadata,version&order=sort_order.asc,planned_start.asc`,
    ),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_project_services?project_id=eq.${encodedId}&select=id,service_id,quantity,estimated_working_days,actual_working_days,estimated_effort_minutes,actual_effort_minutes,price_snapshot,service_snapshot,baseline_blueprint_id,service:services!pm_project_services_service_id_fkey(id,service_name,category)&order=created_at.asc`,
    ),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_project_documents?project_id=eq.${encodedId}&select=id,name,mime_type,document_type,access_mode,is_required,client_visible,last_revision_id,indexed_at,external_file_id,external_parent_id,metadata,updated_at&order=document_type.asc,name.asc`,
    ),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_activity_log?project_id=eq.${encodedId}&select=id,actor_type,event_type,entity_type,entity_id,summary,metadata,occurred_at&order=occurred_at.desc&limit=100`,
    ),
  ]);
  if (!project.length) throw new Response("Project not found", { status: 404 });
  const taskIds = tasks.map((task) => String(task.id)).filter((id) => UUID_REGEX.test(id));
  const dependencies = taskIds.length
    ? await restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_task_dependencies?successor_task_id=in.(${taskIds.join(",")})&select=predecessor_task_id,successor_task_id,dependency_type,lag_working_days`,
    )
    : [];
  const visibleDocuments = documents.filter((document) => cleanObject(document.metadata, 100).drive_present !== false);
  return { project: project[0], tasks, services, documents: visibleDocuments, activity, dependencies };
}

async function createProjectShareLink(
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const projectId = cleanText(body.project_id, 36);
  if (!UUID_REGEX.test(projectId)) throw new Response("Valid project ID is required", { status: 400 });
  const projectRows = await restJson(
    supabaseUrl,
    serviceRoleKey,
    `pm_projects?id=eq.${encodeURIComponent(projectId)}&select=id,project_code,name&limit=1`,
  );
  if (!projectRows.length) throw new Response("Project not found", { status: 404 });

  const revokedAt = new Date().toISOString();
  const revokeResponse = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `pm_project_share_links?project_id=eq.${encodeURIComponent(projectId)}&revoked_at=is.null`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ revoked_at: revokedAt }),
    },
  );
  if (!revokeResponse.ok) throw new Error(`Unable to rotate existing share links (${revokeResponse.status})`);

  const token = createOpaqueShareToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
  const insertResponse = await restRequest(supabaseUrl, serviceRoleKey, "pm_project_share_links?select=id,expires_at,created_at", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      project_id: projectId,
      token_hash: tokenHash,
      token_hint: token.slice(-8),
      label: "Vista cliente · Cronograma",
      created_by: user.id,
      expires_at: expiresAt,
    }),
  });
  const createdRows = await insertResponse.json().catch(() => []);
  if (!insertResponse.ok || !Array.isArray(createdRows) || !createdRows.length) {
    throw new Error(`Unable to create share link (${insertResponse.status})`);
  }

  await restRequest(supabaseUrl, serviceRoleKey, "pm_activity_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      actor_user_id: user.id,
      actor_type: "user",
      event_type: "project.share_link.created",
      entity_type: "project",
      entity_id: projectId,
      summary: `Vista cliente creada para ${cleanText(projectRows[0].project_code, 40)}`,
      metadata: { share_link_id: createdRows[0].id, expires_at: createdRows[0].expires_at, scope: "client_gantt" },
    }),
  });

  return { share_link: { ...createdRows[0], token } };
}

async function revokeProjectShareLink(
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const projectId = cleanText(body.project_id, 36);
  const shareLinkId = cleanText(body.share_link_id, 36);
  if (!UUID_REGEX.test(projectId) || !UUID_REGEX.test(shareLinkId)) {
    throw new Response("Valid project and share link IDs are required", { status: 400 });
  }
  const response = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `pm_project_share_links?id=eq.${encodeURIComponent(shareLinkId)}&project_id=eq.${encodeURIComponent(projectId)}&revoked_at=is.null&select=id`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    },
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows) || !rows.length) throw new Response("Active share link not found", { status: 404 });
  await restRequest(supabaseUrl, serviceRoleKey, "pm_activity_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      actor_user_id: user.id,
      actor_type: "user",
      event_type: "project.share_link.revoked",
      entity_type: "project",
      entity_id: projectId,
      summary: "Vista cliente revocada",
      metadata: { share_link_id: shareLinkId },
    }),
  });
  return { revoked: true };
}

async function getSharedProject(tokenValue: unknown, supabaseUrl: string, serviceRoleKey: string) {
  const token = cleanText(tokenValue, 100);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Response("Shared view not found", { status: 404 });
  const tokenHash = await sha256Hex(token);
  const linkRows = await restJson(
    supabaseUrl,
    serviceRoleKey,
    `pm_project_share_links?token_hash=eq.${tokenHash}&select=id,project_id,expires_at,revoked_at&limit=1`,
  );
  const link = linkRows[0];
  if (!link || link.revoked_at || (link.expires_at && new Date(String(link.expires_at)).getTime() <= Date.now())) {
    throw new Response("Shared view not found", { status: 404 });
  }
  const projectId = cleanText(link.project_id, 36);
  const encodedProjectId = encodeURIComponent(projectId);
  const [projectRows, taskRows, departmentRows] = await Promise.all([
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_projects?id=eq.${encodedProjectId}&select=project_code,name,status,planned_start,committed_completion_date,client_visibility_config,organization:organizations!pm_projects_organization_id_fkey(display_name,legal_name)&limit=1`,
    ),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_tasks?project_id=eq.${encodedProjectId}&deleted_at=is.null&client_visible=eq.true&select=id,department_id,task_key,title,status,progress,planned_start,planned_end,forecast_start,forecast_end,is_milestone,metadata,sort_order&order=sort_order.asc,planned_start.asc`,
    ),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      "pm_departments?is_active=eq.true&select=id,name,color,sort_order&order=sort_order.asc",
    ),
  ]);
  const project = projectRows[0];
  if (!project || cleanObject(project.client_visibility_config, 20).timeline === false) {
    throw new Response("Shared view not found", { status: 404 });
  }
  const organization = cleanObject(project.organization, 10);
  const tasks = taskRows.map((task) => ({
    id: task.id,
    department_id: task.department_id,
    title: task.title,
    status: task.status,
    progress: task.progress,
    planned_start: task.forecast_start || task.planned_start,
    planned_end: task.forecast_end || task.planned_end || task.forecast_start || task.planned_start,
    activity_type: isMeetingRecord(task) ? "meeting" : task.is_milestone === true ? "milestone" : "task",
  }));
  const departmentIds = new Set(tasks.map((task) => String(task.department_id)));

  await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `pm_project_share_links?id=eq.${encodeURIComponent(String(link.id))}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ last_accessed_at: new Date().toISOString() }),
    },
  );

  return {
    project: {
      project_code: project.project_code,
      name: project.name,
      status: project.status,
      planned_start: project.planned_start,
      committed_completion_date: project.committed_completion_date,
      client_name: organization.display_name || organization.legal_name || "Cliente",
    },
    departments: departmentRows.filter((department) => departmentIds.has(String(department.id))),
    tasks,
    share: { expires_at: link.expires_at, read_only: true },
  };
}

function sanitizeProjectInput(value: unknown) {
  const input = cleanObject(value);
  const services = Array.isArray(input.services)
    ? input.services.slice(0, 20).map((item) => {
      const service = cleanObject(item, 8);
      return {
        service_id: cleanText(service.service_id, 36),
        quote_id: cleanText(service.quote_id, 36) || null,
        quantity: cleanNumber(service.quantity, 0.01, 10000) ?? 1,
        estimated_working_days: cleanNumber(service.estimated_working_days, 0, 10000),
        estimated_effort_minutes: cleanNumber(service.estimated_effort_minutes, 0, 10000000),
      };
    })
    : [];
  const status = cleanText(input.status, 20);
  const priority = cleanText(input.priority, 20);
  const riskLevel = cleanText(input.risk_level, 20);
  const currency = cleanText(input.currency, 3).toUpperCase();
  const contractStatus = cleanText(input.contract_status, 30);
  return {
    name: cleanText(input.name, 240),
    organization_id: cleanText(input.organization_id, 36),
    primary_contact_id: cleanText(input.primary_contact_id, 36),
    quote_id: cleanText(input.quote_id, 36) || null,
    project_type: cleanText(input.project_type, 120) || null,
    status: PROJECT_STATUSES.has(status) ? status : "planned",
    priority: PRIORITIES.has(priority) ? priority : "normal",
    risk_level: RISK_LEVELS.has(riskLevel) ? riskLevel : "low",
    planned_start: cleanDate(input.planned_start),
    committed_completion_date: cleanDate(input.committed_completion_date),
    forecast_completion_date: cleanDate(input.forecast_completion_date),
    estimated_working_days: cleanNumber(input.estimated_working_days, 0, 10000),
    currency: CURRENCIES.has(currency) ? currency : "UF",
    contract_status: CONTRACT_STATUSES.has(contractStatus) ? contractStatus : "not_required",
    metadata: cleanObject(input.metadata),
    services,
  };
}

async function createProject(
  request: Request,
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const project = sanitizeProjectInput(body.project);
  if (project.name.length < 2) throw new Response("Project name is required", { status: 400 });
  if (!UUID_REGEX.test(project.organization_id) || !UUID_REGEX.test(project.primary_contact_id)) {
    throw new Response("A valid CRM client and contact are required", { status: 400 });
  }
  if (!project.services.length || project.services.some((service) => !UUID_REGEX.test(service.service_id))) {
    throw new Response("At least one valid service is required", { status: 400 });
  }
  if (project.planned_start && project.committed_completion_date && project.committed_completion_date < project.planned_start) {
    throw new Response("Completion date cannot be before project start", { status: 400 });
  }

  const idempotencyKey = cleanText(body.idempotency_key || request.headers.get("Idempotency-Key"), 160);
  if (idempotencyKey.length < 16) throw new Response("Idempotency key is required", { status: 400 });
  const response = await restRequest(supabaseUrl, serviceRoleKey, "rpc/create_pm_project", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      p_project_input: project,
      p_idempotency_key: idempotencyKey,
      p_actor_user_id: user.id,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = cleanText((result as JsonRow).message || (result as JsonRow).error, 500) || `Unable to create project (${response.status})`;
    throw new Response(message, { status: response.status >= 400 && response.status < 500 ? 400 : 500 });
  }
  return result;
}

async function updateTask(
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const projectId = cleanText(body.project_id, 36);
  const taskId = cleanText(body.task_id, 36);
  const requestedVersion = cleanNumber(body.version, 1, 1000000);
  if (!UUID_REGEX.test(projectId) || !UUID_REGEX.test(taskId) || !Number.isInteger(requestedVersion)) {
    throw new Response("Valid project, task, and version are required", { status: 400 });
  }

  const existingRows = await restJson(
    supabaseUrl,
    serviceRoleKey,
    `pm_tasks?id=eq.${encodeURIComponent(taskId)}&project_id=eq.${encodeURIComponent(projectId)}&deleted_at=is.null&select=id,project_id,task_key,title,department_id,status,progress,planned_start,planned_end,forecast_start,forecast_end,planned_effort_minutes,actual_effort_minutes,description,required_inputs,client_visible,metadata,version&limit=1`,
  );
  if (!existingRows.length) throw new Response("Task not found", { status: 404 });
  const existing = existingRows[0];
  if (Number(existing.version) !== requestedVersion) {
    throw new Response("This task changed in another session. Refresh it before saving.", { status: 409 });
  }

  const input = cleanObject(body.task, 30);
  const existingMetadata = cleanObject(existing.metadata, 100);
  const meeting = isMeetingRecord(existing);
  const title = cleanText(input.title ?? existing.title, 240);
  const departmentId = cleanText(input.department_id ?? existing.department_id, 36);
  let status = cleanText(input.status ?? existing.status, 30);
  let progress = Math.round(cleanNumber(input.progress ?? existing.progress, 0, 100) ?? 0);
  let plannedEffortMinutes = Math.round(cleanNumber(input.planned_effort_minutes ?? existing.planned_effort_minutes, 0, 10000000) ?? 0);
  const actualEffortMinutes = Math.round(cleanNumber(input.actual_effort_minutes ?? existing.actual_effort_minutes, 0, 10000000) ?? 0);
  const plannedStart = Object.hasOwn(input, "planned_start") ? cleanDate(input.planned_start) : cleanDate(existing.planned_start);
  let plannedEnd = Object.hasOwn(input, "planned_end") ? cleanDate(input.planned_end) : cleanDate(existing.planned_end);
  let forecastStart = Object.hasOwn(input, "forecast_start") ? cleanDate(input.forecast_start) : cleanDate(existing.forecast_start);
  let forecastEnd = Object.hasOwn(input, "forecast_end") ? cleanDate(input.forecast_end) : cleanDate(existing.forecast_end);
  const description = Object.hasOwn(input, "description") ? cleanMultilineText(input.description, 5000) || null : existing.description;
  const requiredInputs = Object.hasOwn(input, "required_inputs")
    ? cleanRequiredInputs(input.required_inputs)
    : cleanRequiredInputs(existing.required_inputs);
  const clientVisible = Object.hasOwn(input, "client_visible") ? input.client_visible === true : existing.client_visible !== false;
  const tags = Object.hasOwn(input, "tags")
    ? cleanStringArray(input.tags, 30, 80)
    : cleanStringArray(existingMetadata.tags, 30, 80);
  const linkedDocumentIds = Object.hasOwn(input, "linked_document_ids")
    ? cleanUuidArray(input.linked_document_ids, 100)
    : cleanUuidArray(existingMetadata.linked_document_ids, 100);
  const calendarBlocks = Object.hasOwn(input, "calendar_blocks")
    ? cleanCalendarBlocks(input.calendar_blocks)
    : cleanCalendarBlocks(existingMetadata.calendar_blocks);

  if (title.length < 2) throw new Response("Task title is required", { status: 400 });
  if (!UUID_REGEX.test(departmentId)) throw new Response("A valid department is required", { status: 400 });
  if (!TASK_STATUSES.has(status)) throw new Response("Invalid task status", { status: 400 });
  if (meeting) {
    if (!["not_started", "in_progress", "completed", "cancelled"].includes(status)) {
      throw new Response("Invalid meeting status", { status: 400 });
    }
    progress = status === "completed" ? 100 : 0;
    plannedEnd = plannedStart;
    forecastStart = null;
    forecastEnd = null;
  } else if (progress >= 100 && status !== "cancelled") {
    progress = 100;
    status = "completed";
  } else if (status === "completed") {
    if (Object.hasOwn(input, "progress") && progress < 100) status = progress > 0 ? "in_progress" : "not_started";
    else progress = 100;
  } else if (["not_started", "ready"].includes(status) && progress > 0) {
    status = "in_progress";
  }
  if (Object.hasOwn(input, "planned_start") && input.planned_start && !plannedStart) throw new Response("Invalid planned start", { status: 400 });
  if (Object.hasOwn(input, "planned_end") && input.planned_end && !plannedEnd) throw new Response("Invalid planned end", { status: 400 });
  if (Object.hasOwn(input, "forecast_start") && input.forecast_start && !forecastStart) throw new Response("Invalid forecast start", { status: 400 });
  if (Object.hasOwn(input, "forecast_end") && input.forecast_end && !forecastEnd) throw new Response("Invalid forecast end", { status: 400 });
  if (plannedStart && plannedEnd && plannedEnd < plannedStart) throw new Response("Planned end cannot be before planned start", { status: 400 });
  if (forecastStart && forecastEnd && forecastEnd < forecastStart) throw new Response("Forecast end cannot be before forecast start", { status: 400 });

  const [departmentRows, projectDocuments] = await Promise.all([
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_departments?id=eq.${encodeURIComponent(departmentId)}&is_active=eq.true&select=id&limit=1`,
    ),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_project_documents?project_id=eq.${encodeURIComponent(projectId)}&select=id&limit=1000`,
    ),
  ]);
  if (!departmentRows.length) throw new Response("Department not found", { status: 400 });
  const availableDocumentIds = new Set(projectDocuments.map((document) => String(document.id)));
  if (linkedDocumentIds.some((documentId) => !availableDocumentIds.has(documentId))) {
    throw new Response("A linked document does not belong to this project", { status: 400 });
  }

  const { calendar_blocks: _discardedCalendarBlocks, ...baseMetadata } = existingMetadata;
  let metadata: JsonRow;
  if (meeting) {
    const meetingStatus = status === "completed" || status === "in_progress" || status === "cancelled" ? status : "not_started";
    const calendarEvent = cleanMeetingEvent(
      Object.hasOwn(input, "calendar_event") ? input.calendar_event : existingMetadata.calendar_event,
      plannedEffortMinutes || 60,
      meetingStatus,
    );
    calendarEvent.status = meetingStatus;
    plannedEffortMinutes = calendarEvent.duration_minutes;
    const meetingDetails = cleanMeetingDetails(
      Object.hasOwn(input, "meeting_details") ? input.meeting_details : existingMetadata.meeting_details,
    );
    const existingGeminiNotes = cleanObject(existingMetadata.gemini_notes, 10);
    metadata = {
      ...baseMetadata,
      task_type: "meeting",
      tags,
      linked_document_ids: linkedDocumentIds,
      calendar_event: calendarEvent,
      meeting_details: meetingDetails,
      gemini_notes: {
        status: cleanText(existingGeminiNotes.status, 30) === "indexed" ? "indexed" : "pending",
        document_id: UUID_REGEX.test(cleanText(existingGeminiNotes.document_id, 36)) ? cleanText(existingGeminiNotes.document_id, 36) : null,
      },
    };
  } else {
    metadata = {
      ...baseMetadata,
      tags,
      linked_document_ids: linkedDocumentIds,
      calendar_blocks: calendarBlocks,
    };
  }
  const response = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `pm_tasks?id=eq.${encodeURIComponent(taskId)}&project_id=eq.${encodeURIComponent(projectId)}&deleted_at=is.null&version=eq.${requestedVersion}&select=*`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        title,
        department_id: departmentId,
        status,
        progress,
        planned_start: plannedStart,
        planned_end: plannedEnd,
        forecast_start: forecastStart,
        forecast_end: forecastEnd,
        planned_effort_minutes: plannedEffortMinutes,
        actual_effort_minutes: actualEffortMinutes,
        description,
        required_inputs: requiredInputs,
        client_visible: clientVisible,
        metadata,
      }),
    },
  );
  const updatedRows = await response.json().catch(() => []);
  if (!response.ok) {
    const error = Array.isArray(updatedRows) ? {} : updatedRows as JsonRow;
    throw new Response(cleanText(error.message || error.error, 500) || "Unable to update task", { status: 400 });
  }
  if (!Array.isArray(updatedRows) || !updatedRows.length) {
    throw new Response("This task changed in another session. Refresh it before saving.", { status: 409 });
  }

  const activityResponse = await restRequest(supabaseUrl, serviceRoleKey, "pm_activity_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      actor_user_id: user.id,
      actor_type: "user",
      event_type: "task.updated",
      entity_type: "task",
      entity_id: taskId,
      summary: `${meeting ? "Reunión" : "Tarea"} actualizada: ${title}`,
      metadata: { version: updatedRows[0].version, department_id: departmentId, status, entity_kind: meeting ? "meeting" : "task" },
    }),
  });
  if (!activityResponse.ok) console.error("Unable to record task activity", activityResponse.status);
  return { task: updatedRows[0] };
}

async function deleteTask(
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const projectId = cleanText(body.project_id, 36);
  const taskId = cleanText(body.task_id, 36);
  const requestedVersion = cleanNumber(body.version, 1, 1000000);
  if (!UUID_REGEX.test(projectId) || !UUID_REGEX.test(taskId) || !Number.isInteger(requestedVersion)) {
    throw new Response("Valid project, task, and version are required", { status: 400 });
  }
  const response = await restRequest(supabaseUrl, serviceRoleKey, "rpc/delete_pm_task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_project_id: projectId,
      p_task_id: taskId,
      p_expected_version: requestedVersion,
      p_actor_user_id: user.id,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = cleanText((result as JsonRow).message || (result as JsonRow).error, 500) || "Unable to delete task";
    throw new Response(message, { status: message.includes("another session") ? 409 : 400 });
  }
  return { task: result };
}

async function manageDepartment(
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const input = cleanObject(body.department, 12);
  const action = cleanText(input.action, 20);
  const departmentId = cleanText(input.department_id, 36);
  const replacementDepartmentId = cleanText(input.replacement_department_id, 36);
  if (!["create", "update", "delete"].includes(action)) throw new Response("Invalid department action", { status: 400 });
  if (action !== "create" && !UUID_REGEX.test(departmentId)) throw new Response("Valid department ID is required", { status: 400 });
  if (action === "delete" && replacementDepartmentId && !UUID_REGEX.test(replacementDepartmentId)) {
    throw new Response("Invalid replacement department", { status: 400 });
  }
  const response = await restRequest(supabaseUrl, serviceRoleKey, "rpc/manage_pm_department", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_action: action,
      p_department_id: UUID_REGEX.test(departmentId) ? departmentId : null,
      p_name: cleanText(input.name, 120) || null,
      p_color: cleanText(input.color, 7).toUpperCase() || null,
      p_replacement_department_id: UUID_REGEX.test(replacementDepartmentId) ? replacementDepartmentId : null,
      p_actor_user_id: user.id,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Response(cleanText((result as JsonRow).message || (result as JsonRow).error, 500) || "Unable to manage department", { status: 400 });
  }
  return { department: result };
}

async function proposeDocumentChange(
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const projectId = cleanText(body.project_id, 36);
  const documentId = cleanText(body.project_document_id, 36);
  const baseRevisionId = cleanText(body.base_revision_id, 300);
  const summary = cleanText(body.summary, 1000);
  const proposedChanges = cleanObject(body.proposed_changes, 100);
  if (!UUID_REGEX.test(projectId) || !UUID_REGEX.test(documentId) || !baseRevisionId || summary.length < 3) {
    throw new Response("Valid project, document, base revision, and summary are required", { status: 400 });
  }
  const documents = await restJson(
    supabaseUrl,
    serviceRoleKey,
    `pm_project_documents?id=eq.${encodeURIComponent(documentId)}&project_id=eq.${encodeURIComponent(projectId)}&select=id,access_mode&limit=1`,
  );
  if (!documents.length) throw new Response("Project document not found", { status: 404 });
  const response = await restRequest(supabaseUrl, serviceRoleKey, "pm_document_change_proposals", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      project_id: projectId,
      project_document_id: documentId,
      base_revision_id: baseRevisionId,
      summary,
      proposed_changes: proposedChanges,
      requested_by: user.id,
      status: "proposed",
    }),
  });
  if (!response.ok) throw new Error(`Unable to record document proposal (${response.status})`);
  return (await response.json())?.[0] || {};
}

function normalizeMatchText(value: unknown) {
  return cleanText(value, 500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function classifyDriveDocument(item: DriveItem) {
  const context = normalizeMatchText(`${item.folderPath} ${item.name}`);
  if (/\b(minutas?|notes by gemini|transcript|transcripcion)\b/.test(context)) return "meeting_transcript";
  if (/\b(cotizacion|quote|propuesta economica)\b/.test(context)) return "quote";
  if (/\b(contrato|contract|orden de compra)\b/.test(context)) return "contract";
  if (/\b(brief|levantamiento)\b/.test(context)) return "brief";
  if (/\b(01 insumos?|inputs?)\b/.test(context)) return "input";
  if (/\b(08 entregables?|deliverables?)\b/.test(context)) return "deliverable";
  return "supporting";
}

function matchMeetingTask(item: DriveItem, tasks: JsonRow[]) {
  const haystack = normalizeMatchText(item.name);
  let best: { task: JsonRow; score: number } | null = null;
  for (const task of tasks) {
    if (!isMeetingRecord(task)) continue;
    const tokens = normalizeMatchText(task.title).split(" ").filter((token) => token.length >= 4 && !["reunion", "semanal", "cliente"].includes(token));
    const tokenScore = tokens.reduce((score, token) => score + (haystack.includes(token) ? 3 : 0), 0);
    const plannedDate = cleanDate(task.planned_start);
    const modifiedDate = cleanDate(String(item.modifiedTime || "").slice(0, 10));
    const dateScore = plannedDate && modifiedDate
      ? Math.max(0, 4 - Math.floor(Math.abs(new Date(`${plannedDate}T12:00:00Z`).getTime() - new Date(`${modifiedDate}T12:00:00Z`).getTime()) / 86400000))
      : 0;
    const score = tokenScore + dateScore;
    if (!best || score > best.score) best = { task, score };
  }
  return best && best.score >= 3 ? best.task : null;
}

async function stableCalendarEventId(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `rasika${hex.slice(0, 46)}`;
}

async function patchTaskMetadata(
  task: JsonRow,
  projectId: string,
  mutate: (metadata: JsonRow) => JsonRow,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  let current = task;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const version = Number(current.version);
    const metadata = mutate(cleanObject(current.metadata, 100));
    const response = await restRequest(
      supabaseUrl,
      serviceRoleKey,
      `pm_tasks?id=eq.${encodeURIComponent(String(current.id))}&project_id=eq.${encodeURIComponent(projectId)}&deleted_at=is.null&version=eq.${version}&select=*`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ metadata }),
      },
    );
    const rows = await response.json().catch(() => []);
    if (response.ok && Array.isArray(rows) && rows.length) return rows[0] as JsonRow;
    const latest = await restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_tasks?id=eq.${encodeURIComponent(String(current.id))}&project_id=eq.${encodeURIComponent(projectId)}&deleted_at=is.null&select=*&limit=1`,
    );
    if (!latest.length) throw new Response("Task no longer exists", { status: 409 });
    current = latest[0];
  }
  throw new Response("The task changed while linking Google. Refresh and try again.", { status: 409 });
}

function requireGoogleConnectionOwner(user: AuthUser) {
  const ownerEmail = cleanText(Deno.env.get("GOOGLE_PM_OWNER_EMAIL"), 320).toLowerCase();
  if (!ownerEmail || cleanText(user.email, 320).toLowerCase() !== ownerEmail) {
    throw new Response("This Google connection is restricted to its authorized owner", { status: 403 });
  }
}

function configuredCalendars() {
  const calendars = [
    { id: cleanText(Deno.env.get("GOOGLE_PM_CALENDAR_ID"), 500), label: "Rasika · Trabajo de proyectos" },
    { id: cleanText(Deno.env.get("GOOGLE_PM_MEETING_CALENDAR_ID"), 500) || "primary", label: "Calendario principal · reuniones" },
  ];
  const seen = new Set<string>();
  return calendars.filter((calendar) => {
    if (!calendar.id || seen.has(calendar.id)) return false;
    seen.add(calendar.id);
    return true;
  });
}

function eventLocalStart(value: string) {
  const text = cleanText(value, 100);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.slice(0, 19);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T09:00:00`;
  return null;
}

function eventDurationMinutes(startsAt: string, endsAt: string) {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 60;
  return Math.max(15, Math.min(1440, Math.round((end - start) / 60000)));
}

async function listExistingCalendarEvents(body: JsonRow, user: AuthUser) {
  requireGoogleConnectionOwner(user);
  const projectId = cleanText(body.project_id, 36);
  if (!UUID_REGEX.test(projectId)) throw new Response("Valid project ID is required", { status: 400 });
  const now = Date.now();
  const requestedMin = cleanText(body.time_min, 100);
  const requestedMax = cleanText(body.time_max, 100);
  const timeMinDate = requestedMin ? new Date(requestedMin) : new Date(now - 7 * 86400000);
  const timeMaxDate = requestedMax ? new Date(requestedMax) : new Date(now + 120 * 86400000);
  if (Number.isNaN(timeMinDate.getTime()) || Number.isNaN(timeMaxDate.getTime()) || timeMaxDate <= timeMinDate) {
    throw new Response("Invalid Calendar date range", { status: 400 });
  }
  if (timeMaxDate.getTime() - timeMinDate.getTime() > 370 * 86400000) {
    throw new Response("Calendar searches are limited to 370 days", { status: 400 });
  }
  const events = await listCalendarEvents({
    calendars: configuredCalendars(),
    timeMin: timeMinDate.toISOString(),
    timeMax: timeMaxDate.toISOString(),
    query: cleanText(body.query, 200),
    maxResults: 80,
  });
  return { events };
}

async function linkExistingCalendarEvent(
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  requireGoogleConnectionOwner(user);
  const projectId = cleanText(body.project_id, 36);
  const taskId = cleanText(body.task_id, 36);
  const blockId = cleanText(body.block_id, 80);
  const calendarId = cleanText(body.calendar_id, 500);
  const eventId = cleanText(body.event_id, 300);
  if (!UUID_REGEX.test(projectId) || !UUID_REGEX.test(taskId) || !calendarId || !eventId) {
    throw new Response("Valid project, activity, calendar, and event are required", { status: 400 });
  }
  const calendar = configuredCalendars().find((item) => item.id === calendarId);
  if (!calendar) throw new Response("This Calendar is not allowed for project linking", { status: 400 });
  const [projects, tasks] = await Promise.all([
    restJson(supabaseUrl, serviceRoleKey, `pm_projects?id=eq.${encodeURIComponent(projectId)}&select=id,project_code,name&limit=1`),
    restJson(supabaseUrl, serviceRoleKey, `pm_tasks?project_id=eq.${encodeURIComponent(projectId)}&deleted_at=is.null&select=*&limit=1000`),
  ]);
  const task = tasks.find((item) => String(item.id) === taskId);
  if (!projects.length || !task) throw new Response("Project activity not found", { status: 404 });
  for (const candidate of tasks) {
    if (String(candidate.id) === taskId) continue;
    const metadata = cleanObject(candidate.metadata, 100);
    const meetingEvent = cleanMeetingEvent(metadata.calendar_event);
    const alreadyLinked = meetingEvent.event_id === eventId || cleanCalendarBlocks(metadata.calendar_blocks).some((block) => block.event_id === eventId);
    if (alreadyLinked) throw new Response(`This event is already linked to ${cleanText(candidate.title, 240)}`, { status: 409 });
  }
  const event = await getCalendarEvent(calendar.id, calendar.label, eventId);
  const localStart = eventLocalStart(event.startsAt);
  if (!localStart) throw new Response("The selected Calendar event has no usable start time", { status: 409 });
  const durationMinutes = eventDurationMinutes(event.startsAt, event.endsAt);
  const meeting = isMeetingRecord(task);
  const suppliedMeetingDetails = meeting && Object.hasOwn(body, "meeting_details")
    ? cleanMeetingDetails(body.meeting_details)
    : null;
  const updatedTask = await patchTaskMetadata(task, projectId, (metadata) => {
    if (meeting) {
      const details = suppliedMeetingDetails || cleanMeetingDetails(metadata.meeting_details);
      const seen = new Set(details.attendees.map((attendee) => attendee.email).filter(Boolean));
      const attendees = [...details.attendees];
      for (const attendee of event.attendees) {
        if (seen.has(attendee.email)) continue;
        seen.add(attendee.email);
        attendees.push({ id: crypto.randomUUID(), name: attendee.displayName || "", email: attendee.email, role: "Invitado de Calendar" });
      }
      return {
        ...metadata,
        calendar_event: {
          ...cleanMeetingEvent(metadata.calendar_event, durationMinutes, cleanText(task.status, 30)),
          duration_minutes: durationMinutes,
          calendar_id: calendar.id,
          event_id: event.id,
          event_url: event.htmlLink,
          starts_at: localStart,
          conference_url: event.conferenceUrl,
        },
        meeting_details: { ...details, attendees },
      };
    }
    const blocks = cleanCalendarBlocks(metadata.calendar_blocks);
    const requestedId = blockId || crypto.randomUUID();
    const linkedBlock = {
      id: requestedId,
      duration_hours: durationMinutes <= 120 ? 2 : 4,
      status: "not_started",
      title: event.summary || `Evento vinculado · ${durationMinutes} min`,
      calendar_id: calendar.id,
      event_id: event.id,
      event_url: event.htmlLink,
      starts_at: localStart,
    };
    const existingIndex = blocks.findIndex((block) => block.id === requestedId);
    if (existingIndex >= 0) blocks[existingIndex] = { ...blocks[existingIndex], ...linkedBlock };
    else blocks.push(linkedBlock);
    return { ...metadata, calendar_blocks: blocks };
  }, supabaseUrl, serviceRoleKey);
  await restRequest(supabaseUrl, serviceRoleKey, "pm_activity_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      actor_user_id: user.id,
      actor_type: "user",
      event_type: meeting ? "calendar.meeting.linked" : "calendar.work_block.linked",
      entity_type: "task",
      entity_id: taskId,
      summary: `Evento existente vinculado a ${cleanText(task.title, 240)}`,
      metadata: { calendar_id: calendar.id, event_id: event.id, block_id: blockId || null },
    }),
  });
  return { task: updatedTask, event };
}

async function createProjectCalendarEvent(
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const projectId = cleanText(body.project_id, 36);
  const taskId = cleanText(body.task_id, 36);
  const blockId = cleanText(body.block_id, 80);
  const localStart = cleanLocalDateTime(body.local_start);
  if (!UUID_REGEX.test(projectId) || !UUID_REGEX.test(taskId) || !localStart) {
    throw new Response("Valid project, activity, date, and time are required", { status: 400 });
  }
  requireGoogleConnectionOwner(user);
  const [projects, tasks] = await Promise.all([
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_projects?id=eq.${encodeURIComponent(projectId)}&select=id,project_code,name,timezone&limit=1`,
    ),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_tasks?id=eq.${encodeURIComponent(taskId)}&project_id=eq.${encodeURIComponent(projectId)}&deleted_at=is.null&select=*&limit=1`,
    ),
  ]);
  if (!projects.length || !tasks.length) throw new Response("Project activity not found", { status: 404 });
  const project = projects[0];
  const task = tasks[0];
  const meeting = isMeetingRecord(task);
  const metadata = cleanObject(task.metadata, 100);
  const timezone = cleanText(project.timezone, 100) || "America/Santiago";
  let durationMinutes: number;
  let calendarId: string;
  let attendees: Array<{ email: string; displayName?: string }> = [];
  let eventKey: string;
  let requestedMeetingDetails: ReturnType<typeof cleanMeetingDetails> | null = null;
  if (meeting) {
    const requestedDuration = Math.round(cleanNumber(body.duration_minutes, 15, 1440) ?? Number(task.planned_effort_minutes) ?? 60);
    const existingEvent = cleanMeetingEvent(metadata.calendar_event, requestedDuration, cleanText(task.status, 30));
    existingEvent.duration_minutes = requestedDuration;
    durationMinutes = existingEvent.duration_minutes;
    calendarId = cleanText(Deno.env.get("GOOGLE_PM_MEETING_CALENDAR_ID"), 500) || "primary";
    const details = Object.hasOwn(body, "meeting_details") ? cleanMeetingDetails(body.meeting_details) : cleanMeetingDetails(metadata.meeting_details);
    requestedMeetingDetails = details;
    const seen = new Set<string>();
    attendees = details.attendees.flatMap((attendee) => {
      const email = cleanText(attendee.email, 320).toLowerCase();
      if (!email || seen.has(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return [];
      seen.add(email);
      return [{ email, displayName: cleanText(attendee.name, 200) || undefined }];
    });
    eventKey = `meeting:${taskId}`;
  } else {
    const blocks = cleanCalendarBlocks(metadata.calendar_blocks);
    const block = blocks.find((item) => item.id === blockId);
    if (!block || !blockId) throw new Response("Calendar work block not found", { status: 404 });
    durationMinutes = Number(block.duration_hours) * 60;
    calendarId = cleanText(Deno.env.get("GOOGLE_PM_CALENDAR_ID"), 500);
    if (!calendarId) throw new Error("GOOGLE_PM_CALENDAR_ID is not configured");
    eventKey = `task:${taskId}:block:${blockId}`;
  }
  const eventId = await stableCalendarEventId(`${calendarId}:${eventKey}`);
  const event = await createCalendarEvent({
    calendarId,
    eventId,
    summary: `${cleanText(project.project_code, 40)} · ${cleanText(task.title, 240)}`,
    description: `${meeting ? "Reunión" : "Bloque de trabajo"} de Rasika Project Control\nProyecto: ${cleanText(project.name, 240)}\nActividad: ${cleanText(task.title, 240)}`,
    localStart,
    durationMinutes,
    timezone,
    attendees,
    createMeet: meeting,
    sendUpdates: meeting && attendees.length ? "all" : "none",
    privateProperties: {
      rasikaProjectId: projectId,
      rasikaTaskId: taskId,
      rasikaActivityType: meeting ? "meeting" : "work_block",
      ...(blockId ? { rasikaBlockId: blockId } : {}),
    },
  });
  const eventUrl = cleanHttpsUrl(event.htmlLink);
  const conferenceData = cleanObject(event.conferenceData, 20);
  const entryPoints = Array.isArray(conferenceData.entryPoints) ? conferenceData.entryPoints as JsonRow[] : [];
  const conferenceUrl = cleanHttpsUrl(event.hangoutLink) || cleanHttpsUrl(entryPoints.find((entry) => entry.entryPointType === "video")?.uri);
  const updatedTask = await patchTaskMetadata(task, projectId, (currentMetadata) => {
    if (meeting) {
      return {
        ...currentMetadata,
        calendar_event: {
          ...cleanMeetingEvent(currentMetadata.calendar_event, durationMinutes, cleanText(task.status, 30)),
          calendar_id: calendarId,
          event_id: cleanText(event.id, 300) || eventId,
          event_url: eventUrl,
          starts_at: localStart,
          conference_url: conferenceUrl,
        },
        meeting_details: requestedMeetingDetails || cleanMeetingDetails(currentMetadata.meeting_details),
      };
    }
    const blocks = cleanCalendarBlocks(currentMetadata.calendar_blocks).map((block) => block.id === blockId
      ? { ...block, calendar_id: calendarId, event_id: cleanText(event.id, 300) || eventId, event_url: eventUrl, starts_at: localStart }
      : block);
    return { ...currentMetadata, calendar_blocks: blocks };
  }, supabaseUrl, serviceRoleKey);

  await restRequest(supabaseUrl, serviceRoleKey, "pm_activity_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      actor_user_id: user.id,
      actor_type: "user",
      event_type: meeting ? "calendar.meeting.created" : "calendar.work_block.created",
      entity_type: "task",
      entity_id: taskId,
      summary: `Evento de Calendar vinculado a ${cleanText(task.title, 240)}`,
      metadata: { calendar_id: calendarId, event_id: cleanText(event.id, 300) || eventId, block_id: blockId || null },
    }),
  });
  return { task: updatedTask, event: { id: cleanText(event.id, 300) || eventId, url: eventUrl, conference_url: conferenceUrl } };
}

async function syncProjectDrive(
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const syncedAt = new Date().toISOString();
  const projectId = cleanText(body.project_id, 36);
  if (!UUID_REGEX.test(projectId)) throw new Response("Valid project ID is required", { status: 400 });
  const projects = await restJson(
    supabaseUrl,
    serviceRoleKey,
    `pm_projects?id=eq.${encodeURIComponent(projectId)}&select=id,project_code,name,drive_root_id&limit=1`,
  );
  if (!projects.length) throw new Response("Project not found", { status: 404 });
  const project = projects[0];
  const sharedDriveId = cleanText(Deno.env.get("GOOGLE_PM_DRIVE_ID"), 300);
  const configuredFirstRoot = cleanText(Deno.env.get("GOOGLE_PM_DRIVE_ROOT_FOLDER_ID"), 300);
  let projectFolderId = cleanText(project.drive_root_id, 300);
  if ((!projectFolderId || projectFolderId.startsWith("pending-drive:")) && project.project_code === "RAS-2026-0001") {
    projectFolderId = configuredFirstRoot;
    const linkResponse = await restRequest(supabaseUrl, serviceRoleKey, `pm_projects?id=eq.${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ drive_root_id: projectFolderId }),
    });
    if (!linkResponse.ok) throw new Error(`Unable to link the project Drive folder (${linkResponse.status})`);
  }
  if (!sharedDriveId || !projectFolderId || projectFolderId.startsWith("pending-drive:")) {
    throw new Response("This project does not have a configured Drive folder", { status: 409 });
  }
  const drive = await listProjectDriveTree(sharedDriveId, projectFolderId);
  const [meetingTasks, existingDriveDocuments] = await Promise.all([
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_tasks?project_id=eq.${encodeURIComponent(projectId)}&deleted_at=is.null&select=id,title,task_key,planned_start,metadata,version&limit=1000`,
    ),
    restJson(
      supabaseUrl,
      serviceRoleKey,
      `pm_project_documents?project_id=eq.${encodeURIComponent(projectId)}&provider=eq.google_drive&select=id,external_file_id,metadata&limit=5000`,
    ),
  ]);
  const driveItems = [...drive.folders, ...drive.files];
  const documents = driveItems.map((item) => {
    const isFolder = item.mimeType === "application/vnd.google-apps.folder";
    const documentType = isFolder ? "supporting" : classifyDriveDocument(item);
    const meetingTask = documentType === "meeting_transcript" ? matchMeetingTask(item, meetingTasks) : null;
    return {
      project_id: projectId,
      provider: "google_drive",
      external_file_id: item.id,
      external_parent_id: item.parents?.[0] || projectFolderId,
      name: item.name.slice(0, 300),
      mime_type: item.mimeType,
      document_type: documentType,
      access_mode: !isFolder && item.mimeType === "application/vnd.google-apps.document" ? "suggest_only" : "read_only",
      last_revision_id: item.version || null,
      metadata: {
        modified_time: item.modifiedTime || null,
        created_time: item.createdTime || null,
        web_view_link: cleanHttpsUrl(item.webViewLink),
        folder_path: item.folderPath,
        size: item.size || null,
        md5_checksum: item.md5Checksum || null,
        drive_version: item.version || null,
        meeting_task_id: meetingTask?.id || null,
        item_type: isFolder ? "folder" : "file",
        drive_present: true,
        last_seen_at: syncedAt,
        missing_since: null,
      },
    };
  });
  const syncedRows: JsonRow[] = [];
  for (let index = 0; index < documents.length; index += 100) {
    const batch = documents.slice(index, index + 100);
    const response = await restRequest(
      supabaseUrl,
      serviceRoleKey,
      "pm_project_documents?on_conflict=provider,external_file_id&select=id,external_file_id,document_type,metadata",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(batch),
      },
    );
    const rows = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(rows)) throw new Error(`Unable to synchronize Drive metadata (${response.status})`);
    syncedRows.push(...rows);
  }
  const currentExternalIds = new Set(documents.map((document) => String(document.external_file_id)));
  const missingDriveDocuments = existingDriveDocuments.filter((document) => {
    const externalFileId = cleanText(document.external_file_id, 500);
    return externalFileId && !externalFileId.startsWith("pending-drive:") && !currentExternalIds.has(externalFileId);
  });
  for (const document of missingDriveDocuments) {
    const metadata = cleanObject(document.metadata, 100);
    if (metadata.drive_present === false) continue;
    const response = await restRequest(
      supabaseUrl,
      serviceRoleKey,
      `pm_project_documents?id=eq.${encodeURIComponent(String(document.id))}&project_id=eq.${encodeURIComponent(projectId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ metadata: { ...metadata, drive_present: false, missing_since: syncedAt } }),
      },
    );
    if (!response.ok) throw new Error(`Unable to mark missing Drive metadata (${response.status})`);
  }
  const noteByTask = new Map<string, JsonRow>();
  for (const document of syncedRows) {
    const metadata = cleanObject(document.metadata, 50);
    const meetingTaskId = cleanText(metadata.meeting_task_id, 36);
    if (UUID_REGEX.test(meetingTaskId)) noteByTask.set(meetingTaskId, document);
  }
  for (const task of meetingTasks) {
    const note = noteByTask.get(String(task.id));
    if (!note) continue;
    await patchTaskMetadata(task, projectId, (metadata) => ({
      ...metadata,
      gemini_notes: { status: "pending", document_id: note.id },
    }), supabaseUrl, serviceRoleKey);
  }
  await restRequest(supabaseUrl, serviceRoleKey, "pm_activity_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      actor_user_id: user.id,
      actor_type: "user",
      event_type: "drive.metadata.synced",
      entity_type: "project",
      entity_id: projectId,
      summary: `${drive.files.length} archivos y ${drive.folderCount} carpetas inspeccionados en Drive`,
      metadata: { shared_drive_id: sharedDriveId, project_folder_id: projectFolderId, files: drive.files.length, folders: drive.folderCount, items: documents.length, missing: missingDriveDocuments.length, synced_at: syncedAt },
    }),
  });
  return { files: drive.files.length, folders: drive.folderCount, items: documents.length, missing: missingDriveDocuments.length, meeting_notes: noteByTask.size, project_folder_id: projectFolderId, synced_at: syncedAt };
}

async function provisionProjectDriveTest(
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  requireGoogleConnectionOwner(user);
  const projectId = cleanText(body.project_id, 36);
  if (!UUID_REGEX.test(projectId)) throw new Response("Valid project ID is required", { status: 400 });
  const projects = await restJson(
    supabaseUrl,
    serviceRoleKey,
    `pm_projects?id=eq.${encodeURIComponent(projectId)}&select=id,project_code,name,drive_root_id&limit=1`,
  );
  if (!projects.length) throw new Response("Project not found", { status: 404 });
  const project = projects[0];
  const sharedDriveId = cleanText(Deno.env.get("GOOGLE_PM_DRIVE_ID"), 300);
  const configuredFirstRoot = cleanText(Deno.env.get("GOOGLE_PM_DRIVE_ROOT_FOLDER_ID"), 300);
  let projectFolderId = cleanText(project.drive_root_id, 300);
  if ((!projectFolderId || projectFolderId.startsWith("pending-drive:")) && cleanText(project.project_code, 40) === "RAS-2026-0001") {
    projectFolderId = configuredFirstRoot;
  }
  if (!sharedDriveId || !projectFolderId || projectFolderId.startsWith("pending-drive:")) {
    throw new Response("This project does not have a configured Drive root folder", { status: 409 });
  }
  const result = await provisionDriveConnectionTest({
    sharedDriveId,
    projectFolderId,
    folderName: "00 - Prueba de conexión",
    fileName: "conexion-drive-ok.txt",
    contents: [
      "Rasika Project Control · Google Drive connection test",
      `Project: ${cleanText(project.project_code, 40)} · ${cleanText(project.name, 240)}`,
      `Verified at: ${new Date().toISOString()}`,
      "This file can be removed manually after validation; the planner has no Drive deletion capability.",
    ].join("\n"),
  });
  if (cleanText(project.drive_root_id, 300) !== projectFolderId) {
    const linkResponse = await restRequest(supabaseUrl, serviceRoleKey, `pm_projects?id=eq.${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ drive_root_id: projectFolderId }),
    });
    if (!linkResponse.ok) throw new Error(`Unable to link the project Drive folder (${linkResponse.status})`);
  }
  const sync = await syncProjectDrive(body, user, supabaseUrl, serviceRoleKey);
  await restRequest(supabaseUrl, serviceRoleKey, "pm_activity_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      actor_user_id: user.id,
      actor_type: "user",
      event_type: "drive.connection_test.completed",
      entity_type: "project",
      entity_id: projectId,
      summary: "Prueba de conexión con Google Drive completada",
      metadata: {
        project_folder_id: projectFolderId,
        test_folder_id: result.folder.id,
        test_file_id: result.file.id,
        folder_created: result.folderCreated,
        file_created: result.fileCreated,
      },
    }),
  });
  return {
    ...sync,
    test_folder: { id: result.folder.id, name: result.folder.name, url: cleanHttpsUrl(result.folder.webViewLink), created: result.folderCreated },
    test_file: { id: result.file.id, name: result.file.name, url: cleanHttpsUrl(result.file.webViewLink), created: result.fileCreated },
  };
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (!["GET", "POST"].includes(request.method)) return jsonResponse(request, { error: "Method not allowed" }, 405);

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(request, { error: "Project management is unavailable" }, 503);
  }

  try {
    const url = new URL(request.url);
    const resource = cleanText(url.searchParams.get("resource"), 40) || "bootstrap";
    if (request.method === "GET" && resource === "shared") {
      return jsonResponse(request, await getSharedProject(url.searchParams.get("token"), supabaseUrl, serviceRoleKey));
    }

    const { user, profile } = await requireProjectStaff(request, supabaseUrl, anonKey, serviceRoleKey);
    if (request.method === "GET") {
      if (resource === "bootstrap") {
        return jsonResponse(request, { profile, ...(await getBootstrap(supabaseUrl, serviceRoleKey)) });
      }
      if (resource === "project") {
        return jsonResponse(request, await getProject(cleanText(url.searchParams.get("id"), 36), supabaseUrl, serviceRoleKey));
      }
      return jsonResponse(request, { error: "Unknown resource" }, 404);
    }

    const body = await request.json().catch(() => ({})) as JsonRow;
    const action = cleanText(body.action, 60);
    if (action === "create_project") {
      return jsonResponse(request, await createProject(request, body, user, supabaseUrl, serviceRoleKey), 201);
    }
    if (action === "update_task") {
      return jsonResponse(request, await updateTask(body, user, supabaseUrl, serviceRoleKey));
    }
    if (action === "delete_task") {
      return jsonResponse(request, await deleteTask(body, user, supabaseUrl, serviceRoleKey));
    }
    if (action === "manage_department") {
      return jsonResponse(request, await manageDepartment(body, user, supabaseUrl, serviceRoleKey));
    }
    if (action === "create_share_link") {
      return jsonResponse(request, await createProjectShareLink(body, user, supabaseUrl, serviceRoleKey), 201);
    }
    if (action === "revoke_share_link") {
      return jsonResponse(request, await revokeProjectShareLink(body, user, supabaseUrl, serviceRoleKey));
    }
    if (action === "propose_document_change") {
      return jsonResponse(request, { proposal: await proposeDocumentChange(body, user, supabaseUrl, serviceRoleKey) }, 201);
    }
    if (action === "create_calendar_event") {
      return jsonResponse(request, await createProjectCalendarEvent(body, user, supabaseUrl, serviceRoleKey), 201);
    }
    if (action === "list_calendar_events") {
      return jsonResponse(request, await listExistingCalendarEvents(body, user));
    }
    if (action === "link_calendar_event") {
      return jsonResponse(request, await linkExistingCalendarEvent(body, user, supabaseUrl, serviceRoleKey));
    }
    if (action === "sync_drive") {
      return jsonResponse(request, await syncProjectDrive(body, user, supabaseUrl, serviceRoleKey));
    }
    if (action === "provision_drive_test") {
      return jsonResponse(request, await provisionProjectDriveTest(body, user, supabaseUrl, serviceRoleKey), 201);
    }
    return jsonResponse(request, { error: "Unknown or disallowed action" }, 400);
  } catch (error) {
    if (error instanceof Response) return jsonResponse(request, { error: await error.text() }, error.status);
    console.error("Project admin error", error);
    return jsonResponse(request, { error: error instanceof Error ? error.message : "Project request failed" }, 500);
  }
});
