import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const EVENT_TYPES: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.failed": "failed",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "suppressed",
  "email.unsubscribed": "unsubscribed",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function verifySvixSignature(
  rawBody: string,
  webhookSecret: string,
  messageId: string,
  timestamp: string,
  signatureHeader: string,
) {
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300) {
    return false;
  }
  const encodedSecret = webhookSecret.startsWith("whsec_") ? webhookSecret.slice(6) : webhookSecret;
  let secret: Uint8Array;
  try {
    secret = decodeBase64(encodedSecret);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedPayload = `${messageId}.${timestamp}.${rawBody}`;
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload)));
  const candidates = signatureHeader
    .split(/\s+/)
    .map((part) => part.split(","))
    .filter(([version, signature]) => version === "v1" && Boolean(signature));
  return candidates.some(([, signature]) => {
    try {
      return timingSafeEqual(digest, decodeBase64(signature));
    } catch {
      return false;
    }
  });
}

function linkKey(rawUrl: string) {
  try {
    return cleanText(new URL(rawUrl).searchParams.get("ck"), 80);
  } catch {
    return "";
  }
}

serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";
  if (!supabaseUrl || !serviceRoleKey || !webhookSecret) {
    return jsonResponse({ error: "Webhook unavailable" }, 503);
  }

  const rawBody = await request.text();
  const messageId = cleanText(request.headers.get("svix-id"), 200);
  const timestamp = cleanText(request.headers.get("svix-timestamp"), 40);
  const signature = cleanText(request.headers.get("svix-signature"), 1000);
  if (!messageId || !timestamp || !signature || !await verifySvixSignature(rawBody, webhookSecret, messageId, timestamp, signature)) {
    return jsonResponse({ error: "Invalid webhook signature" }, 401);
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const providerType = cleanText(payload.type, 80);
    const eventType = EVENT_TYPES[providerType];
    if (!eventType) return jsonResponse({ status: "ignored" }, 202);
    const data = payload.data && typeof payload.data === "object"
      ? payload.data as Record<string, unknown>
      : {};
    const emailId = cleanText(data.email_id, 200);
    if (!emailId) return jsonResponse({ status: "ignored" }, 202);
    const rawLink = cleanText(data.click && typeof data.click === "object"
      ? (data.click as Record<string, unknown>).link
      : data.link, 1000);
    const occurredAtValue = cleanText(data.created_at || payload.created_at, 80);
    const occurredAt = Number.isNaN(new Date(occurredAtValue).getTime())
      ? new Date().toISOString()
      : new Date(occurredAtValue).toISOString();
    const reason = cleanText(
      data.bounce && typeof data.bounce === "object"
        ? (data.bounce as Record<string, unknown>).message
        : data.reason || data.error,
      500,
    );

    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/record_marketing_campaign_event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        event_provider_id: messageId,
        event_type_value: eventType,
        event_resend_email_id: emailId,
        event_link_key: rawLink ? linkKey(rawLink) : "",
        event_link_url: rawLink,
        event_occurred_at: occurredAt,
        event_metadata: {
          provider_type: providerType,
          reason: reason || undefined,
        },
      }),
    });
    if (!response.ok) throw new Error(`Campaign event write failed (${response.status})`);
    const recorded = await response.json();
    return jsonResponse({ status: recorded ? "recorded" : "ignored" }, recorded ? 200 : 202);
  } catch (error) {
    console.error("Resend webhook error", error);
    return jsonResponse({ error: "Unable to process webhook" }, 500);
  }
});
