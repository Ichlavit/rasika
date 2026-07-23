import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { load } from "cheerio";

const root = process.cwd();
const dist = path.join(root, "dist");
const catalogPath = path.join(root, "src/i18n/en.json");
const blogFallbackPath = path.join(root, "src/i18n/blog-en.json");
const staticRoutes = new Map([
  ["/", "/en/"],
  ["/demos/", "/en/demos/"],
  ["/lms/", "/en/lms/"],
  ["/clients/", "/en/clients/"],
  ["/pricing/", "/en/pricing/"],
  ["/blog/", "/en/blog/"],
  ["/newsletter/unsubscribe/", "/en/newsletter/unsubscribe/"],
]);
const sourceFiles = new Map([
  ["/", path.join(dist, "index.html")],
  ["/demos/", path.join(dist, "demos/index.html")],
  ["/lms/", path.join(dist, "lms/index.html")],
  ["/clients/", path.join(dist, "clients/index.html")],
  ["/pricing/", path.join(dist, "pricing/index.html")],
  ["/blog/", path.join(dist, "blog/index.html")],
  ["/newsletter/unsubscribe/", path.join(dist, "newsletter/unsubscribe/index.html")],
]);
const siteOrigin = "https://www.rasika.cl";
const localeScriptPath = path.join(root, "public/locale.js");
const localeScriptVersion = createHash("sha256")
  .update(fs.readFileSync(localeScriptPath))
  .digest("hex")
  .slice(0, 12);

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function routeFile(route) {
  return path.join(dist, route.replace(/^\//, ""), "index.html");
}

function loadEnvironment() {
  for (const envFile of [".env.local", ".env.production", ".env"]) {
    const filePath = path.join(root, envFile);
    if (!fs.existsSync(filePath) || typeof process.loadEnvFile !== "function") continue;
    try {
      process.loadEnvFile(filePath);
    } catch {
      // Continue to the next environment file.
    }
  }
}

async function loadBlogTranslations() {
  const fallback = readJson(blogFallbackPath, []);
  loadEnvironment();
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || !key) return fallback;

  const query = new URLSearchParams({
    select: "blog_post_id,locale,title,slug,excerpt,content_html,status,source_title,source_slug,source_excerpt",
    locale: "eq.en",
    status: "eq.published",
    order: "slug.asc",
  });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/blog_post_translations?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!response.ok) return fallback;
    const rows = await response.json();
    return Array.isArray(rows) && rows.length ? rows : fallback;
  } catch {
    return fallback;
  }
}

function translateTextNodes($, catalog, missing, skipSelectors = []) {
  const skip = ["script", "style", "noscript", "svg", "code", "pre", ...skipSelectors].join(",");
  $("html").find("*").not(skip).contents().each((_, node) => {
    if (node.type !== "text" || $(node).parents(skip).length) return;
    const raw = $(node).text();
    const source = normalizedText(raw);
    if (!source || !/[A-Za-zÁÉÍÓÚÑáéíóúñ¿¡]/.test(source)) return;
    const translation = catalog[source];
    if (!translation) {
      missing.add(source);
      return;
    }
    const leading = raw.match(/^\s*/)?.[0] || "";
    const trailing = raw.match(/\s*$/)?.[0] || "";
    node.data = `${leading}${translation}${trailing}`;
  });
}

function translateAttributes($, catalog) {
  const exactAttributes = ["placeholder", "aria-label", "title", "alt"];
  $("*").each((_, element) => {
    for (const attribute of exactAttributes) {
      const value = $(element).attr(attribute);
      const translation = catalog[normalizedText(value)];
      if (value && translation) $(element).attr(attribute, translation);
    }
    const onclick = $(element).attr("onclick");
    if (!onclick) return;
    let translated = onclick;
    for (const [source, value] of Object.entries(catalog).sort(([a], [b]) => b.length - a.length)) {
      if (source.length >= 8 && translated.includes(source)) translated = translated.split(source).join(value);
    }
    $(element).attr("onclick", translated);
  });
}

function translateMetadata($, catalog) {
  const selectors = [
    "meta[name='description']",
    "meta[name='keywords']",
    "meta[name='classification']",
    "meta[property='og:title']",
    "meta[property='og:description']",
    "meta[property='og:image:alt']",
    "meta[name='twitter:title']",
    "meta[name='twitter:description']",
  ].join(",");
  $(selectors).each((_, element) => {
    const value = normalizedText($(element).attr("content"));
    if (value && catalog[value]) $(element).attr("content", catalog[value]);
  });
}

function localizedPathname(pathname, articleRoutes) {
  if (articleRoutes.has(pathname)) return articleRoutes.get(pathname);
  const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (staticRoutes.has(normalized)) return staticRoutes.get(normalized);
  return null;
}

