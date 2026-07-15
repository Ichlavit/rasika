import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RSS_SOURCE_KEYS = new Set([
  "SRC-13",
  "SRC-24",
  "SRC-27",
  "SRC-30",
  "SRC-31",
  "SRC-32",
  "SRC-37",
  "SRC-38",
  "SRC-39",
  "SRC-40",
]);

const REVIEW_STATUSES = new Set([
  "discovered",
  "evaluating",
  "suggested",
  "needs_review",
  "approved",
  "rejected",
  "published",
  "archived",
  "failed",
]);

const REVIEW_TRANSITIONS: Record<string, Set<string>> = {
  suggested: new Set(["approved", "rejected", "needs_review", "archived"]),
  needs_review: new Set(["approved", "rejected", "suggested", "archived"]),
  approved: new Set(["needs_review", "rejected", "archived"]),
  rejected: new Set(["needs_review", "archived"]),
  archived: new Set(["needs_review"]),
  failed: new Set(["needs_review", "archived"]),
};

type AuthUser = {
  id: string;
  email?: string;
};

type Candidate = {
  id: string;
  source_id: string;
  canonical_url: string;
  source_title: string;
  source_author: string | null;
  source_published_at: string | null;
  status: string;
  score_total: number;
  passes_research_threshold: boolean;
  editorial_summary: string | null;
  why_it_matters: string | null;
  rasika_parallelism: string | null;
  suggested_headline: string | null;
  linkedin_copy: string | null;
  suggested_hashtags: string[] | null;
  thumbnail_prompt: string | null;
  thumbnail_url: string | null;
  matched_topics: string[] | null;
  review_notes: string | null;
};

type CandidateServiceMatch = {
  match_score: number;
  rationale: string;
  service: {
    id: string;
    service_name: string;
    category: string;
    public_description: string | null;
  } | null;
};

