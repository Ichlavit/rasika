import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  renderNewsletterHtml,
  renderNewsletterText,
} from "../_shared/newsletter-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAMPAIGN_KEY_REGEX = /^[a-z0-9][a-z0-9-]{2,79}$/;
type JsonRow = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function restUrl(supabaseUrl: string, path: string) {
  return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${path.replace(/^\//, "")}`;
}

async function restRequest(
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

async function restJson(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
) {
  const response = await restRequest(supabaseUrl, serviceRoleKey, path);
  if (!response.ok) throw new Error(`Database request failed (${response.status})`);
  return await response.json();
}

async function restCount(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
) {
  const response = await restRequest(supabaseUrl, serviceRoleKey, path, {
    headers: { Prefer: "count=exact", Range: "0-0" },
  });
  if (!response.ok) throw new Error(`Database count failed (${response.status})`);
  const match = response.headers.get("content-range")?.match(/\/(\d+)$/);
  if (!match) throw new Error("Database count was unavailable");
  return Number(match[1]);
}

async function requireAdmin(
  request: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) throw new Response("Authentication required", { status: 401 });
  const userResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${token}` },
  });
  if (!userResponse.ok) throw new Response("Authentication required", { status: 401 });
  const user = await userResponse.json();
  const userId = cleanText(user?.id, 36);
  const admins = await restJson(
    supabaseUrl,
    serviceRoleKey,
    `ai_radar_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`,
  );
  if (!Array.isArray(admins) || admins.length !== 1) {
    throw new Response("Administrator access required", { status: 403 });
  }
  return user;
}

async function getCampaign(
  campaignKey: string,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const campaigns = await restJson(
    supabaseUrl,
    serviceRoleKey,
    `marketing_campaigns?campaign_key=eq.${encodeURIComponent(campaignKey)}&select=*&limit=1`,
  );
  const campaign = Array.isArray(campaigns) ? campaigns[0] : null;
  if (!campaign) throw new Response("Campaign not found", { status: 404 });
  return campaign as JsonRow;
}

async function getAudienceSummary(
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const base = "contacts?tags=cs.{OTEC}&select=id";
  const [candidates, active, consented, eligible] = await Promise.all([
    restCount(supabaseUrl, serviceRoleKey, base),
    restCount(supabaseUrl, serviceRoleKey, `${base}&status=eq.active`),
    restCount(
      supabaseUrl,
      serviceRoleKey,
      `${base}&status=eq.active&newsletter_status=eq.subscribed&newsletter_consented_at=not.is.null`,
    ),
    restCount(
      supabaseUrl,
      serviceRoleKey,
      `${base}&status=eq.active&newsletter_status=eq.subscribed&newsletter_consented_at=not.is.null&deliverability_status=not.in.(bounced,complained,suppressed)`,
    ),
  ]);
  return {
    candidates,
    eligible,
    excluded: candidates - eligible,
    exclusions: {
      inactive_or_suppressed: candidates - active,
      consent_required: active - consented,
      deliverability_blocked: consented - eligible,
    },
  };
}

async function getCampaignMetrics(
  campaignId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const [recipients, events] = await Promise.all([
    restJson(supabaseUrl, serviceRoleKey, `marketing_campaign_recipients?campaign_id=eq.${campaignId}&select=id,status,open_count,click_count`),
    restJson(supabaseUrl, serviceRoleKey, `marketing_campaign_events?campaign_id=eq.${campaignId}&select=event_type,link_key`),
  ]);
  const recipientRows = Array.isArray(recipients) ? recipients as JsonRow[] : [];
  const eventRows = Array.isArray(events) ? events as JsonRow[] : [];
  const recipientIds = recipientRows.map((row) => cleanText(row.id, 36)).filter(Boolean);
  const relationFilter = recipientIds.length ? `in.(${recipientIds.join(",")})` : "eq.00000000-0000-0000-0000-000000000000";
  const [leads, quotes] = await Promise.all([
    restJson(supabaseUrl, serviceRoleKey, `leads?marketing_campaign_recipient_id=${relationFilter}&select=id,status`),
    restJson(supabaseUrl, serviceRoleKey, `quotes?marketing_campaign_recipient_id=${relationFilter}&select=id,status`),
  ]);
  const countEvent = (type: string) => eventRows.filter((event) => event.event_type === type).length;
  const clicksByBlock: Record<string, number> = {};
  for (const event of eventRows) {
    if (event.event_type !== "clicked") continue;
    const key = cleanText(event.link_key, 80) || "unclassified";
    clicksByBlock[key] = (clicksByBlock[key] || 0) + 1;
  }
  return {
    recipients: recipientRows.length,
    sent: countEvent("sent"),
    delivered: countEvent("delivered"),
    unique_opens: recipientRows.filter((row) => Number(row.open_count) > 0).length,
    unique_clicks: recipientRows.filter((row) => Number(row.click_count) > 0).length,
    bounces: countEvent("bounced"),
    complaints: countEvent("complained"),
    unsubscribes: countEvent("unsubscribed"),
    clicks_by_block: clicksByBlock,
    leads: Array.isArray(leads) ? leads.length : 0,
    quotes: Array.isArray(quotes) ? quotes.length : 0,
    meeting_clicks: Array.isArray(leads)
      ? leads.filter((lead: JsonRow) => lead.status === "clicked scheduling link").length
      : 0,
  };
}

function quotaHeaders(response: Response) {
  return {
    daily: response.headers.get("x-resend-daily-quota"),
    monthly: response.headers.get("x-resend-monthly-quota"),
  };
}

async function campaignView(
  campaignKey: string,
  supabaseUrl: string,
  serviceRoleKey: string,
  siteUrl: string,
  resendConfigured: boolean,
  webhookConfigured: boolean,
) {
  const campaign = await getCampaign(campaignKey, supabaseUrl, serviceRoleKey);
  const [links, audience, metrics] = await Promise.all([
    restJson(supabaseUrl, serviceRoleKey, `marketing_campaign_links?campaign_id=eq.${campaign.id}&select=link_key,block_type,label,destination_url,position&order=position.asc`),
    getAudienceSummary(supabaseUrl, serviceRoleKey),
    getCampaignMetrics(String(campaign.id), supabaseUrl, serviceRoleKey),
  ]);
  const previewHtml = renderNewsletterHtml({
    campaignKey,
    content: campaign.content_json as never,
    unsubscribeUrl: `${siteUrl}/newsletter/unsubscribe/?preview=1`,
    siteUrl,
    testMode: true,
  });
  return {
    campaign,
    links,
    audience,
    metrics,
    integration: { resend_configured: resendConfigured, webhook_configured: webhookConfigured },
    preview_html: previewHtml,
  };
}

async function sendTest(
  body: JsonRow,
  user: JsonRow,
  campaign: JsonRow,
  supabaseUrl: string,
  serviceRoleKey: string,
  resendApiKey: string,
  siteUrl: string,
) {
  const email = cleanText(body.email, 320).toLowerCase();
  if (!EMAIL_REGEX.test(email)) return jsonResponse({ error: "A valid test email is required" }, 400);
  if (!resendApiKey) return jsonResponse({ error: "Resend is not configured" }, 503);

  const campaignKey = String(campaign.campaign_key);
  const unsubscribeUrl = `${siteUrl}/newsletter/unsubscribe/?preview=1`;
  const html = renderNewsletterHtml({
    campaignKey,
    content: campaign.content_json as never,
    unsubscribeUrl,
    siteUrl,
    testMode: true,
  });
  const text = renderNewsletterText({
    campaignKey,
    content: campaign.content_json as never,
    unsubscribeUrl,
    siteUrl,
    testMode: true,
  });
  const from = `${cleanText(campaign.from_name, 120) || "Rasika Insights"} <${cleanText(campaign.from_email, 320) || "newsletter@rasika.cl"}>`;
  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      reply_to: cleanText(campaign.reply_to, 320) || undefined,
      subject: `[PRUEBA] ${cleanText(campaign.subject, 180)}`,
      html,
      text,
      tags: [
        { name: "campaign", value: campaignKey },
        { name: "mode", value: "test" },
      ],
    }),
  });
  const quotas = quotaHeaders(resendResponse);
  const result = await resendResponse.json().catch(() => ({}));
  if (!resendResponse.ok) {
    return jsonResponse({ error: "Resend rejected the test email", detail: result, quotas }, 502);
  }

  const now = new Date().toISOString();
  await Promise.all([
    restRequest(supabaseUrl, serviceRoleKey, `marketing_campaigns?id=eq.${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        html_content: html,
        text_content: text,
        test_sent_at: now,
        test_recipient_count: Number(campaign.test_recipient_count || 0) + 1,
        safety_status: "test_ready",
        metrics: { ...(campaign.metrics as JsonRow || {}), last_test_quota: quotas },
      }),
    }),
    restRequest(supabaseUrl, serviceRoleKey, "marketing_campaign_events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        provider_event_id: `test-${crypto.randomUUID()}`,
        campaign_id: campaign.id,
        event_type: "test_sent",
        resend_email_id: cleanText(result.id, 160) || null,
        occurred_at: now,
        metadata: { recipient: email, admin_user_id: user.id, quotas },
      }),
    }),
  ]);
  return jsonResponse({ status: "test_sent", email, resend_email_id: result.id, quotas });
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(request.method)) return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  const resendConfigured = Boolean(resendApiKey);
  const webhookConfigured = Boolean(Deno.env.get("RESEND_WEBHOOK_SECRET"));
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://www.rasika.cl").replace(/\/$/, "");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Campaign administration unavailable" }, 503);

  try {
    const user = await requireAdmin(request, supabaseUrl, serviceRoleKey);
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.json().catch(() => ({})) as JsonRow : {};
    const campaignKey = cleanText(body.campaign_key || url.searchParams.get("campaign_key") || "otec-insights-01", 80);
    if (!CAMPAIGN_KEY_REGEX.test(campaignKey)) return jsonResponse({ error: "Invalid campaign key" }, 400);

    if (request.method === "GET") {
      return jsonResponse(await campaignView(
        campaignKey,
        supabaseUrl,
        serviceRoleKey,
        siteUrl,
        resendConfigured,
        webhookConfigured,
      ));
    }

    const action = cleanText(body.action, 40);
    const campaign = await getCampaign(campaignKey, supabaseUrl, serviceRoleKey);
    if (action === "send_test") {
      return await sendTest(body, user, campaign, supabaseUrl, serviceRoleKey, resendApiKey, siteUrl);
    }
    return jsonResponse({ error: "Unsupported campaign action" }, 400);
  } catch (error) {
    if (error instanceof Response) {
      return jsonResponse({ error: await error.text() }, error.status);
    }
    console.error("Campaign admin error", error);
    return jsonResponse({ error: "Unable to manage campaign" }, 500);
  }
});
