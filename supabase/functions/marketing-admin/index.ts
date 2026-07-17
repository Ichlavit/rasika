import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STAGES = new Set(["contact", "subscriber", "lead", "opportunity", "client", "inactive"]);

type AuthUser = { id: string; email?: string };
type JsonRow = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, maxLength = 500) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
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
  const result = await response.json();
  return Array.isArray(result) ? result : [];
}

async function requireAdmin(
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
  const admins = await restJson(
    supabaseUrl,
    serviceRoleKey,
    `ai_radar_admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`,
  );
  if (admins.length !== 1) throw new Response("Administrator access required", { status: 403 });
  return user;
}

function dayKey(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function countBy(rows: JsonRow[], getter: (row: JsonRow) => string, limit = 8) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = getter(row) || "Sin identificar";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function buildOverview(
  days: number,
  contacts: JsonRow[],
  events: JsonRow[],
  leads: JsonRow[],
  quotes: JsonRow[],
  queue: JsonRow[],
  campaigns: JsonRow[],
  imports: JsonRow[],
  integrations: JsonRow[],
) {
  const sessions = new Map<string, JsonRow[]>();
  for (const event of events) {
    const id = String(event.session_id || "");
    if (!sessions.has(id)) sessions.set(id, []);
    sessions.get(id)?.push(event);
  }
  const pageViews = events.filter((event) => event.event_type === "page_view");
  const engagement = events.filter((event) => event.event_type === "session_engagement");
  const durationTotal = engagement.reduce((sum, event) => {
    const metadata = (event.metadata && typeof event.metadata === "object") ? event.metadata as JsonRow : {};
    return sum + Number(metadata.duration_seconds || 0);
  }, 0);
  let bounced = 0;
  for (const sessionEvents of sessions.values()) {
    const views = sessionEvents.filter((event) => event.event_type === "page_view").length;
    const engaged = sessionEvents.some((event) => ["click", "form_submit", "newsletter_subscribe", "chatbot_open"].includes(String(event.event_type)));
    if (views <= 1 && !engaged) bounced += 1;
  }

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), sessions: 0, page_views: 0, leads: 0, subscribers: 0 };
  });
  const dailyMap = new Map(daily.map((item) => [item.date, item]));
  for (const [sessionId, sessionEvents] of sessions) {
    if (!sessionId) continue;
    const date = dayKey(sessionEvents[0]?.occurred_at);
    const item = dailyMap.get(date);
    if (item) item.sessions += 1;
  }
  for (const event of pageViews) {
    const item = dailyMap.get(dayKey(event.occurred_at));
    if (item) item.page_views += 1;
  }
  for (const lead of leads) {
    const item = dailyMap.get(dayKey(lead.created_at));
    if (item) item.leads += 1;
  }
  for (const contact of contacts) {
    if (contact.newsletter_status !== "subscribed") continue;
    const item = dailyMap.get(dayKey(contact.newsletter_consented_at));
    if (item) item.subscribers += 1;
  }

  const clickRows = events.filter((event) => event.event_type === "click");
  return {
    period_days: days,
    metrics: {
      sessions: sessions.size,
      page_views: pageViews.length,
      pages_per_session: sessions.size ? Number((pageViews.length / sessions.size).toFixed(1)) : 0,
      average_session_seconds: engagement.length ? Math.round(durationTotal / engagement.length) : 0,
      bounce_rate: sessions.size ? Number(((bounced / sessions.size) * 100).toFixed(1)) : 0,
      form_submissions: events.filter((event) => event.event_type === "form_submit").length,
      leads: leads.length,
      quotes: quotes.length,
      contacts_total: contacts.length,
      subscribers: contacts.filter((contact) => contact.newsletter_status === "subscribed").length,
      opportunities: contacts.filter((contact) => contact.lifecycle_stage === "opportunity").length,
      clients: contacts.filter((contact) => contact.lifecycle_stage === "client").length,
    },
    daily,
    top_pages: countBy(pageViews, (event) => String(event.page_path || "/")),
    traffic_sources: countBy(pageViews, (event) => String(event.source || "direct")),
    top_clicks: countBy(clickRows, (event) => {
      const metadata = (event.metadata && typeof event.metadata === "object") ? event.metadata as JsonRow : {};
      return cleanText(metadata.label, 120) || String(event.page_path || "Click");
    }),
    content_queue: queue,
    campaigns,
    imports,
    integrations,
    recent_contacts: [...contacts].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8),
  };
}

