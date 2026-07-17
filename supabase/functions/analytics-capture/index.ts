import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EVENT_TYPES = new Set([
  "page_view",
  "click",
  "session_engagement",
  "form_submit",
  "newsletter_subscribe",
  "article_view",
  "chatbot_open",
  "quote_requested",
]);
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const safe: Record<string, string | number | boolean> = {};
  const allowed = ["label", "href", "duration_seconds", "article_slug", "element", "outbound"];
  for (const key of allowed) {
    const item = source[key];
    if (typeof item === "boolean") safe[key] = item;
    if (typeof item === "number" && Number.isFinite(item)) safe[key] = Math.max(0, Math.min(item, 86400));
    if (typeof item === "string") safe[key] = cleanText(item, key === "href" ? 500 : 160);
  }
  return safe;
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Analytics unavailable" }, 503);

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const sessionId = cleanText(body.session_id, 36);
    const eventType = cleanText(body.event_type, 40);
    const pagePath = cleanText(body.page_path, 500);
    if (!UUID_REGEX.test(sessionId) || !EVENT_TYPES.has(eventType) || !pagePath.startsWith("/")) {
      return jsonResponse({ error: "Invalid analytics event" }, 400);
    }

    const headerCountry = cleanText(
      request.headers.get("cf-ipcountry") || request.headers.get("x-vercel-ip-country") || "",
      2,
    ).toUpperCase();
    const countryCode = /^[A-Z]{2}$/.test(headerCountry) ? headerCountry : null;
    const payload = {
      session_id: sessionId,
      event_type: eventType,
      page_path: pagePath,
      source: cleanText(body.source, 80) || "direct",
      referrer: cleanText(body.referrer, 500) || null,
      country_code: countryCode,
      metadata: sanitizeMetadata(body.metadata),
    };

    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/site_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Event insert failed (${response.status})`);
    return jsonResponse({ status: "accepted" }, 202);
  } catch (error) {
    console.error("Analytics capture error", error);
    return jsonResponse({ error: "Unable to record analytics event" }, 500);
  }
});
