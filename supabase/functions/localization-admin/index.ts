const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

type TranslationRequest = {
  texts?: unknown;
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearerToken(request: Request) {
  return String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function jwtRole(token: string) {
  try {
    const payload = token.split(".")[1] || "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return String(JSON.parse(atob(normalized)).role || "");
  } catch {
    return "";
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (jwtRole(bearerToken(request)) !== "service_role") {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
  if (!openAiKey) return jsonResponse({ error: "Localization service is not configured" }, 503);

  let body: TranslationRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const texts = Array.isArray(body.texts)
    ? body.texts.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (!texts.length || texts.length > 50 || texts.some((value) => value.length > 30_000)) {
    return jsonResponse({ error: "Expected 1 to 50 source strings" }, 400);
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      store: false,
      reasoning: { effort: "low" },
      instructions: [
        "Translate website interface and B2B marketing copy from Chilean Spanish into natural professional international English.",
        "The domain is corporate learning, EdTech, SCORM, LMS, instructional design and audiovisual production.",
        "Preserve Rasika, CourseMentor, company names, personal names, product names, acronyms, URLs, prices, UF, CLP, SCORM, xAPI, RAG, Moodle and TalentLMS.",
        "Do not add claims, explanations, markdown or quotation marks. Keep already-English labels unchanged when appropriate.",
        "Translate fragments so they remain grammatical when surrounding inline emphasis is reassembled.",
        "When a source string contains HTML, preserve its tags, attributes, URLs and structure exactly; translate visible text only.",
      ].join("\n"),
      input: [{
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(texts) }],
      }],
      max_output_tokens: 24_000,
      text: {
        format: {
          type: "json_schema",
          name: "rasika_english_catalog",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              translations: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    source: { type: "string" },
                    translation: { type: "string" },
                  },
                  required: ["source", "translation"],
                },
              },
            },
            required: ["translations"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    console.error("OpenAI localization failed", response.status, await response.text());
    return jsonResponse({ error: "Translation provider failed" }, 502);
  }

  const payload = await response.json();
  const outputText = payload.output
    ?.flatMap((item: { content?: unknown[] }) => item.content || [])
    .find((item: { type?: string }) => item.type === "output_text")?.text;
  if (!outputText) return jsonResponse({ error: "Translation provider returned no output" }, 502);

  try {
    return jsonResponse(JSON.parse(outputText));
  } catch {
    return jsonResponse({ error: "Translation provider returned invalid output" }, 502);
  }
});