function localizeInternalLinks($, articleRoutes) {
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || !href.startsWith("/") || href.startsWith("//")) return;
    const url = new URL(href, siteOrigin);
    const localized = localizedPathname(url.pathname, articleRoutes);
    if (!localized) return;
    $(element).attr("href", `${localized}${url.search}${url.hash}`);
  });
}

function localeSwitcherMarkup(locale, alternateUrl, id = "") {
  const idAttribute = id ? ` id="${id}"` : "";
  const esCurrent = locale === "es" ? " aria-current=\"page\"" : "";
  const enCurrent = locale === "en" ? " aria-current=\"page\"" : "";
  const esHref = locale === "es" ? "" : alternateUrl;
  const enHref = locale === "en" ? "" : alternateUrl;
  return `<nav${idAttribute} class="rasika-locale-switcher" aria-label="Language"><a href="${esHref}" data-locale-switch="es"${esCurrent}>ES</a><span aria-hidden="true">/</span><a href="${enHref}" data-locale-switch="en"${enCurrent}>EN</a></nav>`;
}

function installLocaleUi($, locale, alternateUrl) {
  const existing = $("#lang-toggle");
  if (existing.length) existing.replaceWith(localeSwitcherMarkup(locale, alternateUrl, "rasika-locale-switcher"));
  else if ($(".article-nav-inner").length) {
    $(".article-nav-inner .mobile-menu-button").before(localeSwitcherMarkup(locale, alternateUrl, "rasika-locale-switcher"));
  }

  const mobileMenu = $("#mobile-menu");
  if (mobileMenu.length && !mobileMenu.find("[data-mobile-locale-switcher]").length) {
    mobileMenu.append(`<div data-mobile-locale-switcher>${localeSwitcherMarkup(locale, alternateUrl)}</div>`);
  }

  $("html").attr("data-locale", locale).attr("data-alternate-url", alternateUrl);
  if (!$("script[src^='/locale.js']").length) {
    $("head").append(`<script src="/locale.js?v=${localeScriptVersion}" defer></script>`);
  }
  $("head").append(`<style>
    .rasika-locale-switcher{display:inline-flex;align-items:center;justify-content:center;gap:7px;width:78px;min-width:78px;height:32px;box-sizing:border-box;flex:0 0 78px;white-space:nowrap;border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:0;color:#9ca3af;font:700 12px/1 "Plus Jakarta Sans",sans-serif;letter-spacing:0}
    .rasika-locale-switcher a{display:inline-flex;align-items:center;justify-content:center;color:inherit;text-decoration:none}.rasika-locale-switcher a[aria-current="page"]{color:#88d6e0}.rasika-locale-switcher a:hover{color:#fff}
    .rasika-language-prompt{position:fixed;right:20px;bottom:20px;z-index:1000;width:min(360px,calc(100vw - 40px));padding:18px;border:1px solid rgba(136,214,224,.35);border-radius:8px;background:#1e2226;color:#fff;box-shadow:0 18px 55px rgba(0,0,0,.45);font-family:"Plus Jakarta Sans",sans-serif}
    .rasika-language-prompt p{margin:0 0 14px;font-size:16px;font-weight:700}.rasika-language-prompt div{display:flex;gap:8px}.rasika-language-prompt a,.rasika-language-prompt button{min-height:40px;padding:0 13px;border-radius:6px;font:700 12px/1 inherit;cursor:pointer}
    .rasika-language-prompt a{display:inline-flex;align-items:center;background:#5ea6b0;color:#081012;text-decoration:none}.rasika-language-prompt button{border:1px solid rgba(255,255,255,.15);background:#141619;color:#d1d5db}
  </style>`);
}

function setSeoAlternates($, locale, route, alternateRoute) {
  const currentUrl = new URL(route, siteOrigin).toString();
  const alternateUrl = new URL(alternateRoute, siteOrigin).toString();
  const spanishUrl = locale === "es" ? currentUrl : alternateUrl;
  const englishUrl = locale === "en" ? currentUrl : alternateUrl;
  $("link[rel='canonical']").attr("href", currentUrl);
  $("link[rel='alternate'][hreflang]").remove();
  $("head").append(`<link rel="alternate" hreflang="es-CL" href="${spanishUrl}"><link rel="alternate" hreflang="en" href="${englishUrl}"><link rel="alternate" hreflang="x-default" href="${spanishUrl}">`);
  $("meta[property='og:url']").attr("content", currentUrl);
  $("meta[property='og:locale']").attr("content", locale === "en" ? "en_US" : "es_CL");
}

