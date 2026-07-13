// supabase/functions/track-meeting/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GOOGLE_BOOKING_URL = Deno.env.get("GOOGLE_BOOKING_URL") || "";
const FALLBACK_URL = "https://rasika.cl";

function getSafeRedirectUrl(value: string | null | undefined) {
  try {
    if (!value) return FALLBACK_URL;
    return new URL(value).toString();
  } catch {
    return FALLBACK_URL;
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHTML(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildSupabaseRestUrl(supabaseUrl: string, path: string) {
  return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${path.replace(/^\//, "")}`;
}

function buildBookingUrl(lead: any) {
  const bookingUrl = new URL(getSafeRedirectUrl(GOOGLE_BOOKING_URL));

  const name = String(lead?.name || "").trim();
  const email = String(lead?.email || "").trim();

  if (name && name !== "Visitante Anónimo") {
    bookingUrl.searchParams.set("name", name);
  }

  if (email && !email.includes("pendiente@rasika.cl")) {
    bookingUrl.searchParams.set("email", email);
  }

  return bookingUrl.toString();
}

async function fetchLead(supabaseUrl: string, serviceKey: string, leadId: string) {
  const url = buildSupabaseRestUrl(
    supabaseUrl,
    `leads?id=eq.${encodeURIComponent(
      leadId,
    )}&select=id,name,email,company_name,status,ai_summary,quoted_price,quoted_service,service_id,services(service_name,category,public_description)`,
  );

  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Lead fetch failed: ${await res.text()}`);
  }

  const data = await res.json();
  return data?.[0] || null;
}

async function fetchChatHistory(supabaseUrl: string, serviceKey: string, leadId: string) {
  const url = buildSupabaseRestUrl(
    supabaseUrl,
    `chat_messages?lead_id=eq.${encodeURIComponent(leadId)}&order=created_at.asc`,
  );

  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Chat history fetch failed: ${await res.text()}`);
  }

  return await res.json();
}

async function patchLeadStatus(supabaseUrl: string, serviceKey: string, leadId: string) {
  const url = buildSupabaseRestUrl(
    supabaseUrl,
    `leads?id=eq.${encodeURIComponent(leadId)}`,
  );

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      status: "clicked scheduling link",
    }),
  });

  if (!res.ok) {
    throw new Error(`Lead status patch failed: ${await res.text()}`);
  }
}

function renderChatHistory(chatData: any[], leadName: string) {
  if (!Array.isArray(chatData) || chatData.length === 0) {
    return "<p style='color:#a0aec0;margin:0;'>No hay historial registrado.</p>";
  }

  return chatData
    .map((msg: any) => {
      const role = msg.role === "user" ? leadName || "Cliente" : "CourseMentor";
      const color = msg.role === "user" ? "#2b6cb0" : "#2d3748";
      const content = escapeHTML(msg.content || "");

      return `
        <div style="margin-bottom:10px;line-height:1.5;">
          <strong style="color:${color};">${escapeHTML(role)}:</strong>
          <span style="color:#4a5568;">${content}</span>
        </div>
      `;
    })
    .join("");
}

