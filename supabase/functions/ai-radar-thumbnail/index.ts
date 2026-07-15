const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET_NAME = "ai-radar-thumbnails";
const DEFAULT_MODEL = "gpt-image-2";

type AuthUser = { id: string; email?: string };

type Candidate = {
  id: string;
  status: string;
  source_title: string;
  suggested_headline: string | null;
  thumbnail_prompt: string | null;
  thumbnail_status: string;
  thumbnail_url: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, maxLength = 20_000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function errorMessage(error: unknown) {
  return cleanText(error instanceof Error ? error.message : error, 2000) || "Unknown error";
}

async function restRequest(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Database request failed (${response.status}): ${await response.text()}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function requireRadarAdmin(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new Response("Missing authorization", { status: 401 });
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!userResponse.ok) throw new Response("Invalid or expired session", { status: 401 });

  const user = await userResponse.json() as AuthUser;
  if (!UUID_REGEX.test(user.id || "")) throw new Response("Invalid user", { status: 401 });

  const admins = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `ai_radar_admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`,
  );
  if (!Array.isArray(admins) || admins.length !== 1) {
    throw new Response("AI Radar administrator access required", { status: 403 });
  }
  return user;
}

async function getCandidate(
  supabaseUrl: string,
  serviceRoleKey: string,
  candidateId: string,
) {
  if (!UUID_REGEX.test(candidateId)) throw new Response("Invalid candidate id", { status: 400 });
  const rows = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `ai_radar_candidates?id=eq.${encodeURIComponent(candidateId)}&select=id,status,source_title,suggested_headline,thumbnail_prompt,thumbnail_status,thumbnail_url&limit=1`,
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Response("Candidate not found", { status: 404 });
  }
  return rows[0] as Candidate;
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  const chunkSize = 32_768;
  for (let start = 0; start < binary.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, binary.length);
    for (let index = start; index < end; index += 1) bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function buildPrompt(candidate: Candidate) {
  const headline = cleanText(candidate.suggested_headline || candidate.source_title, 240);
  const brief = cleanText(candidate.thumbnail_prompt, 5000);
  return [
    "Create an original editorial thumbnail for a professional Latin American EdTech publication.",
    `Article context: ${headline}.`,
    `Art direction: ${brief}.`,
    "The image should be sober, specific, visually arresting, and credible rather than sensational.",
    "Use a clear focal subject and a landscape composition that remains legible at small social-media sizes.",
    "Do not include text, letters, numbers, logos, trademarks, watermarks, interface chrome, or decorative gradients.",
    "Do not imitate or reproduce the source publisher's artwork. Create a fresh editorial visual.",
  ].join("\n");
}

async function generateImage(openAiKey: string, model: string, prompt: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 140_000);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        size: "1536x1024",
        quality: "medium",
        background: "opaque",
        n: 1,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `OpenAI image request failed (${response.status}): ${cleanText(payload?.error?.message || "unknown error", 1000)}`,
    );
  }
  const base64 = cleanText(payload?.data?.[0]?.b64_json, 30_000_000);
  if (!base64) throw new Error("OpenAI returned no image data");
  return {
    bytes: decodeBase64(base64),
    requestId: response.headers.get("x-request-id"),
  };
}

async function uploadThumbnail(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
  bytes: ArrayBuffer,
) {
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${BUCKET_NAME}/${encodeURIComponent(path)}`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "image/png",
        "Cache-Control": "3600",
        "x-upsert": "true",
      },
      body: bytes,
    },
  );
  if (!response.ok) {
    throw new Error(`Thumbnail upload failed (${response.status}): ${await response.text()}`);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const model = Deno.env.get("AI_RADAR_IMAGE_MODEL") || DEFAULT_MODEL;
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !openAiKey) {
    return jsonResponse({ error: "AI Radar thumbnail generation is not configured" }, 500);
  }

  let candidateId = "";
  try {
    const user = await requireRadarAdmin(request, supabaseUrl, anonKey, serviceRoleKey);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    candidateId = cleanText(body.candidate_id, 80);
    const candidate = await getCandidate(supabaseUrl, serviceRoleKey, candidateId);
    if (candidate.status !== "approved") {
      throw new Response("Candidate must be approved before generating a thumbnail", { status: 409 });
    }
    if (!cleanText(candidate.thumbnail_prompt)) {
      throw new Response("A thumbnail prompt is required", { status: 400 });
    }
    if (candidate.thumbnail_status === "generating") {
      throw new Response("A thumbnail is already being generated", { status: 409 });
    }

    const started = await restRequest(
      supabaseUrl,
      serviceRoleKey,
      `ai_radar_candidates?id=eq.${encodeURIComponent(candidateId)}&status=eq.approved&thumbnail_status=neq.generating`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          thumbnail_status: "generating",
          thumbnail_error: null,
        }),
      },
    );
    if (!Array.isArray(started) || started.length !== 1) {
      throw new Response("Candidate changed before thumbnail generation; reload and try again", { status: 409 });
    }

    const generatedAt = new Date().toISOString();
    const storagePath = `${candidateId}.png`;
    const generated = await generateImage(openAiKey, model, buildPrompt(candidate));
    await uploadThumbnail(supabaseUrl, serviceRoleKey, storagePath, generated.bytes);
    const publicUrl =
      `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${storagePath}?v=${encodeURIComponent(generatedAt)}`;

    const rows = await restRequest(
      supabaseUrl,
      serviceRoleKey,
      `ai_radar_candidates?id=eq.${encodeURIComponent(candidateId)}&status=eq.approved`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          thumbnail_status: "ready",
          thumbnail_url: publicUrl,
          thumbnail_error: null,
          thumbnail_generated_at: generatedAt,
          thumbnail_model: model,
          thumbnail_storage_path: storagePath,
        }),
      },
    );
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error("Candidate changed while the thumbnail was being generated");
    }

    await restRequest(supabaseUrl, serviceRoleKey, "ai_radar_review_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        candidate_id: candidateId,
        actor_id: user.id,
        action: "generate_thumbnail",
        from_status: "approved",
        to_status: "approved",
        notes: "Miniatura editorial generada después de la aprobación humana.",
        snapshot: {
          model,
          storage_path: storagePath,
          openai_request_id: generated.requestId,
        },
      }),
    });

    return jsonResponse({ candidate: rows[0] });
  } catch (error) {
    const message = errorMessage(error);
    if (candidateId && UUID_REGEX.test(candidateId) && !(error instanceof Response)) {
      try {
        await restRequest(
          supabaseUrl,
          serviceRoleKey,
          `ai_radar_candidates?id=eq.${encodeURIComponent(candidateId)}&thumbnail_status=eq.generating`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ thumbnail_status: "failed", thumbnail_error: message }),
          },
        );
      } catch (updateError) {
        console.error("AI Radar thumbnail failure update error", updateError);
      }
    }
    if (error instanceof Response) return jsonResponse({ error: await error.text() }, error.status);
    console.error("AI Radar thumbnail error", error);
    return jsonResponse({ error: message || "Thumbnail generation failed" }, 500);
  }
});