const RADAR_PUBLIC_CATEGORY = "Radar de tendencias en EdTech";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, maxLength = 20_000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function escapeHTML(value: unknown) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToParagraphs(value: unknown) {
  return cleanText(value)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHTML(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function slugify(value: unknown) {
  return cleanText(value, 160)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function asOptionalText(value: unknown, maxLength = 20_000) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function serviceDestination(service: CandidateServiceMatch["service"]) {
  return service?.category === "saas" ? "/lms/" : "/pricing/";
}

function buildRasikaServiceBridge(
  parallelism: unknown,
  rawMatches: unknown,
) {
  const matches = (Array.isArray(rawMatches) ? rawMatches : [])
    .filter((match): match is CandidateServiceMatch => Boolean(match?.service?.service_name))
    .slice(0, 3);
  const introduction = cleanText(parallelism, 4000);
  if (!introduction && !matches.length) return "";

  const serviceItems = matches.map((match) => {
    const service = match.service;
    const destination = serviceDestination(service);
    const rationale = cleanText(match.rationale, 2000) || cleanText(service?.public_description, 2000);
    return `<li><strong><a href="${destination}">${escapeHTML(service?.service_name)}</a></strong>${rationale ? `: ${escapeHTML(rationale)}` : ""}</li>`;
  }).join("");
  const primaryService = matches[0]?.service || null;
  const destination = serviceDestination(primaryService);
  const ctaLabel = primaryService?.category === "saas"
    ? "Conocer nuestros asistentes IA para LMS"
    : "Revisar servicios y precios";
  const serviceBlock = matches.length
    ? `<div class="rasika-service-bridge"><h3>${matches.length === 1 ? "Servicio relacionado" : "Servicios relacionados"}</h3><ul>${serviceItems}</ul><p><a href="${destination}">${ctaLabel}</a></p></div>`
    : "";

  return `<h2>La mirada de Rasika</h2>${introduction ? textToParagraphs(introduction) : ""}${serviceBlock}`;
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
  if (!userResponse.ok) {
    throw new Response("Invalid or expired session", { status: 401 });
  }

  const user = (await userResponse.json()) as AuthUser;
  if (!UUID_REGEX.test(user.id || "")) {
    throw new Response("Invalid user", { status: 401 });
  }

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
  if (!UUID_REGEX.test(candidateId)) {
    throw new Response("Invalid candidate id", { status: 400 });
  }

  const rows = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `ai_radar_candidates?id=eq.${encodeURIComponent(candidateId)}&select=*&limit=1`,
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Response("Candidate not found", { status: 404 });
  }

  return rows[0] as Candidate;
}

async function addReviewEvent(
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>,
) {
  await restRequest(supabaseUrl, serviceRoleKey, "ai_radar_review_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
}

async function loadQueue(
  requestUrl: URL,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const requestedStatus = cleanText(requestUrl.searchParams.get("status"), 40) || "suggested";
  const limit = Math.min(Math.max(Number(requestUrl.searchParams.get("limit")) || 50, 1), 100);
  const statusFilter = requestedStatus === "all"
    ? ""
    : REVIEW_STATUSES.has(requestedStatus)
    ? `&status=eq.${encodeURIComponent(requestedStatus)}`
    : "&status=eq.suggested";
  const select = [
    "id",
    "canonical_url",
    "source_title",
    "source_author",
    "source_published_at",
    "discovered_at",
    "status",
    "score_total",
    "passes_research_threshold",
    "evidence_score",
    "authority_score",
    "innovation_score",
    "rasika_alignment_score",
    "practical_relevance_score",
    "freshness_score",
    "latam_relevance_score",
    "hype_or_marketing_risk",
    "decision_reason",
    "suggested_headline",
    "editorial_summary",
    "why_it_matters",
    "rasika_parallelism",
    "thumbnail_url",
    "matched_topics",
    "reviewed_at",
    "source:ai_radar_sources(source_key,source_name,organization,publisher_name,trust_tier,active_recommendation)",
  ].join(",");

  const [items, statuses] = await Promise.all([
    restRequest(
      supabaseUrl,
      serviceRoleKey,
      `ai_radar_candidates?select=${encodeURIComponent(select)}${statusFilter}&order=score_total.desc.nullslast,discovered_at.desc&limit=${limit}`,
    ),
    restRequest(supabaseUrl, serviceRoleKey, "ai_radar_candidates?select=status"),
  ]);

  const counts: Record<string, number> = {};
  for (const row of Array.isArray(statuses) ? statuses : []) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  }

  return { items: Array.isArray(items) ? items : [], counts };
}

async function loadCandidateDetail(
  candidateId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const candidate = await getCandidate(supabaseUrl, serviceRoleKey, candidateId);
  const [sources, serviceMatches, postMatches, events] = await Promise.all([
    restRequest(
      supabaseUrl,
      serviceRoleKey,
      `ai_radar_sources?id=eq.${encodeURIComponent(candidate.source_id)}&select=id,source_key,source_name,organization,publisher_name,trust_tier,active_recommendation,authority_reason&limit=1`,
    ),
    restRequest(
      supabaseUrl,
      serviceRoleKey,
      `ai_radar_candidate_services?candidate_id=eq.${encodeURIComponent(candidateId)}&select=match_score,rationale,service:services(id,service_name,category)&order=match_score.desc`,
    ),
    restRequest(
      supabaseUrl,
      serviceRoleKey,
      `ai_radar_candidate_posts?candidate_id=eq.${encodeURIComponent(candidateId)}&select=match_score,rationale,post:blog_posts(id,title,type)&order=match_score.desc`,
    ),
    restRequest(
      supabaseUrl,
      serviceRoleKey,
      `ai_radar_review_events?candidate_id=eq.${encodeURIComponent(candidateId)}&select=id,action,from_status,to_status,notes,created_at&order=created_at.desc&limit=50`,
    ),
  ]);

  return {
    candidate,
    source: Array.isArray(sources) ? sources[0] || null : null,
    service_matches: serviceMatches || [],
    post_matches: postMatches || [],
    events: events || [],
  };
}

async function loadRecentRuns(
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  return await restRequest(
    supabaseUrl,
    serviceRoleKey,
    "ai_radar_runs?select=id,trigger_kind,status,started_at,finished_at,sources_considered,sources_succeeded,candidates_discovered,candidates_created,candidates_deduplicated,candidates_failed,error_summary,metadata,created_at&order=created_at.desc&limit=10",
  );
}

async function loadSourceItems(
  sourceId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  if (!UUID_REGEX.test(sourceId)) {
    throw new Response("Invalid source id", { status: 400 });
  }

  const sources = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `ai_radar_sources?id=eq.${encodeURIComponent(sourceId)}&select=id,source_key,source_name,organization,publisher_name,feed_or_api_url&limit=1`,
  );
  const source = Array.isArray(sources) ? sources[0] || null : null;
  if (!source || !RSS_SOURCE_KEYS.has(source.source_key)) {
    throw new Response("Source is not part of the supported RSS catalog", { status: 403 });
  }

  const items = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `ai_radar_candidates?source_id=eq.${encodeURIComponent(sourceId)}&select=id,canonical_url,source_title,source_excerpt,source_author,source_published_at,discovered_at,status,score_total,suggested_headline,failure_reason&order=source_published_at.desc.nullslast,discovered_at.desc&limit=50`,
  );
  return { source, items: Array.isArray(items) ? items : [] };
}