function buildInternalEmailHTML(lead: any, chatData: any[]) {
  const leadName = lead?.name || "Cliente";
  const company = lead?.company_name || "No especificada";
  const email = lead?.email || "No especificado";
  const serviceName =
    lead?.services?.service_name ||
    lead?.quoted_service ||
    "Servicio no especificado";
  const serviceCategory = lead?.services?.category || "No especificada";
  const quotedPrice = lead?.quoted_price ?? "No especificado";
  const aiSummary = lead?.ai_summary || "No hay resumen disponible.";
  const chatHtml = renderChatHistory(chatData, leadName);

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    </head>
    <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#141619;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.06);">
              <tr>
                <td style="background:#141619;padding:28px 24px;border-bottom:4px solid #5EA6B0;">
                  <h1 style="margin:0;color:#ffffff;font-size:22px;">🔥 Lead interesado en agendar reunión</h1>
                  <p style="margin:8px 0 0 0;color:#a0aec0;font-size:14px;">El prospecto hizo clic en “Agendar Reunión” desde la cotización.</p>
                </td>
              </tr>

              <tr>
                <td style="padding:28px 24px;">
                  <h2 style="margin:0 0 14px 0;font-size:18px;color:#141619;">Datos del lead</h2>

                  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
                    <tr>
                      <td style="padding:10px 14px;font-weight:bold;color:#4a5568;width:38%;">Nombre</td>
                      <td style="padding:10px 14px;color:#141619;">${escapeHTML(leadName)}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 14px;font-weight:bold;color:#4a5568;">Empresa</td>
                      <td style="padding:10px 14px;color:#141619;">${escapeHTML(company)}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 14px;font-weight:bold;color:#4a5568;">Email</td>
                      <td style="padding:10px 14px;color:#141619;"><a href="mailto:${escapeHTML(email)}" style="color:#5EA6B0;">${escapeHTML(email)}</a></td>
                    </tr>
                    <tr>
                      <td style="padding:10px 14px;font-weight:bold;color:#4a5568;">Servicio cotizado</td>
                      <td style="padding:10px 14px;color:#141619;">${escapeHTML(serviceName)}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 14px;font-weight:bold;color:#4a5568;">Categoría</td>
                      <td style="padding:10px 14px;color:#141619;">${escapeHTML(serviceCategory)}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 14px;font-weight:bold;color:#4a5568;">Monto estimado</td>
                      <td style="padding:10px 14px;color:#141619;">${escapeHTML(quotedPrice)} UF/CLP</td>
                    </tr>
                  </table>

                  <h2 style="margin:0 0 10px 0;font-size:18px;color:#141619;">🧠 Resumen IA para preparar la reunión</h2>
                  <div style="font-size:15px;line-height:1.6;background:#fffbdd;padding:16px;border-left:4px solid #f6e05e;border-radius:6px;margin-bottom:24px;color:#4a5568;">
                    ${escapeHTML(aiSummary)}
                  </div>

                  <h2 style="margin:0 0 10px 0;font-size:18px;color:#141619;">💬 Historial de conversación</h2>
                  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;max-height:480px;overflow-y:auto;font-size:14px;">
                    ${chatHtml}
                  </div>
                </td>
              </tr>

              <tr>
                <td style="background:#f8fafc;padding:18px 24px;border-top:1px solid #e2e8f0;text-align:center;color:#718096;font-size:12px;">
                  CourseMentor · Rasika Producciones
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

async function notifySales(params: {
  resendApiKey: string;
  salesEmail: string;
  lead: any;
  chatData: any[];
}) {
  const { resendApiKey, salesEmail, lead, chatData } = params;

  const companyOrName =
    lead?.company_name ||
    lead?.name ||
    "Nuevo lead";

  const emailHtml = buildInternalEmailHTML(lead, chatData);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: "CourseMentor Bot <cotizaciones@rasika.cl>",
      to: [salesEmail],
      subject: `🔥 Click en agendar reunión: ${companyOrName}`,
      html: emailHtml,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend internal notification failed: ${await res.text()}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let redirectUrl = getSafeRedirectUrl(GOOGLE_BOOKING_URL);

  try {
    const url = new URL(req.url);
    const leadId = url.searchParams.get("lead_id");

    if (!leadId || !UUID_REGEX.test(leadId)) {
      return Response.redirect(getSafeRedirectUrl(redirectUrl), 302);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const salesEmail = Deno.env.get("SALES_EMAIL") || "jose.contreras@rasika.cl";

    if (!supabaseUrl || !supabaseServiceKey || !resendApiKey) {
      return Response.redirect(redirectUrl, 302);
    }

    const lead = await fetchLead(supabaseUrl, supabaseServiceKey, leadId);

    if (!lead) {
      return Response.redirect(redirectUrl, 302);
    }

    redirectUrl = buildBookingUrl(lead);

    const chatData = await fetchChatHistory(
      supabaseUrl,
      supabaseServiceKey,
      leadId,
    );

    await patchLeadStatus(
      supabaseUrl,
      supabaseServiceKey,
      leadId,
    );

    await notifySales({
      resendApiKey,
      salesEmail,
      lead,
      chatData,
    });

    return Response.redirect(redirectUrl, 302);
  } catch (error) {
    console.error("track-meeting error:", error);
    return Response.redirect(redirectUrl, 302);
  }
});