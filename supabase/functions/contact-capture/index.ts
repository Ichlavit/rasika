import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERRAL_CODE_REGEX = /^[A-Za-z0-9_-]{8}$/;

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

async function findLeadByReferralCode(
  supabaseUrl: string,
  serviceRoleKey: string,
  referralCode: string,
) {
  if (!REFERRAL_CODE_REGEX.test(referralCode)) return "";

  const response = await serviceRequest(
    supabaseUrl,
    serviceRoleKey,
    `leads?referral_code=eq.${encodeURIComponent(referralCode)}&select=id&limit=1`,
  );
  if (!response.ok) return "";

  const rows = await response.json();
  return cleanText(Array.isArray(rows) ? rows[0]?.id : "", 36);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function findCampaignRecipient(
  supabaseUrl: string,
  serviceRoleKey: string,
  token: string,
) {
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(token)) return "";
  const tokenHash = await sha256(token);
  const response = await serviceRequest(
    supabaseUrl,
    serviceRoleKey,
    `marketing_campaign_recipients?tracking_token_hash=eq.${tokenHash}&select=id&limit=1`,
  );
  if (!response.ok) return "";
  const rows = await response.json();
  return cleanText(Array.isArray(rows) ? rows[0]?.id : "", 36);
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

    const action = cleanText(body.action, 32);
    const requestedLeadId = cleanText(body.lead_id, 36);
    const incomingReferralCode = cleanText(body.referral_code, 64);
    const campaignToken = cleanText(body.campaign_token, 120);

    if (action === "sync_referral") {
      if (!UUID_REGEX.test(requestedLeadId)) {
        return jsonResponse({ error: "A valid lead is required" }, 400);
      }

      const leadResponse = await serviceRequest(
        supabaseUrl,
        serviceRoleKey,
        `leads?id=eq.${encodeURIComponent(requestedLeadId)}&select=id,referral_code,referred_by_lead_id&limit=1`,
      );
      const leadRows = leadResponse.ok ? await leadResponse.json() : [];
      const lead = Array.isArray(leadRows) ? leadRows[0] : null;
      if (!lead) return jsonResponse({ error: "Lead not found" }, 404);

      let referredByLeadId = cleanText(lead.referred_by_lead_id, 36);
      if (
        !referredByLeadId &&
        REFERRAL_CODE_REGEX.test(incomingReferralCode) &&
        incomingReferralCode !== lead.referral_code
      ) {
        const candidateId = await findLeadByReferralCode(
          supabaseUrl,
          serviceRoleKey,
          incomingReferralCode,
        );
        if (candidateId && candidateId !== requestedLeadId) {
          const updateResponse = await serviceRequest(
            supabaseUrl,
            serviceRoleKey,
            `leads?id=eq.${encodeURIComponent(requestedLeadId)}&referred_by_lead_id=is.null`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Prefer: "return=representation" },
              body: JSON.stringify({ referred_by_lead_id: candidateId }),
            },
          );
          if (updateResponse.ok) {
            const updatedRows = await updateResponse.json();
            referredByLeadId = cleanText(updatedRows?.[0]?.referred_by_lead_id, 36);
          }
        }
      }

      return jsonResponse({
        status: "synced",
        referral_code: cleanText(lead.referral_code, 8),
        referred: Boolean(referredByLeadId),
      });
    }

    if (action === "sync_campaign") {
      if (!UUID_REGEX.test(requestedLeadId)) {
        return jsonResponse({ error: "A valid lead is required" }, 400);
      }

      const campaignRecipientId = await findCampaignRecipient(
        supabaseUrl,
        serviceRoleKey,
        campaignToken,
      );
      if (!campaignRecipientId) {
        return jsonResponse({ status: "not_attributed", campaign_attributed: false });
      }

      const leadResponse = await serviceRequest(
        supabaseUrl,
        serviceRoleKey,
        `leads?id=eq.${encodeURIComponent(requestedLeadId)}&select=id,marketing_campaign_recipient_id&limit=1`,
      );
      const leadRows = leadResponse.ok ? await leadResponse.json() : [];
      const lead = Array.isArray(leadRows) ? leadRows[0] : null;
      if (!lead) return jsonResponse({ error: "Lead not found" }, 404);

      const existingCampaignRecipientId = cleanText(lead.marketing_campaign_recipient_id, 36);
      if (existingCampaignRecipientId) {
        return jsonResponse({
          status: existingCampaignRecipientId === campaignRecipientId ? "already_attributed" : "preserved",
          campaign_attributed: existingCampaignRecipientId === campaignRecipientId,
        });
      }

      const updateResponse = await serviceRequest(
        supabaseUrl,
        serviceRoleKey,
        `leads?id=eq.${encodeURIComponent(requestedLeadId)}&marketing_campaign_recipient_id=is.null`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ marketing_campaign_recipient_id: campaignRecipientId }),
        },
      );
      if (!updateResponse.ok) {
        throw new Error(`Campaign attribution sync failed: ${await updateResponse.text()}`);
      }
      const updatedRows = await updateResponse.json();
      return jsonResponse({
        status: Array.isArray(updatedRows) && updatedRows.length ? "synced" : "preserved",
        campaign_attributed: Boolean(Array.isArray(updatedRows) && updatedRows.length),
      });
    }

    const name = cleanText(body.name, 120);
    const email = cleanText(body.email, 320).toLowerCase();
    const companyName = cleanText(body.company_name, 160);
    const trafficSource = cleanText(body.traffic_source, 500) || "Website";
    const language = cleanText(body.language, 2) === "en" ? "en" : "es";
    const sessionId = cleanText(body.session_id, 36);
    const pagePath = cleanText(body.page_path, 500) || "/";

    if (!name || !EMAIL_REGEX.test(email)) {
      return jsonResponse({ error: "Name and a valid email are required" }, 400);
    }

    const resolvedReferralLeadId = await findLeadByReferralCode(
      supabaseUrl,
      serviceRoleKey,
      incomingReferralCode,
    );
    const campaignRecipientId = await findCampaignRecipient(
      supabaseUrl,
      serviceRoleKey,
      campaignToken,
    );

    const payload: Record<string, unknown> = {
      name,
      email,
      company_name: companyName || "Pendiente",
      traffic_source: trafficSource,
      language,
    };
    if (campaignRecipientId) payload.marketing_campaign_recipient_id = campaignRecipientId;

    let leadId = "";
    let referralCode = "";
    if (requestedLeadId && UUID_REGEX.test(requestedLeadId)) {
      const existingResponse = await serviceRequest(
        supabaseUrl,
        serviceRoleKey,
        `leads?id=eq.${encodeURIComponent(requestedLeadId)}&select=id,email,referral_code,referred_by_lead_id&limit=1`,
      );
      const existingRows = existingResponse.ok ? await existingResponse.json() : [];
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      const existingEmail = cleanText(existing?.email, 320).toLowerCase();

      if (existing && (existingEmail === email || isPlaceholderEmail(existingEmail))) {
        const updatePayload = { ...payload };
        if (!campaignRecipientId) delete updatePayload.marketing_campaign_recipient_id;
        if (
          resolvedReferralLeadId &&
          resolvedReferralLeadId !== requestedLeadId &&
          !existing.referred_by_lead_id
        ) {
          updatePayload.referred_by_lead_id = resolvedReferralLeadId;
        }
        const updateResponse = await serviceRequest(
          supabaseUrl,
          serviceRoleKey,
          `leads?id=eq.${encodeURIComponent(requestedLeadId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=representation" },
            body: JSON.stringify(updatePayload),
          },
        );
        if (!updateResponse.ok) {
          throw new Error(`Lead update failed: ${await updateResponse.text()}`);
        }
        const rows = await updateResponse.json();
        leadId = rows?.[0]?.id || requestedLeadId;
        referralCode = cleanText(rows?.[0]?.referral_code || existing.referral_code, 8);
      }
    }

    if (!leadId) {
      if (resolvedReferralLeadId) payload.referred_by_lead_id = resolvedReferralLeadId;
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
      referralCode = cleanText(rows?.[0]?.referral_code, 8);
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
          metadata: { lead_id: leadId, marketing_campaign_recipient_id: campaignRecipientId || null },
        }),
      }).catch(() => null);
    }

    return jsonResponse({
      status: "captured",
      lead_id: leadId,
      referral_code: referralCode,
      referred: Boolean(resolvedReferralLeadId && resolvedReferralLeadId !== leadId),
      campaign_attributed: Boolean(campaignRecipientId),
    }, 201);
  } catch (error) {
    console.error("Contact capture error", error);
    return jsonResponse({ error: "Unable to capture the request" }, 500);
  }
});