async function setSourceEnabled(
  body: Record<string, unknown>,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const sourceId = cleanText(body.source_id, 80);
  if (!UUID_REGEX.test(sourceId) || typeof body.enabled !== "boolean") {
    throw new Response("Invalid source settings", { status: 400 });
  }

  const sources = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `ai_radar_sources?id=eq.${encodeURIComponent(sourceId)}&select=id,source_key,content_format&limit=1`,
  );
  const source = Array.isArray(sources) ? sources[0] || null : null;
  if (!source || !RSS_SOURCE_KEYS.has(source.source_key) || source.content_format !== "RSS") {
    throw new Response("Source is not part of the supported RSS catalog", { status: 403 });
  }

  const rows = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `ai_radar_sources?id=eq.${encodeURIComponent(sourceId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        is_enabled: body.enabled,
        health_status: body.enabled ? "unverified" : "paused",
        next_poll_at: null,
      }),
    },
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function reviewCandidate(
  body: Record<string, unknown>,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const candidateId = cleanText(body.candidate_id, 80);
  const nextStatus = cleanText(body.status, 40);
  const notes = asOptionalText(body.notes, 4000);
  const candidate = await getCandidate(supabaseUrl, serviceRoleKey, candidateId);
  const allowed = REVIEW_TRANSITIONS[candidate.status];

  if (!allowed || !allowed.has(nextStatus)) {
    throw new Response(`Transition ${candidate.status} -> ${nextStatus} is not allowed`, { status: 409 });
  }
  if (nextStatus === "approved" && !candidate.passes_research_threshold && !notes) {
    throw new Response("Approval below the research threshold requires review notes", { status: 400 });
  }

  const rows = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `ai_radar_candidates?id=eq.${encodeURIComponent(candidateId)}&status=eq.${encodeURIComponent(candidate.status)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: nextStatus,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: notes,
      }),
    },
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Response("Candidate changed during review; reload and try again", { status: 409 });
  }

  const action = nextStatus === "approved"
    ? "approve"
    : nextStatus === "rejected"
    ? "reject"
    : nextStatus === "archived"
    ? "archive"
    : nextStatus === "suggested"
    ? "suggest"
    : "return";
  await addReviewEvent(supabaseUrl, serviceRoleKey, {
    candidate_id: candidateId,
    actor_id: user.id,
    action,
    from_status: candidate.status,
    to_status: nextStatus,
    notes,
    snapshot: { score_total: candidate.score_total },
  });

  return rows[0];
}

