import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ContactRow = {
  id: string;
  email: string;
  full_name: string | null;
  lifecycle_stage: string;
  newsletter_status: string;
  resend_sync_status: string;
};

type ResendResources = {
  segmentId: string;
  topicId: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
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

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function resendRequest(apiKey: string, path: string, init: RequestInit = {}) {
  return fetch(`https://api.resend.com/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function updateIntegration(
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>,
) {
  await serviceRequest(supabaseUrl, serviceRoleKey, "marketing_integrations?provider=eq.resend", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
}

async function ensureResendResources(
  supabaseUrl: string,
  serviceRoleKey: string,
  resendApiKey: string,
): Promise<ResendResources> {
  const integrationResponse = await serviceRequest(
    supabaseUrl,
    serviceRoleKey,
    "marketing_integrations?provider=eq.resend&select=config&limit=1",
  );
  const integrationRows = integrationResponse.ok ? await integrationResponse.json() : [];
  const config = integrationRows?.[0]?.config || {};
  if (config.segment_id && config.topic_id) {
    return { segmentId: config.segment_id, topicId: config.topic_id };
  }

  const segmentsResponse = await resendRequest(resendApiKey, "segments");
  if (!segmentsResponse.ok) {
    throw new Error(`Resend segments unavailable (${segmentsResponse.status})`);
  }
  const segments = (await segmentsResponse.json())?.data || [];
  let segment = segments.find((item: Record<string, unknown>) =>
    String(item.name || "").toLowerCase() === "rasika newsletter"
  );
  if (!segment) {
    const createSegmentResponse = await resendRequest(resendApiKey, "segments", {
      method: "POST",
      body: JSON.stringify({ name: "Rasika Newsletter" }),
    });
    if (!createSegmentResponse.ok) {
      throw new Error(`Unable to create Resend segment (${createSegmentResponse.status})`);
    }
    segment = await createSegmentResponse.json();
  }

  const topicsResponse = await resendRequest(resendApiKey, "topics");
  if (!topicsResponse.ok) {
    throw new Error(`Resend topics unavailable (${topicsResponse.status})`);
  }
  const topics = (await topicsResponse.json())?.data || [];
  let topic = topics.find((item: Record<string, unknown>) =>
    String(item.name || "").toLowerCase() === "novedades rasika"
  );
  if (!topic) {
    const createTopicResponse = await resendRequest(resendApiKey, "topics", {
      method: "POST",
      body: JSON.stringify({
        name: "Novedades Rasika",
        description: "Articulos, servicios y eventos de aprendizaje digital y EdTech.",
        default_subscription: "opt_out",
        visibility: "public",
      }),
    });
    if (!createTopicResponse.ok) {
      throw new Error(`Unable to create Resend topic (${createTopicResponse.status})`);
    }
    topic = await createTopicResponse.json();
  }

  const resources = { segmentId: String(segment.id), topicId: String(topic.id) };
  await updateIntegration(supabaseUrl, serviceRoleKey, {
    status: "connected",
    config: { segment_id: resources.segmentId, topic_id: resources.topicId },
    last_checked_at: new Date().toISOString(),
    last_error: null,
  });
  return resources;
}

async function syncResendContact(
  resendApiKey: string,
  resources: ResendResources,
  email: string,
  fullName: string,
  unsubscribed: boolean,
) {
  const identifier = encodeURIComponent(email);
  const existingResponse = await resendRequest(resendApiKey, `contacts/${identifier}`);
  let contactId = "";

  if (existingResponse.ok) {
    const existing = await existingResponse.json();
    contactId = String(existing.id || "");
    const updateResponse = await resendRequest(resendApiKey, `contacts/${identifier}`, {
      method: "PATCH",
      body: JSON.stringify({ unsubscribed }),
    });
    if (!updateResponse.ok) {
      throw new Error(`Unable to update Resend contact (${updateResponse.status})`);
    }
  } else if (existingResponse.status === 404) {
    const createResponse = await resendRequest(resendApiKey, "contacts", {
      method: "POST",
      body: JSON.stringify({
        email,
        first_name: fullName.split(/\s+/)[0] || undefined,
        unsubscribed,
        segments: unsubscribed ? [] : [{ id: resources.segmentId }],
        topics: unsubscribed
          ? []
          : [{ id: resources.topicId, subscription: "opt_in" }],
      }),
    });
    if (!createResponse.ok) {
      throw new Error(`Unable to create Resend contact (${createResponse.status})`);
    }
    contactId = String((await createResponse.json())?.id || "");
  } else {
    throw new Error(`Unable to read Resend contact (${existingResponse.status})`);
  }

  if (!unsubscribed) {
    const segmentResponse = await resendRequest(
      resendApiKey,
      `contacts/${identifier}/segments/${resources.segmentId}`,
      { method: "POST", body: "{}" },
    );
    if (!segmentResponse.ok && segmentResponse.status !== 409) {
      throw new Error(`Unable to assign Resend segment (${segmentResponse.status})`);
    }
    const topicResponse = await resendRequest(resendApiKey, `contacts/${identifier}/topics`, {
      method: "PATCH",
      body: JSON.stringify({
        topics: [{ id: resources.topicId, subscription: "opt_in" }],
      }),
    });
    if (!topicResponse.ok) {
      throw new Error(`Unable to assign Resend topic (${topicResponse.status})`);
    }
  }

  return contactId;
}

function welcomeEmailHtml(unsubscribeUrl: string) {
  return `
    <!doctype html>
    <html lang="es">
      <body style="margin:0;background:#0a0c0e;color:#e5e7eb;font-family:Arial,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0c0e;padding:32px 16px;">
          <tr><td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#1e2226;border:1px solid #31363b;border-radius:8px;">
              <tr><td style="padding:32px;">
                <p style="margin:0 0 12px;color:#88d6e0;font-size:13px;font-weight:700;text-transform:uppercase;">Rasika Insights</p>
                <h1 style="margin:0 0 16px;color:#ffffff;font-size:28px;line-height:1.2;">Bienvenido al newsletter</h1>
                <p style="margin:0 0 18px;color:#cbd5e1;font-size:16px;line-height:1.65;">Recibiras una seleccion sobria de nuevos articulos, servicios y eventos sobre aprendizaje digital, IA educativa y automatizacion EdTech.</p>
                <p style="margin:0 0 28px;color:#cbd5e1;font-size:16px;line-height:1.65;">No enviamos correos masivos sin revision editorial. Cada envio tendra una razon concreta para llegar a tu bandeja.</p>
                <a href="https://www.rasika.cl/blog/" style="display:inline-block;background:#5ea6b0;color:#0a0c0e;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px;">Explorar Rasika Insights</a>
                <p style="margin:28px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">Puedes cancelar tu suscripcion en cualquier momento desde <a href="${unsubscribeUrl}" style="color:#88d6e0;">este enlace</a>.</p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>`;
}

async function sendWelcomeEmail(
  resendApiKey: string,
  from: string,
  email: string,
  unsubscribeUrl: string,
) {
  const response = await resendRequest(resendApiKey, "emails", {
    method: "POST",
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Bienvenido a Rasika Insights",
      html: welcomeEmailHtml(unsubscribeUrl),
      text: `Bienvenido a Rasika Insights. Recibiras nuevos articulos, servicios y eventos de aprendizaje digital. Cancelar suscripcion: ${unsubscribeUrl}`,
    }),
  });
  if (!response.ok) throw new Error(`Welcome email failed (${response.status})`);
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  const newsletterFrom = Deno.env.get("NEWSLETTER_FROM_EMAIL") ||
    "Rasika Insights <cotizaciones@rasika.cl>";
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://www.rasika.cl").replace(/\/$/, "");
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
    return jsonResponse({ error: "Newsletter service is unavailable" }, 503);
  }

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = cleanText(body.action, 20) || "subscribe";

    if (action === "unsubscribe") {
      const token = cleanText(body.token, 200);
      if (token.length < 30) return jsonResponse({ error: "Invalid unsubscribe token" }, 400);
      const tokenHash = await sha256(token);
      const contactResponse = await serviceRequest(
        supabaseUrl,
        serviceRoleKey,
        `contacts?unsubscribe_token_hash=eq.${tokenHash}&select=id,email,full_name,lifecycle_stage,newsletter_status,resend_sync_status&limit=1`,
      );
      const contacts = contactResponse.ok ? await contactResponse.json() : [];
      const contact = contacts?.[0] as ContactRow | undefined;
      if (!contact) return jsonResponse({ error: "Invalid unsubscribe token" }, 404);

      const unsubscribeResponse = await serviceRequest(supabaseUrl, serviceRoleKey, `contacts?id=eq.${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          newsletter_status: "unsubscribed",
          newsletter_unsubscribed_at: new Date().toISOString(),
          unsubscribe_token_hash: null,
        }),
      });
      if (!unsubscribeResponse.ok) throw new Error(`Contact unsubscribe failed (${unsubscribeResponse.status})`);

      try {
        const resources = await ensureResendResources(supabaseUrl, serviceRoleKey, resendApiKey);
        await syncResendContact(resendApiKey, resources, contact.email, contact.full_name || "", true);
        await serviceRequest(supabaseUrl, serviceRoleKey, `contacts?id=eq.${contact.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({
            resend_sync_status: "synced",
            resend_synced_at: new Date().toISOString(),
            resend_last_error: null,
          }),
        });
      } catch (error) {
        console.error("Resend unsubscribe sync error", error);
      }

      return jsonResponse({ status: "unsubscribed" });
    }

    if (cleanText(body.website, 100)) return jsonResponse({ status: "subscribed" }, 202);
    if (body.consent !== true) return jsonResponse({ error: "Marketing consent is required" }, 400);

    const email = cleanText(body.email, 320).toLowerCase();
    const fullName = cleanText(body.full_name, 160);
    const language = cleanText(body.language, 2) === "en" ? "en" : "es";
    const source = cleanText(body.source, 120) || "blog_newsletter";
    const sessionId = cleanText(body.session_id, 36);
    const pagePath = cleanText(body.page_path, 500) || "/blog/";
    if (!EMAIL_REGEX.test(email)) return jsonResponse({ error: "A valid email is required" }, 400);

    const existingResponse = await serviceRequest(
      supabaseUrl,
      serviceRoleKey,
      `contacts?email=eq.${encodeURIComponent(email)}&select=id,email,full_name,lifecycle_stage,newsletter_status,resend_sync_status&limit=1`,
    );
    if (!existingResponse.ok) throw new Error(`Contact lookup failed (${existingResponse.status})`);
    const existingRows = await existingResponse.json();
    const existing = existingRows?.[0] as ContactRow | undefined;
    const wasSubscribed = existing?.newsletter_status === "subscribed";
    const token = createToken();
    const tokenHash = await sha256(token);
    const now = new Date().toISOString();
    const nextLifecycle = existing?.lifecycle_stage && !["contact", "subscriber", "inactive"].includes(existing.lifecycle_stage)
      ? existing.lifecycle_stage
      : "subscriber";
    const contactPayload = {
      email,
      full_name: fullName || existing?.full_name || null,
      language,
      lifecycle_stage: nextLifecycle,
      status: "active",
      source_type: existing ? undefined : "organic",
      source_detail: source,
      newsletter_status: "subscribed",
      newsletter_consented_at: now,
      newsletter_consent_source: source,
      newsletter_unsubscribed_at: null,
      unsubscribe_token_hash: wasSubscribed ? undefined : tokenHash,
      last_seen_at: now,
    };
    const sanitizedPayload = Object.fromEntries(
      Object.entries(contactPayload).filter(([, value]) => value !== undefined),
    );

    let contact: ContactRow;
    if (existing) {
      const updateResponse = await serviceRequest(supabaseUrl, serviceRoleKey, `contacts?id=eq.${existing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(sanitizedPayload),
      });
      if (!updateResponse.ok) throw new Error(`Contact update failed (${updateResponse.status})`);
      contact = (await updateResponse.json())?.[0];
    } else {
      const createResponse = await serviceRequest(supabaseUrl, serviceRoleKey, "contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(sanitizedPayload),
      });
      if (!createResponse.ok) throw new Error(`Contact creation failed (${createResponse.status})`);
      contact = (await createResponse.json())?.[0];
    }

    let resendSynced = false;
    let resendError = "";
    try {
      const resources = await ensureResendResources(supabaseUrl, serviceRoleKey, resendApiKey);
      const resendContactId = await syncResendContact(
        resendApiKey,
        resources,
        email,
        fullName || contact.full_name || "",
        false,
      );
      await serviceRequest(supabaseUrl, serviceRoleKey, `contacts?id=eq.${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          resend_contact_id: resendContactId || null,
          resend_sync_status: "synced",
          resend_synced_at: now,
          resend_last_error: null,
        }),
      });
      resendSynced = true;

      if (!wasSubscribed) {
        const unsubscribeUrl = `${siteUrl}/newsletter/unsubscribe/?token=${encodeURIComponent(token)}`;
        await sendWelcomeEmail(resendApiKey, newsletterFrom, email, unsubscribeUrl);
      }
    } catch (error) {
      resendError = error instanceof Error ? error.message : "Resend synchronization failed";
      console.error("Newsletter Resend error", resendError);
      await serviceRequest(supabaseUrl, serviceRoleKey, `contacts?id=eq.${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          resend_sync_status: "failed",
          resend_last_error: resendError.slice(0, 500),
        }),
      });
      await updateIntegration(supabaseUrl, serviceRoleKey, {
        status: "error",
        last_checked_at: now,
        last_error: resendError.slice(0, 500),
      });
    }

    if (UUID_REGEX.test(sessionId)) {
      await serviceRequest(supabaseUrl, serviceRoleKey, "site_events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          session_id: sessionId,
          event_type: "newsletter_subscribe",
          page_path: pagePath.startsWith("/") ? pagePath : "/blog/",
          source,
          metadata: { contact_id: contact.id },
        }),
      }).catch(() => null);
    }

    return jsonResponse({
      status: wasSubscribed ? "already_subscribed" : "subscribed",
      synced: resendSynced,
    }, wasSubscribed ? 200 : 201);
  } catch (error) {
    console.error("Newsletter subscription error", error);
    return jsonResponse({ error: "Unable to update the newsletter subscription" }, 500);
  }
});
