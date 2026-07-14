// supabase/functions/openai-proxy/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, openai-beta, x-target-url, x-lead-id, x-client-event-id',
}

const ALLOWED_TARGETS = [
  'https://api.openai.com/v1/responses',
  'https://api.openai.com/v1/files'
];

const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ServiceRecord = {
  id: string;
  service_name: string;
  category: string | null;
  pricing_tiers: any;
};

type QuoteRecord = {
  id: string;
  lead_id: string;
  service_id: string | null;
  status: string;
  quoted_service: string | null;
  quoted_price: number | string | null;
  quoted_currency: string | null;
  billing_basis: string | null;
  ai_summary: string | null;
  language: string | null;
};

function cleanText(value: string = '') {
  return String(value)
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeUiAction(value: any) {
  if (!value || typeof value !== "object") return null;

  const type = String(value.type || "").trim();
  const id = String(value.id || "").trim();

  if (
    !["open_demo", "navigate_to_page", "scroll_to_section"].includes(type) ||
    !id ||
    id.length > 120 ||
    !/^[a-z0-9_/-]+$/i.test(id)
  ) {
    return null;
  }

  return { type, id };
}

function isPlaceholder(value: unknown) {
  const v = String(value || "").trim().toLowerCase();

  return (
    !v ||
    v === "pendiente" ||
    v === "desconocido" ||
    v === "desconocida" ||
    v === "visitante" ||
    v === "visitante anónimo" ||
    v === "visitante anonimo" ||
    v === "usuario" ||
    v === "cliente" ||
    v === "pendiente@rasika.cl"
  );
}

function normalizeLower(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function mentionsInteractiveNeed(value: unknown) {
  const t = normalizeLower(value);

  return [
    "scorm",
    "lms",
    "evaluacion",
    "evaluaciones",
    "prueba",
    "quiz",
    "quizzes",
    "desafio",
    "desafios",
    "actividad",
    "actividades",
    "interactividad",
    "interactivo",
    "interactiva",
    "reporte",
    "reportes",
    "trazabilidad",
    "seguimiento",
    "certificacion",
    "certificar"
  ].some((term) => t.includes(term));
}

function mentionsSoftwareSimulationNeed(value: unknown) {
  const t = normalizeLower(value);

  return [
    "software",
    "plataforma",
    "erp",
    "sistema",
    "interfaz",
    "click",
    "clic",
    "validacion",
    "sandbox",
    "simular pantalla",
    "simular sistema",
    "practicar en la plataforma",
    "practicar en el sistema",
    "flujo de software",
    "replicar software",
    "replicar plataforma"
  ].some((term) => t.includes(term));
}

function extractBundleTotalValues(service: ServiceRecord) {
  const totals = service?.pricing_tiers?.bundle_totals_uf;

  if (!totals || typeof totals !== "object") return [];

  return Object.values(totals)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function priceMatchesKnownBundleTotal(service: ServiceRecord, price: number) {
  const totals = extractBundleTotalValues(service);

  if (totals.length === 0) {
    return true;
  }

  return totals.some((value) => Math.abs(value - price) < 0.001);
}

async function fetchLead(
  supabaseUrl: string,
  serviceKey: string,
  leadId: string
) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/leads?id=eq.${leadId}&select=*`,
    {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    }
  );  

  if (!res.ok) {
    throw new Error('Failed to fetch lead');
  }

  const data = await res.json();
  return data?.[0] || null;
}

async function countUserMessages(
  supabaseUrl: string,
  serviceKey: string,
  leadId: string
): Promise<number> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/chat_messages?lead_id=eq.${encodeURIComponent(
      leadId,
    )}&role=eq.user&select=id`,
    {
      method: "GET",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "count=exact",
      },
    },
  );

  if (!res.ok) {
    console.error("Failed to count user messages:", await res.text());
    return 0;
  }

  const contentRange = res.headers.get("content-range") || "";
  const match = contentRange.match(/\/(\d+)$/);

  if (match && match[1]) {
    return Number(match[1]);
  }

  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

async function hasFormExtension(
  supabaseUrl: string,
  serviceKey: string,
  leadId: string
): Promise<boolean> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/chat_messages?lead_id=eq.${encodeURIComponent(
      leadId,
    )}&role=eq.system&select=content`,
    {
      method: "GET",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    },
  );

  if (!res.ok) {
    console.error("Failed to check form extension:", await res.text());
    return false;
  }

  const rows = await res.json().catch(() => []);

  return Array.isArray(rows) && rows.some((row) => {
    return String(row?.content || "").trim() === "FORM_EXTENSION_GRANTED";
  });
}

function buildLimitReachedResponse() {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text:
                "Llegamos al límite de esta conversación. Para continuar, te invitamos a agendar una reunión.",
            },
          ],
        },
      ],
      _meta: {
        limit_reached: true,
      },
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    },
  );
}

async function fetchService(
  supabaseUrl: string,
  serviceKey: string,
  serviceId: string
): Promise<ServiceRecord | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/services?id=eq.${serviceId}&select=id,service_name,category,pricing_tiers`,
    {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    }
  );

  if (!res.ok) return null;

  const data = await res.json();

  if (!data || !data.length) return null;

  return data[0] as ServiceRecord;
}

