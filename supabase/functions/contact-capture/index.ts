import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isPlaceholderEmail(email: string) {
  const normalized = email.toLowerCase();
  return normalized === "pendiente@rasika.cl" || normalized.endsWith("@pendiente.rasika.cl");
}

function restUrl(supabaseUrl: string, path: string) {
  return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${path.replace(/^\//, "")}`;
}

async function serviceRequest(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
  init: RequestInit = {},
) {
  return fetch(restUrl(supabaseUrl, path), {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(init.headers || {}),
    },
  });
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Capture service is unavailable" }, 503);
  }

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (cleanText(body.website, 100)) return jsonResponse({ status: "captured" }, 202);

    const name = cleanText(body.name, 120);
    const email = cleanText(body.email, 320).toLowerCase();
    const companyName = cleanText(body.company_name, 160);
    const trafficSource = cleanText(body.traffic_source, 500) || "Website";
    const language = cleanText(body.language, 2) === "en" ? "en" : "es";
    const requestedLeadId = cleanText(body.lead_id, 36);
    const sessionId = cleanText(body.session_id, 36);
    const pagePath = cleanText(body.page_path, 500) || "/";

    if (!name || !EMAIL_REGEX.test(email)) {
      return jsonResponse({ error: "Name and a valid email are required" }, 400);
    }

    const payload = {
      name,
      email,
      company_name: companyName || "Pendiente",
      traffic_source: trafficSource,
      language,
    };

    let leadId = "";
    if (requestedLeadId && UUID_REGEX.test(requestedLeadId)) {
      const existingResponse = await serviceRequest(
        supabaseUrl,
        serviceRoleKey,
        `leads?id=eq.${encodeURIComponent(requestedLeadId)}&select=id,email&limit=1`,
      );
      const existingRows = existingResponse.ok ? await existingResponse.json() : [];
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      const existingEmail = cleanText(existing?.email, 320).toLowerCase();

      if (existing && (existingEmail === email || isPlaceholderEmail(existingEmail))) {
        const updateResponse = await serviceRequest(
          supabaseUrl,
          serviceRoleKey,
          `leads?id=eq.${encodeURIComponent(requestedLeadId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=representation" },
            body: JSON.stringify(payload),
          },
        );
        if (!updateResponse.ok) {
          throw new Error(`Lead update failed: ${await updateResponse.text()}`);
        }
        const rows = await updateResponse.json();
        leadId = rows?.[0]?.id || requestedLeadId;
      }
    }

    if (!leadId) {
      const createResponse = await serviceRequest(supabaseUrl, serviceRoleKey, "leads", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
      if (!createResponse.ok) {
        throw new Error(`Lead creation failed: ${await createResponse.text()}`);
      }
      const rows = await createResponse.json();
      leadId = rows?.[0]?.id || "";
    }

    if (UUID_REGEX.test(sessionId)) {
      await serviceRequest(supabaseUrl, serviceRoleKey, "site_events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          session_id: sessionId,
          event_type: "form_submit",
          page_path: pagePath.startsWith("/") ? pagePath : "/",
          source: "website_form",
          referrer: trafficSource,
          metadata: { lead_id: leadId },
        }),
      }).catch(() => null);
    }

    return jsonResponse({ status: "captured", lead_id: leadId }, 201);
  } catch (error) {
    console.error("Contact capture error", error);
    return jsonResponse({ error: "Unable to capture the request" }, 500);
  }
});