function transformJsonLd(value, catalog, articleRoutes) {
  if (Array.isArray(value)) return value.map((item) => transformJsonLd(item, catalog, articleRoutes));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "inLanguage" ? "en" : transformJsonLd(item, catalog, articleRoutes)]));
  }
  if (typeof value !== "string") return value;
  if (value.startsWith(siteOrigin)) {
    const url = new URL(value);
    const localized = localizedPathname(url.pathname, articleRoutes);
    if (localized) return `${siteOrigin}${localized}${url.search}${url.hash}`;
  }
  return catalog[normalizedText(value)] || value;
}

function localizeJsonLd($, catalog, articleRoutes) {
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const payload = JSON.parse($(element).html() || "null");
      $(element).text(JSON.stringify(transformJsonLd(payload, catalog, articleRoutes)).replace(/</g, "\\u003c"));
    } catch {
      // Leave malformed third-party data untouched.
    }
  });
}

function articleRouteMap(translations) {
  return new Map(translations.map((item) => [`/blog/${item.source_slug}/`, `/en/blog/${item.slug}/`]));
}

function articleCatalog(translations) {
  const values = {};
  for (const item of translations) {
    values[normalizedText(item.source_title)] = item.title;
    values[normalizedText(item.source_excerpt)] = item.excerpt;
  }
  return values;
}

function localizeArticle($, translation, englishRoute) {
  const englishArticleUrl = new URL(englishRoute, siteOrigin).toString();
  const encodedUrl = encodeURIComponent(englishArticleUrl);
  const encodedTitle = encodeURIComponent(translation.title);
  $("title").text(`${translation.title} | Rasika Insights`);
  $("meta[name='description'],meta[property='og:description'],meta[name='twitter:description']")
    .attr("content", translation.excerpt);
  $("meta[property='og:title'],meta[name='twitter:title']").attr("content", translation.title);
  $(".article-hero h1").text(translation.title);
  $(".article-excerpt").text(translation.excerpt);
  $(".article-content").html(translation.content_html);
  $("a[href^='https://www.linkedin.com/shareArticle']")
    .attr("href", `https://www.linkedin.com/shareArticle?mini=true&url=${encodedUrl}&title=${encodedTitle}`);
  $("a[href^='https://twitter.com/intent/tweet']")
    .attr("href", `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`);
  $("a[href^='https://www.facebook.com/sharer/sharer.php']")
    .attr("href", `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`);
  $("#copy-article-link").attr("data-url", englishArticleUrl);
  $("script").each((_, element) => {
    const script = $(element).html() || "";
    if (!script.includes("const articleTitle =")) return;
    $(element).html(script.replace(/const articleTitle = .*?;/, `const articleTitle = ${JSON.stringify(translation.title)};`));
  });
}

function writeHtml(filePath, $) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, $.html());
}

function rewriteSitemap(articleRoutes) {
  const sitemapPath = path.join(dist, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) return;
  const $ = load(fs.readFileSync(sitemapPath, "utf8"), { xmlMode: true });
  const existing = new Set($("url > loc").map((_, element) => $(element).text()).get());
  const additions = [];
  for (const [spanishRoute, englishRoute] of [...staticRoutes, ...articleRoutes]) {
    const spanishUrl = new URL(spanishRoute, siteOrigin).toString();
    const englishUrl = new URL(englishRoute, siteOrigin).toString();
    if (!existing.has(spanishUrl)) continue;
    const original = $("url").filter((_, element) => $(element).find("loc").text() === spanishUrl).first();
    original.append(`<xhtml:link rel="alternate" hreflang="es-CL" href="${spanishUrl}"/><xhtml:link rel="alternate" hreflang="en" href="${englishUrl}"/>`);
    if (!existing.has(englishUrl)) additions.push(`<url><loc>${englishUrl}</loc><xhtml:link rel="alternate" hreflang="es-CL" href="${spanishUrl}"/><xhtml:link rel="alternate" hreflang="en" href="${englishUrl}"/></url>`);
  }
  $("urlset").attr("xmlns:xhtml", "http://www.w3.org/1999/xhtml").append(additions.join(""));
  fs.writeFileSync(sitemapPath, $.xml());
}