async function createQuote(
  supabaseUrl: string,
  serviceKey: string,
  payload: Record<string, unknown>
): Promise<QuoteRecord | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/quotes`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    throw new Error(`Quote insert failed: ${await res.text()}`);
  }

  const data = await res.json();
  return data?.[0] || null;
}

async function patchQuoteStatus(
  supabaseUrl: string,
  serviceKey: string,
  quoteId: string,
  status: string
) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/quotes?id=eq.${encodeURIComponent(quoteId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status }),
    },
  );

  if (!res.ok) {
    throw new Error(`Quote status update failed: ${await res.text()}`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const targetUrl = req.headers.get('x-target-url');

    if (
      !targetUrl ||
      !ALLOWED_TARGETS.includes(targetUrl)
    ) {
      throw new Error('Invalid target URL');
    }

    const openAiKey =
      Deno.env.get('OPENAI_API_KEY');

    const supabaseUrl =
      Deno.env.get('SUPABASE_URL');

    const supabaseServiceKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const leadId =
      req.headers.get('x-lead-id');

    if (!openAiKey) {
      throw new Error('Missing OPENAI_API_KEY');
    }

    const headers = new Headers();

    headers.set(
      'Authorization',
      `Bearer ${openAiKey}`
    );

    const contentType =
      req.headers.get('content-type');

    if (contentType) {
      headers.set('Content-Type', contentType);
    }

    const openaiBeta =
      req.headers.get('openai-beta');

    if (openaiBeta) {
      headers.set('OpenAI-Beta', openaiBeta);
    }

    let body: any = undefined;

    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD'
    ) {
      const clonedReq = req.clone();

      try {
        body = await clonedReq.json();

        if (targetUrl.includes('/responses')) {
          delete body.response_format;

          body.text = {
            ...(body.text || {}),
            format: {
              type: "json_object"
            }
          };

          const jsonInstruction = {
            type: "input_text",
            text:
              "IMPORTANT: Return one valid JSON object only. Do not use markdown. Do not write text outside the JSON object."
          };

          if (Array.isArray(body.input)) {
            body.input = body.input.map((item: any, index: number) => {
              if (index !== 0) return item;

              if (Array.isArray(item.content)) {
                return {
                  ...item,
                  content: [jsonInstruction, ...item.content]
                };
              }

              if (typeof item.content === "string") {
                return {
                  ...item,
                  content: [
                    jsonInstruction,
                    {
                      type: "input_text",
                      text: item.content
                    }
                  ]
                };
              }

              return item;
            });
          }
        }
      } catch {
        body = req.body;
      }
    }

// Hard cost-control limit: max 15 user messages per lead/session.
// Extra 5 messages if triggers the Form after limit reached
// The frontend saves the user message before calling this proxy,
// so count >= 15 means the current request should be blocked.
if (
  targetUrl.includes("/responses") &&
  leadId &&
  supabaseUrl &&
  supabaseServiceKey
) {
  const userMessageCount = await countUserMessages(
    supabaseUrl,
    supabaseServiceKey,
    leadId,
  );

  const extensionGranted = await hasFormExtension(
    supabaseUrl,
    supabaseServiceKey,
    leadId,
  );

  const maxUserMessages = extensionGranted ? 20 : 15;

  if (userMessageCount >= maxUserMessages) {
    return buildLimitReachedResponse();
  }
}

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body:
        body && typeof body === 'object'
          ? JSON.stringify(body)
          : body
    });

    if (!targetUrl.includes('/responses')) {
      const responseHeaders =
        new Headers(response.headers);

      responseHeaders.set(
        'Access-Control-Allow-Origin',
        '*'
      );

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders
      });
    }

    if (!response.ok) {
      const errorText = await response.text();

      return new Response(
        JSON.stringify({
          error: errorText || 'OpenAI request failed'
        }),
        {
          status: response.status,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    const data = await response.json();

    let botMsg = '';
    let targetContentObj: any = null;

    if (data.output) {
      for (const output of data.output) {
        if (
          output.type === 'message' &&
          output.role === 'assistant'
        ) {
          for (const content of output.content || []) {
            if (content.type === 'output_text') {
              botMsg = content.text || '';
              targetContentObj = content;
              break;
            }
          }
        }
      }
    }

    if (!botMsg || !leadId) {
      if (targetContentObj) {
        targetContentObj.text =
          "Lo siento, ocurrió un problema.";
      }

      return new Response(
        JSON.stringify(data),
        {
          status: response.status,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    if (
      !supabaseUrl ||
      !supabaseServiceKey
    ) {
      throw new Error('Missing Supabase env vars');
    }

    const existingLead = await fetchLead(
      supabaseUrl,
      supabaseServiceKey,
      leadId
    );

    if (!existingLead) {
      throw new Error('Lead not found');
    }

    let parsed: any = null;

    try {
      parsed = JSON.parse(botMsg);
    } catch (err) {
      console.error(
        'Invalid JSON response:',
        err
      );

      parsed = {
        assistant_response:
          "Lo siento, tuve un problema procesando la respuesta.",
        profile_update: {},
        quote_request: {}
      };
    }

    const assistantResponse =
      cleanText(
        parsed?.assistant_response || ''
      );

    const profileUpdate =
      parsed?.profile_update || {};

    const quoteRequest =
      parsed?.quote_request || {};

    const uiAction =
      sanitizeUiAction(parsed?.ui_action);

    if (uiAction) {
      data._ui_action = uiAction;
    }

    let updatePayload: any = {};
    let createdQuote: QuoteRecord | null = null;

    if (
      profileUpdate.name &&
      isPlaceholder(existingLead.name)
    ) {
      updatePayload.name =
        cleanText(profileUpdate.name)
          .slice(0, 120);
    }

    if (
      profileUpdate.company_name &&
      isPlaceholder(existingLead.company_name)
    ) {
      updatePayload.company_name =
        cleanText(profileUpdate.company_name)
          .slice(0, 180);
    }

    if (
      profileUpdate.email &&
      EMAIL_REGEX.test(String(profileUpdate.email)) &&
      isPlaceholder(existingLead.email)
    ) {
      updatePayload.email =
        cleanText(profileUpdate.email)
          .toLowerCase();
    }

    if (
      profileUpdate.language &&
      ['es', 'en'].includes(
        String(profileUpdate.language)
          .toLowerCase()
      )
    ) {
      updatePayload.language =
        String(profileUpdate.language)
          .toLowerCase();
    }

    if (
  quoteRequest.should_send === true
    ) {
      let validatedServiceId = null;
      let validatedPrice = null;
      let selectedService: ServiceRecord | null = null;

    const rawCurrency = String(
    quoteRequest.quoted_currency || 'UF'
    ).trim().toUpperCase();

    const validatedCurrency =
    ['UF', 'CLP', 'USD'].includes(rawCurrency)
      ? rawCurrency
      : 'UF';

    const rawBillingBasis = String(
    quoteRequest.billing_basis || ''
    ).trim().toLowerCase();

    const validatedBillingBasis =
    [
      'one_time_project',
      'user_month',
      'user_year',
      'monthly_subscription',
      'yearly_subscription'
    ].includes(rawBillingBasis)
      ? rawBillingBasis
      : (
          validatedCurrency === 'CLP'
            ? 'user_month'
            : 'one_time_project'
        );

  if (
    quoteRequest.service_id &&
    UUID_REGEX.test(
      String(quoteRequest.service_id)
    )
  ) {
    validatedServiceId =
      String(quoteRequest.service_id);
  }

  if (
    typeof quoteRequest.quoted_price === 'number' &&
    quoteRequest.quoted_price > 0
  ) {
    if (
      validatedCurrency === 'UF' &&
      quoteRequest.quoted_price < 100000
    ) {
      validatedPrice = quoteRequest.quoted_price;
    }

    if (
      validatedCurrency === 'CLP' &&
      quoteRequest.quoted_price < 100000000
    ) {
      validatedPrice = quoteRequest.quoted_price;
    }

    if (
      validatedCurrency === 'USD' &&
      quoteRequest.quoted_price < 1000000
    ) {
      validatedPrice = quoteRequest.quoted_price;
    }
  }

  if (validatedServiceId) {
    selectedService = await fetchService(
      supabaseUrl,
      supabaseServiceKey,
      validatedServiceId
    );
  }

  const finalName =
    updatePayload.name ||
    existingLead.name;

  const finalCompany =
    updatePayload.company_name ||
    existingLead.company_name;

  const finalEmail =
    updatePayload.email ||
    existingLead.email;

  const serviceCategory =
    normalizeLower(selectedService?.category);

  const serviceName =
    selectedService?.service_name || "";

  const quoteTextForGuards =
    [
      assistantResponse,
      quoteRequest.summary,
      serviceName
    ].join(" ");

  const normalizedQuoteText =
    normalizeLower(quoteTextForGuards);

  const needsInteractive =
    mentionsInteractiveNeed(quoteTextForGuards);

  const needsSoftwareSimulation =
    mentionsSoftwareSimulationNeed(quoteTextForGuards);

  const quoteTextDescribesBundle =
    normalizedQuoteText.includes("bundle") ||
    normalizedQuoteText.includes("paquete") ||
    normalizedQuoteText.includes("scorm/html en rise +") ||
    normalizedQuoteText.includes("scorm/html personalizado +") ||
    normalizedQuoteText.includes("scorm") ||
    normalizedQuoteText.includes("rise");

  const selectedStandaloneVideoForInteractiveNeed =
    serviceCategory === "video" &&
    needsInteractive &&
    !quoteTextDescribesBundle;

  const selectedSimulationWithoutSoftwareNeed =
    serviceCategory === "simulation" &&
    !needsSoftwareSimulation;

  const selectedBundleWithInvalidTotal = false;

  const bundlePriceNeedsReview =
  serviceCategory === "bundle" &&
  validatedPrice !== null &&
  selectedService &&
  !priceMatchesKnownBundleTotal(selectedService, validatedPrice);

  const selectedSaasWithWrongCurrency =
    serviceCategory === "saas" &&
    validatedCurrency !== 'CLP';

  const selectedProjectWithWrongBilling =
    serviceCategory !== "saas" &&
    validatedBillingBasis !== 'one_time_project';

  const canGenerateQuote =
    !isPlaceholder(finalName) &&
    !isPlaceholder(finalCompany) &&
    !isPlaceholder(finalEmail) &&
    EMAIL_REGEX.test(String(finalEmail)) &&
    validatedServiceId &&
    validatedPrice &&
    selectedService &&
    !selectedStandaloneVideoForInteractiveNeed &&
    !selectedSimulationWithoutSoftwareNeed &&
    !selectedBundleWithInvalidTotal &&
    !selectedSaasWithWrongCurrency &&
    !selectedProjectWithWrongBilling;

  if (canGenerateQuote) {
    const quoteService = selectedService as ServiceRecord;

    updatePayload.status =
      'pending quote';

    updatePayload.service_id =
      validatedServiceId;

    updatePayload.quoted_price =
      validatedPrice;

    updatePayload.quoted_currency =
      validatedCurrency;

    updatePayload.billing_basis =
      validatedBillingBasis;

    if (quoteRequest.summary) {
      updatePayload.ai_summary =
        cleanText(quoteRequest.summary)
          .slice(0, 1500);
    }

    if (bundlePriceNeedsReview) {
  const reviewNote =
    " Nota interna: el precio propuesto no calza exactamente con un total directo de bundle_totals_uf para el servicio seleccionado. Revisar alcance y matriz antes de la reunión.";

  updatePayload.ai_summary =
    ((updatePayload.ai_summary || "") + reviewNote).slice(0, 1500);
    }
    
    updatePayload.quoted_service =
      quoteService.service_name;

    createdQuote = await createQuote(
      supabaseUrl,
      supabaseServiceKey,
      {
        lead_id: leadId,
        service_id: validatedServiceId,
        status: "pending quote",
        quoted_service: quoteService.service_name,
        quoted_price: validatedPrice,
        quoted_currency: validatedCurrency,
        billing_basis: validatedBillingBasis,
        ai_summary: updatePayload.ai_summary || null,
        language:
          updatePayload.language ||
          existingLead.language ||
          "es",
      },
    );
  } else {
    data._quote_rejected = {
      reason: selectedStandaloneVideoForInteractiveNeed
        ? "selected_standalone_video_for_interactive_need"
        : selectedSimulationWithoutSoftwareNeed
          ? "selected_simulation_without_software_need"
          : selectedBundleWithInvalidTotal
            ? "selected_bundle_price_not_in_bundle_totals"
            : selectedSaasWithWrongCurrency
              ? "selected_saas_with_wrong_currency"
              : selectedProjectWithWrongBilling
                ? "selected_project_with_wrong_billing_basis"
                : !selectedService
                  ? "service_not_found"
                  : "missing_required_quote_fields",
      selected_service_id: validatedServiceId,
      selected_service_name: selectedService?.service_name || null,
      selected_service_category: selectedService?.category || null,
      quoted_price: validatedPrice,
      quoted_currency: validatedCurrency,
      billing_basis: validatedBillingBasis,
      needs_interactive: needsInteractive,
      needs_software_simulation: needsSoftwareSimulation
    };
  }
}

    Object.keys(updatePayload).forEach((key) => {
      const value = updatePayload[key];

      if (
        value === undefined ||
        value === null ||
        value === ''
      ) {
        delete updatePayload[key];
      }
    });

    if (
      Object.keys(updatePayload).length > 0
    ) {
      try {
        const leadUpdateResponse = await fetch(
          `${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey,
              'Authorization':
                `Bearer ${supabaseServiceKey}`,
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify(updatePayload)
          }
        );

        if (!leadUpdateResponse.ok) {
          throw new Error(
            `Lead update failed: ${await leadUpdateResponse.text()}`
          );
        }

        data._meta = updatePayload;
        if (createdQuote) {
          data._quote = {
            id: createdQuote.id,
            lead_id: createdQuote.lead_id,
            status: createdQuote.status,
          };
        }
      } catch (dbErr) {
        if (createdQuote?.id) {
          try {
            await patchQuoteStatus(
              supabaseUrl,
              supabaseServiceKey,
              createdQuote.id,
              "quote failed",
            );
          } catch (quoteErr) {
            console.error(
              'Quote cleanup error:',
              quoteErr
            );
          }
        }

        console.error(
          'DB Update Error:',
          dbErr
        );
      }
    }

    if (targetContentObj) {
      targetContentObj.text =
        assistantResponse ||
        "Lo siento, ocurrió un problema.";
    }

    return new Response(
      JSON.stringify(data),
      {
        status: response.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error:
          error.message || 'Unknown error'
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }
});
