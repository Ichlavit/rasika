// supabase/functions/send-quote/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-quote-webhook-secret",
  "Content-Type": "application/json",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RASIKA_LOGO_URL = "https://rasika.cl/images/svg/rasika_logo.svg";
const CHECK_ICON_URL = "https://rasika.cl/images/svg/check.svg";
const CROSS_ICON_URL = "https://rasika.cl/images/svg/cross.svg";

const MAX_VISIBLE_LIST_ITEMS = 4;

type LeadRecord = {
  id: string;
  name?: string | null;
  email?: string | null;
  company_name?: string | null;
  status?: string | null;
  quoted_price?: number | string | null;
  quoted_service?: string | null;
  quoted_currency?: string | null;
  billing_basis?: string | null;
  language?: string | null;
  service_id?: string | null;
  ai_summary?: string | null;
};

type ServiceRecord = {
  id: string;
  service_name: string;
  category?: string | null;
  public_description?: string | null;
  ai_context_description?: string | null;
  pricing_tiers?: Record<string, unknown> | null;
  inclusions?: unknown;
  exclusions?: unknown;
  tech_specs?: Record<string, unknown> | null;
  production_time_days?: Record<string, unknown> | null;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function escapeHTML(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeLanguage(value?: string | null) {
  const lang = String(value || "es").toLowerCase().trim();
  return lang === "en" ? "en" : "es";
}

function normalizePrice(value: unknown) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0 || price > 100000000) return null;
  return price;
}

function normalizeCurrency(value?: string | null) {
  const currency = String(value || "UF").toUpperCase().trim();

  if (["UF", "CLP", "USD"].includes(currency)) {
    return currency;
  }

  return "UF";
}

function normalizeBillingBasis(value?: string | null) {
  const basis = String(value || "one_time_project").toLowerCase().trim();

  if (
    [
      "one_time_project",
      "user_month",
      "user_year",
      "monthly_subscription",
      "yearly_subscription",
    ].includes(basis)
  ) {
    return basis;
  }

  return "one_time_project";
}

function formatNumberCL(value: number) {
  return new Intl.NumberFormat("es-CL").format(value);
}

function formatPriceDisplay(price: number, currency: string, billingBasis: string) {
  if (currency === "CLP") {
    const suffix =
      billingBasis === "user_month"
        ? " / usuario / mes"
        : billingBasis === "user_year"
          ? " / usuario / año"
          : billingBasis === "monthly_subscription"
            ? " / mes"
            : billingBasis === "yearly_subscription"
              ? " / año"
              : "";

    return `$${formatNumberCL(price)} CLP${suffix}`;
  }

  if (currency === "USD") {
    return `$${formatNumberCL(price)} USD`;
  }

  return `${formatNumberCL(price)} UF`;
}

function asArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim())
    : [];
}

