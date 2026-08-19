import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { load } from "cheerio";

const root = process.cwd();
const articleId = process.argv.find((value) => value.startsWith("--article-id="))?.split("=")[1] || "";
const shouldApply = process.argv.includes("--apply");
const artifactArgument = process.argv.find((value) => value.startsWith("--artifact="))?.slice("--artifact=".length) || "";
const outputPath = path.join("/tmp", `rasika-bilingual-${articleId || "article"}.json`);

for (const envFile of [".env.local", ".env.production", ".env"]) {
  const filePath = path.join(root, envFile);
  if (!fs.existsSync(filePath) || typeof process.loadEnvFile !== "function") continue;
  process.loadEnvFile(filePath);
}

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!/^[0-9a-f-]{36}$/i.test(articleId)) throw new Error("Pass a valid --article-id UUID.");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase configuration is required.");

const apiHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function normalizeHtml(value) {
  const $ = load(String(value || ""), null, false);
  $(".ql-cursor").remove();
  $("p").each((_, element) => {
    const paragraph = $(element);
    const text = paragraph.text().replace(/\u00a0/g, " ").trim();
    if (!text && !paragraph.find("img,iframe,video,audio,embed").length) paragraph.remove();
  });
  return $.html()?.trim() || "";
}

function localizeSpanishLinks(value) {
  const localized = value
    .replaceAll("https://www.rasika.cl/en/blog/", "https://www.rasika.cl/blog/")
    .replaceAll("https://rasika.cl/en/blog/", "https://rasika.cl/blog/");
  const $ = load(localized, null, false);
  const internalArticles = new Map([
    ["what-is-instructional-design", ["que-es-el-diseno-instruccional", "Qué es el diseño instruccional"]],
    ["captivate-to-teach-an-old-maxim-in-the-age-of-ux-gamification", ["cautivar-para-ensenar-ux-y-gamificacion", "Cautivar para enseñar"]],
    ["interactivity", ["interactividad-en-el-aprendizaje-digital", "Interactividad"]],
  ]);
  const labels = new Map([
    ["the extended mind", "la mente extendida"],
    ["Longitudinal study", "Estudio longitudinal"],
    ["Read the study", "Leer el estudio"],
  ]);

  $("a").each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr("href") || "";
    for (const [englishSlug, [spanishSlug, spanishLabel]] of internalArticles) {
      if (!href.includes(`/blog/${englishSlug}/`)) continue;
      anchor.attr("href", href.replace(`/blog/${englishSlug}/`, `/blog/${spanishSlug}/`));
      anchor.text(spanishLabel);
    }
    const translatedLabel = labels.get(anchor.text().trim());
    if (translatedLabel) anchor.text(translatedLabel);
  });

  return $.html()?.trim() || "";
}

function localizeEnglishLinks(value) {
  const $ = load(value, null, false);
  $("a").each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr("href") || "";
    if (/^https:\/\/(?:www\.)?rasika\.cl\/lms\/?$/i.test(href)) {
      anchor.attr("href", "https://www.rasika.cl/en/lms/");
    }
  });
  return $.html()?.trim() || "";
}

function polishSpanishTranslation(translated) {
  translated.title = translated.title
    .replace(/No rompas el bucle del aprendizaje/i, "No rompas el ciclo de aprendizaje")
    .replace(/:\s*Abrazando\b/, ": abrazar");
  translated.excerpt = translated.excerpt
    .replace(/\bLa EdTech\b/g, "La tecnología educativa")
    .replace(/\bbucle\b/g, "ciclo")
    .replace(/\baumentar ese ciclo\b/g, "potenciar ese ciclo");

  const $ = load(translated.content_html, null, false);
  $("*").contents().each((_, node) => {
    if (node.type !== "text" || !node.data) return;
    node.data = node.data
      .replace(/\bbucle\b/g, "ciclo")
      .replace(/\bBucle\b/g, "Ciclo")
      .replace(/¿Aumento o reemplazo\?/g, "¿Potenciación o reemplazo?")
      .replace(/el aumento cede ante el reemplazo/g, "la potenciación da paso al reemplazo");
  });
  translated.content_html = $.html()?.trim() || "";
  return translated;
}

function hashSource(post) {
  return crypto.createHash("sha256")
    .update([post.title, post.excerpt, post.content_html].join("\n\n"))
    .digest("hex");
}

