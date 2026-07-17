import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuthUser = {
  id: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireAdmin(
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

  const adminResponse = await fetch(
    `${supabaseUrl}/rest/v1/ai_radar_admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  if (!adminResponse.ok) {
    throw new Response("Unable to verify administrator", { status: 502 });
  }
  const admins = await adminResponse.json();
  if (!Array.isArray(admins) || admins.length !== 1) {
    throw new Response("Administrator access required", { status: 403 });
  }

  return user;
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const hookUrl = Deno.env.get("SITE_BUILD_HOOK_URL") || "";
  const hookSecret = Deno.env.get("SITE_BUILD_HOOK_SECRET") || "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !hookUrl || !hookSecret) {
    return jsonResponse({ error: "Site publication backend is not configured" }, 500);
  }

  try {
    const user = await requireAdmin(request, supabaseUrl, anonKey, serviceRoleKey);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const articleId = String(body.article_id || "").trim();
    if (articleId && !UUID_REGEX.test(articleId)) {
      return jsonResponse({ error: "Invalid article id" }, 400);
    }

    const hookResponse = await fetch(hookUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hookSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        article_id: articleId || null,
        requested_by: user.id,
      }),
      signal: AbortSignal.timeout(150_000),
    });
    const hookResult = await hookResponse.json().catch(() => ({}));
    if (!hookResponse.ok) {
      console.error("Site build hook failed", hookResponse.status, hookResult);
      return jsonResponse(
        { error: "The article was saved, but the public site build failed" },
        hookResponse.status === 409 ? 409 : 502,
      );
    }

    return jsonResponse({
      status: "published",
      article_id: articleId || null,
      deployed_at: hookResult.deployed_at || new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof Response) {
      return jsonResponse({ error: await error.text() }, error.status);
    }
    console.error("Site publication error", error);
    return jsonResponse({ error: "Site publication request failed" }, 500);
  }
});
