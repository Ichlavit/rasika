import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const outputPath = path.join(root, "src/i18n/blog-en.json");
const shouldSeed = process.argv.includes("--seed");

for (const envFile of [".env.local", ".env.production", ".env"]) {
  const filePath = path.join(root, envFile);
  if (!fs.existsSync(filePath) || typeof process.loadEnvFile !== "function") continue;
  try {
    process.loadEnvFile(filePath);
  } catch {
    // Continue to the next environment file.
  }
}

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase localization configuration is required.");

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function sourceHash(post) {
  return crypto
    .createHash("sha256")
    .update([post.title, post.excerpt, post.content_html].join("\n\n"))
    .digest("hex");
}

async function fetchPublishedPosts() {
  const params = new URLSearchParams({
    select: "id,title,slug,excerpt,content_html,published_at,updated_at",
    published_at: "not.is.null",
    slug: "not.is.null",
    order: "published_at.asc",
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/blog_posts?${params}`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!response.ok) throw new Error(`Unable to load blog posts (${response.status}): ${await response.text()}`);
  return response.json();
}

async function translatePost(post) {
  const response = await fetch(`${supabaseUrl}/functions/v1/localization-admin`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ texts: [post.title, post.excerpt, post.content_html] }),
  });
  if (!response.ok) throw new Error(`Article translation failed (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  const translations = Array.isArray(payload.translations) ? payload.translations : [];
  if (translations.length !== 3) throw new Error(`Article translation returned ${translations.length} of 3 fields.`);
  const [title, excerpt, contentHtml] = translations.map((item) => String(item?.translation || "").trim());
  if (!title || !excerpt || !contentHtml) throw new Error(`Article translation is incomplete for ${post.slug}.`);
  return {
    blog_post_id: post.id,
    locale: "en",
    title,
    slug: slugify(title) || `article-${post.id.slice(0, 8)}`,
    excerpt,
    content_html: contentHtml,
    status: "published",
    source_title: post.title,
    source_slug: post.slug,
    source_excerpt: post.excerpt,
    source_hash: sourceHash(post),
    generated_by: "gpt-5-mini",
    translated_at: new Date().toISOString(),
    published_at: post.published_at,
  };
}

async function seedTranslations(rows) {
  const response = await fetch(`${supabaseUrl}/rest/v1/blog_post_translations?on_conflict=blog_post_id,locale`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Unable to seed blog translations (${response.status}): ${await response.text()}`);
}

const existing = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, "utf8")) : [];
const existingByPost = new Map(existing.map((item) => [item.blog_post_id, item]));
const posts = await fetchPublishedPosts();
const results = [];

for (const post of posts) {
  const hash = sourceHash(post);
  const current = existingByPost.get(post.id);
  if (current?.source_hash === hash) {
    results.push(current);
    console.log(`Current: ${post.slug}`);
    continue;
  }
  console.log(`Translating: ${post.slug}`);
  results.push(await translatePost(post));
  fs.writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
}

fs.writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
if (shouldSeed) {
  await seedTranslations(results);
  console.log(`Seeded ${results.length} published English article translations.`);
} else {
  console.log(`Wrote ${results.length} English article translations. Re-run with --seed after applying the migration.`);
}