async function fetchArticle() {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/blog_posts?id=eq.${encodeURIComponent(articleId)}&select=*&limit=1`,
    { headers: apiHeaders },
  );
  if (!response.ok) throw new Error(`Unable to load article (${response.status}): ${await response.text()}`);
  const [article] = await response.json();
  if (!article) throw new Error("Article not found.");
  return article;
}

async function fetchTranslationLeadId() {
  const response = await fetch(`${supabaseUrl}/rest/v1/leads?select=id&order=created_at.asc&limit=1`, {
    headers: apiHeaders,
  });
  if (!response.ok) throw new Error(`Unable to initialize translation request (${response.status}).`);
  const [lead] = await response.json();
  if (!lead?.id) throw new Error("A valid lead record is required by the existing OpenAI proxy.");
  return lead.id;
}

async function translateToSpanish(article) {
  const englishHtml = localizeEnglishLinks(normalizeHtml(article.content_html));
  const translationLeadId = await fetchTranslationLeadId();
  const response = await fetch(`${supabaseUrl}/functions/v1/openai-proxy`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      "x-target-url": "https://api.openai.com/v1/responses",
      "x-lead-id": translationLeadId,
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      store: false,
      reasoning: { effort: "low" },
      instructions: [
        "Translate this authored EdTech essay from international English into natural, polished Chilean Spanish for a professional B2B audience.",
        "Preserve the author's reflective voice, conceptual precision and paragraph structure. Do not summarize, expand, soften or add claims.",
        "Translate the title, excerpt and every piece of visible prose, including link labels and prose surrounding proper nouns.",
        "Preserve every HTML tag, class, image, attribute and external URL. Translate visible text and link labels only.",
        "Use established Spanish terminology for instructional design, cybernetics, generative AI, scaffolding, active inference and learning science.",
        "Keep Rasika, CourseMentor, names, publication titles and acronyms unchanged when they are proper nouns.",
        "The proxy requires an outer JSON object. Set assistant_response to one string in exactly this format: <RASIKA-TITLE>Spanish title</RASIKA-TITLE><RASIKA-EXCERPT>Spanish excerpt</RASIKA-EXCERPT><RASIKA-CONTENT>Spanish HTML</RASIKA-CONTENT>. Set profile_update to {}, quote_request to {\"should_send\":false}, and ui_action to null.",
        "Do not infer, repeat or change any lead information; this request is an editorial translation operation.",
      ].join("\n"),
      input: [{
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({ title: article.title, excerpt: article.excerpt, content_html: englishHtml }),
        }],
      }],
      max_output_tokens: 30_000,
      text: { format: { type: "json_object" } },
    }),
  });
  if (!response.ok) throw new Error(`Translation failed (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  const outputText = payload.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("Translation returned no output.");
  const extract = (tag) => {
    const start = `<${tag}>`;
    const end = `</${tag}>`;
    const from = outputText.indexOf(start);
    const to = outputText.lastIndexOf(end);
    if (from < 0 || to <= from) throw new Error(`Translation is missing ${tag}.`);
    return outputText.slice(from + start.length, to).trim();
  };
  const translated = {
    title: extract("RASIKA-TITLE"),
    excerpt: extract("RASIKA-EXCERPT"),
    content_html: extract("RASIKA-CONTENT"),
  };
  translated.content_html = localizeSpanishLinks(normalizeHtml(translated.content_html))
    .replaceAll('target="blank"', 'target="_blank"');
  return { englishHtml, translated: polishSpanishTranslation(translated) };
}

async function applyRepair(article, original, englishHtml, translated) {
  const spanishPost = {
    title: translated.title.trim(),
    slug: slugify(translated.title) || `articulo-${article.id.slice(0, 8)}`,
    excerpt: translated.excerpt.trim(),
    content_html: translated.content_html,
    read_time: article.read_time?.replace(/\s+read$/i, " de lectura") || "12 min de lectura",
  };
  const englishTranslation = {
    blog_post_id: article.id,
    locale: "en",
    title: original.title,
    slug: original.slug || slugify(original.title) || `article-${article.id.slice(0, 8)}`,
    excerpt: original.excerpt,
    content_html: englishHtml,
    status: "published",
    source_title: spanishPost.title,
    source_slug: spanishPost.slug,
    source_excerpt: spanishPost.excerpt,
    source_hash: hashSource(spanishPost),
    generated_by: "editorial-original-en/gpt-5-mini-es",
    translated_at: new Date().toISOString(),
    published_at: article.published_at,
  };

  const upsert = await fetch(`${supabaseUrl}/rest/v1/blog_post_translations?on_conflict=blog_post_id,locale`, {
    method: "POST",
    headers: {
      ...apiHeaders,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(englishTranslation),
  });
  if (!upsert.ok) throw new Error(`Unable to preserve English article (${upsert.status}): ${await upsert.text()}`);

  const update = await fetch(`${supabaseUrl}/rest/v1/blog_posts?id=eq.${encodeURIComponent(article.id)}`, {
    method: "PATCH",
    headers: { ...apiHeaders, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(spanishPost),
  });
  if (!update.ok) throw new Error(`Unable to update Spanish article (${update.status}): ${await update.text()}`);
  return { spanishPost, englishTranslation };
}

const article = await fetchArticle();
let englishHtml;
let translated;
let original = {
  title: article.title,
  slug: article.slug,
  excerpt: article.excerpt,
};
if (artifactArgument) {
  const artifact = JSON.parse(fs.readFileSync(path.resolve(artifactArgument), "utf8"));
  original = artifact.original;
  englishHtml = localizeEnglishLinks(normalizeHtml(artifact.original.content_html));
  translated = polishSpanishTranslation({
    ...artifact.spanish,
    content_html: localizeSpanishLinks(normalizeHtml(artifact.spanish.content_html))
      .replaceAll('target="blank"', 'target="_blank"'),
  });
} else {
  ({ englishHtml, translated } = await translateToSpanish(article));
}
const artifact = {
  article_id: article.id,
  original: { ...original, content_html: englishHtml },
  spanish: {
    title: translated.title.trim(),
    slug: slugify(translated.title),
    excerpt: translated.excerpt.trim(),
    content_html: translated.content_html,
  },
};
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);

if (shouldApply) {
  await applyRepair(article, original, englishHtml, translated);
  console.log(`Applied bilingual repair for ${article.id}.`);
} else {
  console.log(`Dry run written to ${outputPath}.`);
}
console.log(JSON.stringify({
  english: { title: original.title, slug: original.slug, html_length: englishHtml.length },
  spanish: { title: translated.title, slug: slugify(translated.title), html_length: translated.content_html.length },
}, null, 2));