async function getOverview(
  url: URL,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const days = Math.max(7, Math.min(90, Number(url.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [contacts, events, leads, quotes, queue, campaigns, imports, integrations] = await Promise.all([
    restJson(supabaseUrl, serviceRoleKey, "contacts?select=id,email,full_name,company_name,lifecycle_stage,source_type,newsletter_status,newsletter_consented_at,resend_sync_status,created_at,last_seen_at&order=created_at.desc&limit=10000"),
    restJson(supabaseUrl, serviceRoleKey, `site_events?occurred_at=gte.${encodeURIComponent(since)}&select=session_id,event_type,page_path,source,metadata,occurred_at&order=occurred_at.asc&limit=20000`),
    restJson(supabaseUrl, serviceRoleKey, `leads?created_at=gte.${encodeURIComponent(since)}&select=id,created_at,status&limit=10000`),
    restJson(supabaseUrl, serviceRoleKey, `quotes?created_at=gte.${encodeURIComponent(since)}&select=id,created_at,status,quoted_price,quoted_currency&limit=10000`),
    restJson(supabaseUrl, serviceRoleKey, "marketing_content_queue?select=id,content_type,title,summary,public_url,status,detected_at&order=detected_at.desc&limit=100"),
    restJson(supabaseUrl, serviceRoleKey, "marketing_campaigns?select=id,name,subject,status,audience_count,created_at,scheduled_at,sent_at&order=created_at.desc&limit=20"),
    restJson(supabaseUrl, serviceRoleKey, "contact_imports?select=id,file_name,status,total_rows,inserted_rows,updated_rows,skipped_rows,consented_rows,created_at,completed_at&order=created_at.desc&limit=20"),
    restJson(supabaseUrl, serviceRoleKey, "marketing_integrations?select=provider,status,last_checked_at,last_error&order=provider.asc"),
  ]);
  return buildOverview(days, contacts, events, leads, quotes, queue, campaigns, imports, integrations);
}

async function getContacts(url: URL, supabaseUrl: string, serviceRoleKey: string) {
  const search = cleanText(url.searchParams.get("search"), 100).toLowerCase();
  const stage = cleanText(url.searchParams.get("stage"), 30);
  const newsletter = cleanText(url.searchParams.get("newsletter"), 30);
  const rows = await restJson(
    supabaseUrl,
    serviceRoleKey,
    "contacts?select=id,email,full_name,company_name,phone,lifecycle_stage,source_type,source_detail,newsletter_status,newsletter_consented_at,resend_sync_status,created_at,last_seen_at&order=last_seen_at.desc&limit=10000",
  );
  return rows.filter((row) => {
    const haystack = `${row.email || ""} ${row.full_name || ""} ${row.company_name || ""}`.toLowerCase();
    return (!search || haystack.includes(search)) && (!stage || row.lifecycle_stage === stage) &&
      (!newsletter || row.newsletter_status === newsletter);
  }).slice(0, 500);
}

async function updateQueue(
  body: JsonRow,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const id = cleanText(body.id, 36);
  const status = cleanText(body.status, 20);
  if (!UUID_REGEX.test(id) || !["queued", "included", "dismissed"].includes(status)) {
    return jsonResponse({ error: "Invalid queue update" }, 400);
  }
  const response = await restRequest(supabaseUrl, serviceRoleKey, `marketing_content_queue?id=eq.${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      status,
      included_at: status === "included" ? new Date().toISOString() : null,
    }),
  });
  if (!response.ok) throw new Error(`Queue update failed (${response.status})`);
  return jsonResponse((await response.json())?.[0] || {});
}

async function importContacts(
  body: JsonRow,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const fileName = cleanText(body.file_name, 200) || "contactos.csv";
  const inputRows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) as JsonRow[] : [];
  if (!inputRows.length) return jsonResponse({ error: "No valid rows supplied" }, 400);
  const importResponse = await restRequest(supabaseUrl, serviceRoleKey, "contact_imports", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ file_name: fileName, total_rows: inputRows.length, created_by: user.id }),
  });
  if (!importResponse.ok) throw new Error(`Unable to create import (${importResponse.status})`);
  const importRow = (await importResponse.json())?.[0];
  const existing = await restJson(supabaseUrl, serviceRoleKey, "contacts?select=id,email,lifecycle_stage,newsletter_status,source_type,source_detail&limit=10000");
  const byEmail = new Map(existing.map((row) => [String(row.email || "").toLowerCase(), row]));
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let consented = 0;
  const errors: JsonRow[] = [];

  for (let index = 0; index < inputRows.length; index += 1) {
    const row = inputRows[index];
    const email = cleanText(row.email, 320).toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      skipped += 1;
      errors.push({ row: index + 2, error: "Correo inválido" });
      continue;
    }
    const current = byEmail.get(email);
    const requestedStage = cleanText(row.lifecycle_stage, 30);
    const stage = STAGES.has(requestedStage) ? requestedStage : (current?.lifecycle_stage || "contact");
    const hasConsent = row.newsletter_consent === true;
    if (hasConsent) consented += 1;
    const now = new Date().toISOString();
    const payload: JsonRow = {
      email,
      full_name: cleanText(row.full_name, 160) || undefined,
      company_name: cleanText(row.company_name, 160) || undefined,
      phone: cleanText(row.phone, 60) || undefined,
      lifecycle_stage: stage,
      language: cleanText(row.language, 2) ? (cleanText(row.language, 2) === "en" ? "en" : "es") : undefined,
      source_type: current ? undefined : "csv_import",
      source_detail: current?.source_detail || cleanText(row.source_detail, 160) || fileName,
      last_seen_at: now,
    };
    if (hasConsent) {
      payload.newsletter_status = "subscribed";
      payload.newsletter_consented_at = now;
      payload.newsletter_consent_source = `csv:${fileName}`;
      payload.resend_sync_status = "not_synced";
    }
    const response = await restRequest(
      supabaseUrl,
      serviceRoleKey,
      current ? `contacts?id=eq.${current.id}` : "contacts",
      {
        method: current ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      skipped += 1;
      errors.push({ row: index + 2, error: `No se pudo guardar (${response.status})` });
      continue;
    }
    const saved = (await response.json())?.[0];
    if (saved) byEmail.set(email, saved);
    if (current) updated += 1;
    else inserted += 1;
  }

  const status = errors.length ? "completed_with_errors" : "completed";
  await restRequest(supabaseUrl, serviceRoleKey, `contact_imports?id=eq.${importRow.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      status,
      inserted_rows: inserted,
      updated_rows: updated,
      skipped_rows: skipped,
      consented_rows: consented,
      errors: errors.slice(0, 100),
      completed_at: new Date().toISOString(),
    }),
  });
  return jsonResponse({ status, inserted, updated, skipped, consented, errors: errors.slice(0, 20) });
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(request.method)) return jsonResponse({ error: "Method not allowed" }, 405);
  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: "Marketing admin unavailable" }, 503);

  try {
    const user = await requireAdmin(request, supabaseUrl, anonKey, serviceRoleKey);
    const url = new URL(request.url);
    if (request.method === "GET") {
      const resource = cleanText(url.searchParams.get("resource"), 40) || "overview";
      if (resource === "overview") return jsonResponse(await getOverview(url, supabaseUrl, serviceRoleKey));
      if (resource === "contacts") return jsonResponse({ contacts: await getContacts(url, supabaseUrl, serviceRoleKey) });
      return jsonResponse({ error: "Unknown resource" }, 404);
    }
    const body = await request.json().catch(() => ({})) as JsonRow;
    const action = cleanText(body.action, 40);
    if (action === "import_contacts") return await importContacts(body, user, supabaseUrl, serviceRoleKey);
    if (action === "update_queue") return await updateQueue(body, supabaseUrl, serviceRoleKey);
    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    if (error instanceof Response) return jsonResponse({ error: await error.text() }, error.status);
    console.error("Marketing admin error", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Marketing admin request failed" }, 500);
  }
});