function writeEnglishAiResources(catalog, articleRoutes) {
  const routePairs = [...staticRoutes, ...articleRoutes]
    .filter(([sourceRoute]) => sourceRoute !== "/")
    .sort(([a], [b]) => b.length - a.length);
  const llmsPath = path.join(dist, "llms.txt");
  if (fs.existsSync(llmsPath)) {
    let content = fs.readFileSync(llmsPath, "utf8");
    const resourceCopy = new Map([
      ["Produccion de cursos online, SCORM, LMS, tutores virtuales IA y automatizaciones EdTech para aprendizaje corporativo.", "Online course production, SCORM, LMS, AI virtual tutors and EdTech automation for corporate learning."],
      ["Desarrollo de cursos online corporativos", "Corporate online course development"],
      ["Produccion e-learning y diseno instruccional", "E-learning production and instructional design"],
      ["SCORM, HTML5, evaluaciones y simuladores", "SCORM, HTML5, assessments and simulations"],
      ["Postproduccion de video con IA, chroma key, fondos generativos y vestuario virtual", "AI video post-production, chroma key, generative backgrounds and virtual wardrobe"],
      ["Chatbot para tutores virtuales y CourseMentor", "Virtual tutor chatbots and CourseMentor"],
      ["IA educativa, RAG, LMS, Moodle, TalentLMS y xAPI", "Educational AI, RAG, LMS, Moodle, TalentLMS and xAPI"],
      ["Automatizaciones EdTech con Supabase, APIs, reportes y CRM", "EdTech automation with Supabase, APIs, reporting and CRM"],
    ]);
    for (const [source, translation] of resourceCopy) content = content.split(source).join(translation);
    for (const [source, translation] of Object.entries(catalog).sort(([a], [b]) => b.length - a.length)) {
      if (source.length >= 12 && content.includes(source)) content = content.split(source).join(translation);
    }
    for (const [spanishRoute, englishRoute] of routePairs) {
      content = content.split(`${siteOrigin}${spanishRoute}`).join(`${siteOrigin}${englishRoute}`);
    }
    content = content.split(`](${siteOrigin}/)`).join(`](${siteOrigin}/en/)`);
    content = content.split(`${siteOrigin}/ai-overview.md`).join(`${siteOrigin}/en/ai-overview.md`);
    fs.mkdirSync(path.join(dist, "en"), { recursive: true });
    fs.writeFileSync(path.join(dist, "en/llms.txt"), content);
  }

  const overviewPath = path.join(root, "public/ai-overview.md");
  if (fs.existsSync(overviewPath)) {
    let content = fs.readFileSync(overviewPath, "utf8");
    for (const [spanishRoute, englishRoute] of routePairs) {
      content = content.split(`${siteOrigin}${spanishRoute}`).join(`${siteOrigin}${englishRoute}`);
    }
    content = content.split(`- Home: ${siteOrigin}/`).join(`- Home: ${siteOrigin}/en/`);
    fs.mkdirSync(path.join(dist, "en"), { recursive: true });
    fs.writeFileSync(path.join(dist, "en/ai-overview.md"), content);
  }
}

if (!fs.existsSync(catalogPath)) throw new Error("Missing src/i18n/en.json.");
const baseCatalog = readJson(catalogPath, {});
const blogTranslations = await loadBlogTranslations();
const articleRoutes = articleRouteMap(blogTranslations);
const catalog = { ...baseCatalog, ...articleCatalog(blogTranslations) };

for (const translation of blogTranslations) {
  const route = `/blog/${translation.source_slug}/`;
  const filePath = routeFile(route);
  if (fs.existsSync(filePath)) sourceFiles.set(route, filePath);
}

const missing = new Set();
for (const [spanishRoute, filePath] of sourceFiles) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing source page: ${path.relative(root, filePath)}`);
  const englishRoute = articleRoutes.get(spanishRoute) || staticRoutes.get(spanishRoute);
  if (!englishRoute) throw new Error(`Missing English route for ${spanishRoute}`);
  const sourceHtml = fs.readFileSync(filePath, "utf8");

  const spanish = load(sourceHtml);
  installLocaleUi(spanish, "es", englishRoute);
  setSeoAlternates(spanish, "es", spanishRoute, englishRoute);
  writeHtml(filePath, spanish);

  const english = load(sourceHtml);
  const translation = blogTranslations.find((item) => `/blog/${item.source_slug}/` === spanishRoute);
  translateTextNodes(english, catalog, missing, translation ? [".article-content"] : []);
  translateAttributes(english, catalog);
  translateMetadata(english, catalog);
  if (translation) localizeArticle(english, translation, englishRoute);
  localizeInternalLinks(english, articleRoutes);
  localizeJsonLd(english, catalog, articleRoutes);
  english("html").attr("lang", "en");
  installLocaleUi(english, "en", spanishRoute);
  setSeoAlternates(english, "en", englishRoute, spanishRoute);
  writeHtml(routeFile(englishRoute), english);
}

if (missing.size) {
  const preview = [...missing].slice(0, 30).map((item) => `- ${item}`).join("\n");
  throw new Error(`English catalog is missing ${missing.size} rendered strings:\n${preview}\nRun npm run i18n:translate.`);
}

rewriteSitemap(articleRoutes);
writeEnglishAiResources(catalog, articleRoutes);
console.log(`Built ${sourceFiles.size} English pages with ${Object.keys(catalog).length} localized strings.`);