async function updateDraft(
  body: Record<string, unknown>,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const candidateId = cleanText(body.candidate_id, 80);
  const candidate = await getCandidate(supabaseUrl, serviceRoleKey, candidateId);
  if (!["suggested", "needs_review", "approved"].includes(candidate.status)) {
    throw new Response("Only reviewable candidates can be edited", { status: 409 });
  }

  const rows = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `ai_radar_candidates?id=eq.${encodeURIComponent(candidateId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        suggested_headline: asOptionalText(body.suggested_headline, 240),
        editorial_summary: asOptionalText(body.editorial_summary, 8000),
        why_it_matters: asOptionalText(body.why_it_matters, 4000),
        rasika_parallelism: asOptionalText(body.rasika_parallelism, 4000),
        linkedin_copy: asOptionalText(body.linkedin_copy, 6000),
        thumbnail_prompt: asOptionalText(body.thumbnail_prompt, 6000),
        review_notes: asOptionalText(body.notes, 4000),
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      }),
    },
  );

  return Array.isArray(rows) ? rows[0] : null;
}

async function publishCandidate(
  body: Record<string, unknown>,
  user: AuthUser,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const candidateId = cleanText(body.candidate_id, 80);
  const candidate = await getCandidate(supabaseUrl, serviceRoleKey, candidateId);
  if (candidate.status !== "approved" && candidate.status !== "published") {
    throw new Response("Candidate must be approved before publishing", { status: 409 });
  }
  if (!cleanText(candidate.editorial_summary)) {
    throw new Response("An editorial summary is required before publishing", { status: 400 });
  }

  const existing = await restRequest(
    supabaseUrl,
    serviceRoleKey,
    `blog_posts?radar_candidate_id=eq.${encodeURIComponent(candidateId)}&select=id,title,slug&limit=1`,
  );
  let post = Array.isArray(existing) ? existing[0] || null : null;

  if (!post) {
    const [sourceRows, serviceMatches] = await Promise.all([
      restRequest(
        supabaseUrl,
        serviceRoleKey,
        `ai_radar_sources?id=eq.${encodeURIComponent(candidate.source_id)}&select=source_name,organization,publisher_name&limit=1`,
      ),
      restRequest(
        supabaseUrl,
        serviceRoleKey,
        `ai_radar_candidate_services?candidate_id=eq.${encodeURIComponent(candidateId)}&select=match_score,rationale,service:services(id,service_name,category,public_description)&order=match_score.desc`,
      ),
    ]);
    const source = Array.isArray(sourceRows) ? sourceRows[0] || null : null;
    const title = cleanText(candidate.suggested_headline || candidate.source_title, 240);
    const summary = cleanText(candidate.editorial_summary, 8000);
    const sourceLabel = escapeHTML(candidate.source_title);
    const sourceUrl = escapeHTML(candidate.canonical_url);
    const contentHTML = [
      textToParagraphs(summary),
      candidate.why_it_matters
        ? `<h2>Por que importa</h2>${textToParagraphs(candidate.why_it_matters)}`
        : "",
      buildRasikaServiceBridge(candidate.rasika_parallelism, serviceMatches),
      `<p><strong>Fuente original:</strong> <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${sourceLabel}</a></p>`,
    ].join("");
    const wordCount = summary.split(/\s+/).filter(Boolean).length;
    const slug = `${slugify(title) || "radar-ia"}-${candidate.id.slice(0, 8)}`;
    const inserted = await restRequest(supabaseUrl, serviceRoleKey, "blog_posts", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        type: "agent",
        title,
        author: "Rasika AI Radar",
        category: RADAR_PUBLIC_CATEGORY,
        icon: "bot",
        read_time: `${Math.max(2, Math.ceil(wordCount / 200))} min read`,
        content_html: contentHTML,
        cover_image: candidate.thumbnail_url || null,
        slug,
        excerpt: summary.slice(0, 280),
        source_name: source?.publisher_name || source?.organization || source?.source_name || candidate.source_title,
        source_url: candidate.canonical_url,
        source_published_at: candidate.source_published_at,
        published_at: new Date().toISOString(),
        radar_candidate_id: candidate.id,
      }),
    });
    post = Array.isArray(inserted) ? inserted[0] : null;
  }

  if (candidate.status !== "published") {
    await restRequest(
      supabaseUrl,
      serviceRoleKey,
      `ai_radar_candidates?id=eq.${encodeURIComponent(candidateId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "published",
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        }),
      },
    );
    await addReviewEvent(supabaseUrl, serviceRoleKey, {
      candidate_id: candidateId,
      actor_id: user.id,
      action: "publish",
      from_status: candidate.status,
      to_status: "published",
      notes: asOptionalText(body.notes, 4000),
      snapshot: { blog_post_id: post?.id || null },
    });
  }

  return { post, blog_url: post?.id ? `/blog/?article=${post.id}` : "/blog/" };
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "AI Radar backend is not configured" }, 500);
  }

  try {
    const user = await requireRadarAdmin(request, supabaseUrl, anonKey, serviceRoleKey);
    const requestUrl = new URL(request.url);

    if (request.method === "GET") {
      const view = cleanText(requestUrl.searchParams.get("view"), 40) || "queue";
      if (view === "queue") {
        return jsonResponse(await loadQueue(requestUrl, supabaseUrl, serviceRoleKey));
      }
      if (view === "detail") {
        return jsonResponse(
          await loadCandidateDetail(
            cleanText(requestUrl.searchParams.get("id"), 80),
            supabaseUrl,
            serviceRoleKey,
          ),
        );
      }
      if (view === "sources") {
        return jsonResponse(
          await restRequest(
            supabaseUrl,
            serviceRoleKey,
            "ai_radar_sources?select=id,source_key,source_name,organization,publisher_name,trust_tier,content_format,feed_or_api_url,active_recommendation,is_enabled,health_status,last_polled_at,last_success_at,last_error,last_item_count,consecutive_failures,updated_at&order=active_recommendation.asc,trust_tier.asc,source_name.asc",
          ),
        );
      }
      if (view === "runs") {
        return jsonResponse(await loadRecentRuns(supabaseUrl, serviceRoleKey));
      }
      if (view === "source_items") {
        return jsonResponse(
          await loadSourceItems(
            cleanText(requestUrl.searchParams.get("source_id"), 80),
            supabaseUrl,
            serviceRoleKey,
          ),
        );
      }
      return jsonResponse({ error: "Unknown view" }, 400);
    }

    if (request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const action = cleanText(body.action, 40);
      if (action === "review") {
        return jsonResponse(await reviewCandidate(body, user, supabaseUrl, serviceRoleKey));
      }
      if (action === "update_draft") {
        return jsonResponse(await updateDraft(body, user, supabaseUrl, serviceRoleKey));
      }
      if (action === "publish") {
        return jsonResponse(await publishCandidate(body, user, supabaseUrl, serviceRoleKey));
      }
      if (action === "set_source_enabled") {
        return jsonResponse(await setSourceEnabled(body, supabaseUrl, serviceRoleKey));
      }
      return jsonResponse({ error: "Unknown action" }, 400);
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof Response) {
      return jsonResponse({ error: await error.text() }, error.status);
    }
    console.error("AI Radar admin error", error);
    return jsonResponse({ error: "AI Radar request failed" }, 500);
  }
});