function uniqueCleanList(items: string[]) {
  return Array.from(
    new Set(
      items
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

function buildSupabaseRestUrl(supabaseUrl: string, path: string) {
  return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${path.replace(/^\//, "")}`;
}

function buildTrackMeetingUrl(supabaseUrl: string, leadId: string) {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/track-meeting?lead_id=${encodeURIComponent(
    leadId,
  )}`;
}

async function patchLead(
  supabaseUrl: string,
  serviceKey: string,
  leadId: string,
  payload: Record<string, unknown>,
  extraFilter = "",
  prefer = "return=minimal",
) {
  const url = buildSupabaseRestUrl(
    supabaseUrl,
    `leads?id=eq.${encodeURIComponent(leadId)}${extraFilter}`,
  );

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: prefer,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Lead PATCH failed: ${await res.text()}`);
  }

  if (prefer.includes("return=representation")) {
    return await res.json();
  }

  return null;
}

async function claimQuoteJob(
  supabaseUrl: string,
  serviceKey: string,
  leadId: string,
): Promise<LeadRecord | null> {
  const claimedRows = await patchLead(
    supabaseUrl,
    serviceKey,
    leadId,
    { status: "quote processing" },
    "&status=eq.pending%20quote",
    "return=representation",
  );

  if (!Array.isArray(claimedRows) || claimedRows.length === 0) {
    return null;
  }

  return claimedRows[0] as LeadRecord;
}

async function fetchService(
  supabaseUrl: string,
  serviceKey: string,
  serviceId: string,
): Promise<ServiceRecord | null> {
  const url = buildSupabaseRestUrl(
    supabaseUrl,
    `services?id=eq.${encodeURIComponent(
      serviceId,
    )}&select=id,service_name,category,public_description,ai_context_description,pricing_tiers,inclusions,exclusions,tech_specs,production_time_days`,
  );

  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Service fetch failed: ${await res.text()}`);
  }

  const data = await res.json();
  return data?.[0] || null;
}

function renderList(items: string[]) {
  if (items.length === 0) {
    return `<p style="margin:0;color:#4a5568;font-size:14px;line-height:1.6;">N/A</p>`;
  }

  const visibleItems = items.slice(0, MAX_VISIBLE_LIST_ITEMS);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);

  return `
    <ul style="padding:0;margin:0;list-style-type:disc;padding-left:20px;">
      ${visibleItems
        .map(
          (item) =>
            `<li style="margin-bottom:8px;font-size:14px;color:#4a5568;line-height:1.6;">${escapeHTML(
              item,
            )}</li>`,
        )
        .join("")}
    </ul>
    ${
      hiddenCount > 0
        ? `<p style="margin:10px 0 0 0;color:#718096;font-size:12px;line-height:1.5;">+ ${hiddenCount} elemento(s) adicional(es) que revisaremos en la evaluación técnica.</p>`
        : ""
    }
  `;
}

function generateQuoteHTML(params: {
  leadName: string;
  company: string;
  serviceName: string;
  publicDesc: string;
  priceDisplay: string;
  lang: string;
  trackingUrl: string;
  inclusions: string[];
  exclusions: string[];
}) {
  const {
    leadName,
    company,
    serviceName,
    publicDesc,
    priceDisplay,
    lang,
    trackingUrl,
    inclusions,
    exclusions,
  } = params;

  const text: Record<string, any> = {
    es: {
      greeting: "Hola",
      intro: "Gracias por conversar con nuestro asistente virtual. Según lo analizado para",
      intro2: "hemos preparado la siguiente estimación preliminar:",
      quoteTitle: "Resumen de Cotización",
      priceLabel: "Inversión Estimada",
      incTitle: "Qué incluye",
      excTitle: "No incluye",
      cta: "Agendar Reunión",
      disclaimer:
        "*Esta es una estimación generada por IA basada en tu consulta y está sujeta a una evaluación técnica y de alcance detallada.",
      footer: "© 2026 Rasika Producciones. Todos los derechos reservados.",
    },
    en: {
      greeting: "Hello",
      intro: "Thank you for chatting with our virtual assistant. Based on our analysis for",
      intro2: "we have prepared the following preliminary estimate:",
      quoteTitle: "Quote Summary",
      priceLabel: "Estimated Investment",
      incTitle: "What is included",
      excTitle: "What is not included",
      cta: "Schedule a Meeting",
      disclaimer:
        "*This is an AI-generated estimate based on your query and is subject to a detailed technical and scope evaluation.",
      footer: "© 2026 Rasika Producciones. All rights reserved.",
    },
  };

  const t = text[lang] || text.es;

  const safeLeadName = escapeHTML(leadName || "Cliente");
  const safeCompany = escapeHTML(company || "tu empresa");
  const safeServiceName = escapeHTML(serviceName || "Servicio Rasika");
  const safePublicDesc = escapeHTML(publicDesc || "");
  const safePriceDisplay = escapeHTML(priceDisplay || "");
  const safeTrackingUrl = escapeHTML(trackingUrl);

  const incList = renderList(inclusions);
  const excList = renderList(exclusions);

  return `<!DOCTYPE html>
<html lang="${escapeHTML(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#141619;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.05);">
          <tr>
            <td align="center" style="background-color:#141619;padding:40px 20px;border-bottom:4px solid #5EA6B0;">
              <img src="${RASIKA_LOGO_URL}" alt="Rasika Producciones" width="180" style="display:block;border:0;" />
            </td>
          </tr>

          <tr>
            <td style="padding:40px 30px;">
              <p style="margin:0 0 15px 0;font-size:16px;color:#4a5568;">
                ${escapeHTML(t.greeting)} <strong>${safeLeadName}</strong>,
              </p>

              <p style="margin:0 0 30px 0;font-size:15px;color:#4a5568;line-height:1.6;">
                ${escapeHTML(t.intro)} <strong>${safeCompany}</strong>, ${escapeHTML(t.intro2)}
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <h2 style="margin:0 0 10px 0;font-size:18px;color:#141619;font-weight:700;">${escapeHTML(
                      t.quoteTitle,
                    )}</h2>
                    <h3 style="margin:0 0 10px 0;font-size:16px;color:#141619;font-weight:600;">${safeServiceName}</h3>
                    <p style="margin:0 0 15px 0;font-size:14px;color:#4a5568;line-height:1.5;">${safePublicDesc}</p>

                    <div style="background-color:#ffffff;border-left:4px solid #5EA6B0;padding:15px;border-radius:0 4px 4px 0;margin-top:20px;">
                      <span style="display:block;font-size:12px;text-transform:uppercase;color:#718096;font-weight:700;margin-bottom:5px;">${escapeHTML(
                        t.priceLabel,
                      )}</span>
                      <span style="display:block;font-size:24px;color:#5EA6B0;font-weight:800;">${safePriceDisplay}</span>
                    </div>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td width="48%" valign="top" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;">
                    <div style="display:flex;align-items:center;margin-bottom:15px;">
                      <img src="${CHECK_ICON_URL}" alt="✓" width="18" height="18" style="display:block;border:0;margin-right:8px;" />
                      <h3 style="margin:0;font-size:14px;color:#141619;font-weight:700;">${escapeHTML(
                        t.incTitle,
                      )}</h3>
                    </div>
                    ${incList}
                  </td>

                  <td width="4%"></td>

                  <td width="48%" valign="top" style="background-color:#fff5f5;border:1px solid #fed7d7;border-radius:8px;padding:20px;">
                    <div style="display:flex;align-items:center;margin-bottom:15px;">
                      <img src="${CROSS_ICON_URL}" alt="✕" width="18" height="18" style="display:block;border:0;margin-right:8px;" />
                      <h3 style="margin:0;font-size:14px;color:#141619;font-weight:700;">${escapeHTML(
                        t.excTitle,
                      )}</h3>
                    </div>
                    ${excList}
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <a href="${safeTrackingUrl}" target="_blank" style="display:inline-block;background-color:#141619;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:16px 32px;border-radius:8px;">${escapeHTML(
                      t.cta,
                    )}</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:12px;color:#a0aec0;text-align:center;line-height:1.5;">${escapeHTML(
                t.disclaimer,
              )}</p>
            </td>
          </tr>

          <tr>
            <td align="center" style="background-color:#f8fafc;padding:25px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#718096;">
                ${escapeHTML(t.footer)}<br>
                <a href="https://rasika.cl" style="color:#5EA6B0;text-decoration:none;">www.rasika.cl</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let claimedLeadId: string | null = null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const webhookSecret = Deno.env.get("QUOTE_WEBHOOK_SECRET");
  const incomingSecret = req.headers.get("x-quote-webhook-secret");

  try {
    if (!webhookSecret || incomingSecret !== webhookSecret) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
    if (!supabaseServiceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    if (!resendApiKey) throw new Error("Missing RESEND_API_KEY");

    const payload = await req.json().catch(() => null);
    const webhookRecord = payload?.record || payload;

    if (!webhookRecord?.id || !UUID_REGEX.test(String(webhookRecord.id))) {
      return jsonResponse({
        success: true,
        message: "Ignored: missing or invalid lead id.",
      });
    }

    const leadId = String(webhookRecord.id);

    const record = await claimQuoteJob(
      supabaseUrl,
      supabaseServiceKey,
      leadId,
    );

    if (!record) {
      return jsonResponse({
        success: true,
        message: "Ignored: quote already claimed, already processed, or not pending.",
      });
    }

    claimedLeadId = record.id;

    const email = String(record.email || "").trim().toLowerCase();
    const price = normalizePrice(record.quoted_price);
    const serviceId = String(record.service_id || "").trim();
    const language = normalizeLanguage(record.language);
    const quotedCurrency = normalizeCurrency(record.quoted_currency);
    const billingBasis = normalizeBillingBasis(record.billing_basis);

    if (!EMAIL_REGEX.test(email) || email === "pendiente@rasika.cl") {
      throw new Error("Invalid or placeholder email.");
    }

    if (!price) {
      throw new Error("Invalid quoted_price.");
    }

    const priceDisplay = formatPriceDisplay(price, quotedCurrency, billingBasis);

    if (!serviceId || !UUID_REGEX.test(serviceId)) {
      throw new Error("Invalid or missing service_id.");
    }

    const service = await fetchService(
      supabaseUrl,
      supabaseServiceKey,
      serviceId,
    );

    if (!service) {
      throw new Error("Service not found.");
    }

    const canonicalServiceName = service.service_name || "Servicio Rasika";

    const publicDesc =
      service.public_description ||
      record.ai_summary ||
      service.ai_context_description ||
      "";

    const inclusions = uniqueCleanList(asArray(service.inclusions));

    const exclusions = uniqueCleanList(asArray(service.exclusions)).filter(
      (item) => !inclusions.includes(item),
    );

    const trackingUrl = buildTrackMeetingUrl(supabaseUrl, record.id);

    const htmlBody = generateQuoteHTML({
      leadName: record.name || "Cliente",
      company: record.company_name || "tu empresa",
      serviceName: canonicalServiceName,
      publicDesc,
      priceDisplay,
      lang: language,
      trackingUrl,
      inclusions,
      exclusions,
    });

    const subjectLine =
      language === "en"
        ? "Your Quote from Rasika"
        : "Tu Cotización de Rasika";

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "Cotizaciones Rasika <cotizaciones@rasika.cl>",
        to: [email],
        subject: subjectLine,
        html: htmlBody,
      }),
    });

    if (!resendResponse.ok) {
      throw new Error(`Resend failed: ${await resendResponse.text()}`);
    }

    await patchLead(
      supabaseUrl,
      supabaseServiceKey,
      record.id,
      {
        status: "quote sent",
        quoted_service: canonicalServiceName,
      },
      "&status=eq.quote%20processing",
      "return=minimal",
    );

    return jsonResponse({
      success: true,
      lead_id: record.id,
      status: "quote sent",
      service_id: service.id,
      quoted_service: canonicalServiceName,
      quoted_currency: quotedCurrency,
      billing_basis: billingBasis,
      category: service.category || null,
      tracking_url: trackingUrl,
    });
  } catch (error: any) {
    console.error("send-quote error:", error?.message || error);

    if (claimedLeadId && supabaseUrl && supabaseServiceKey) {
      try {
        await patchLead(
          supabaseUrl,
          supabaseServiceKey,
          claimedLeadId,
          { status: "quote failed" },
          "&status=eq.quote%20processing",
          "return=minimal",
        );
      } catch (patchError) {
        console.error("Failed to mark quote as failed:", patchError);
      }
    }

    return jsonResponse(
      {
        success: false,
        error: error?.message || "Unknown error",
      },
      500,
    );
  }
});