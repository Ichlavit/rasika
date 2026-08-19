import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { load } from "cheerio";

const root = process.cwd();
const articleId = process.argv.find((value) => value.startsWith("--article-id="))?.split("=")[1] || "";
const shouldApply = process.argv.includes("--apply");
const shouldRewriteInAuthorVoice = process.argv.includes("--style-rewrite");
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
  $("h1,h2,h3,h4,h5,h6").each((_, element) => {
    const heading = $(element);
    const text = heading.text().replace(/\u00a0/g, " ").trim();
    const hasMedia = Boolean(heading.find("img,iframe,video,audio,embed").length);
    if (!text && hasMedia) {
      heading.replaceWith(`<div${heading.attr("class") ? ` class="${heading.attr("class")}"` : ""}>${heading.html()}</div>`);
    } else if (!text) {
      heading.remove();
    }
  });
  return $.html()?.trim() || "";
}

function localizeSpanishLinks(value) {
  const localized = value
    .replaceAll("https://www.rasika.cl/en/blog/", "https://www.rasika.cl/blog/")
    .replaceAll("https://rasika.cl/en/blog/", "https://rasika.cl/blog/")
    .replaceAll("https://www.rasika.cl/en/lms/", "https://www.rasika.cl/lms/")
    .replaceAll("https://rasika.cl/en/lms/", "https://rasika.cl/lms/");
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
  const englishArticleSlugs = new Set([
    "what-is-instructional-design",
    "captivate-to-teach-an-old-maxim-in-the-age-of-ux-gamification",
    "interactivity",
  ]);
  $("a").each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr("href") || "";
    if (/^https:\/\/(?:www\.)?rasika\.cl\/lms\/?$/i.test(href)) {
      anchor.attr("href", "https://www.rasika.cl/en/lms/");
    }
    for (const slug of englishArticleSlugs) {
      if (href.includes(`/blog/${slug}/`) && !href.includes("/en/blog/")) {
        anchor.attr("href", href.replace(`/blog/${slug}/`, `/en/blog/${slug}/`));
      }
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
    .replace(/\baumentar ese ciclo\b/g, "potenciar ese ciclo")
    .replace(/\bampliar ese ciclo\b/g, "potenciar ese ciclo");

  const $ = load(translated.content_html, null, false);
  $("*").contents().each((_, node) => {
    if (node.type !== "text" || !node.data) return;
    node.data = node.data
      .replace(/\bbucle\b/g, "ciclo")
      .replace(/\bBucle\b/g, "Ciclo")
      .replace(/¿Aumento o reemplazo\?/g, "¿Potenciación o reemplazo?")
      .replace(/¿Ampliación o reemplazo\?/g, "¿Potenciación o reemplazo?")
      .replace(/el aumento cede ante el reemplazo/g, "la potenciación da paso al reemplazo")
      .replace(/la ampliación cede ante el reemplazo/g, "la potenciación da paso al reemplazo")
      .replace(/Los sistemas vivientes aprenden de otro modo\./g, "Los seres vivos aprenden de otro modo.")
      .replace(/los agentes vivientes/g, "los agentes vivos")
      .replace(/Fundada por el matemático Norbert Wiener en 1948, la cibernética/g, "Desarrollada como disciplina por el matemático Norbert Wiener en 1948, la cibernética")
      .replace(/Un termostato, un animal buscando comida/g, "Un termostato, un animal buscando alimento")
      .replace(/integrarla en un modelo mental existente o modificar el mismo modelo/g, "integrarla en un modelo mental existente o modificar ese modelo")
      .replace(/evitamos atascos/g, "evitamos la congestión")
      .replace(/interfaz general/g, "interfaz de propósito general")
      .replace(/Lea el estudio/g, "Leer el estudio")
      .replace(/hace portable el saber/g, "permite trasladar el conocimiento")
      .replace(/Una misión direcciona la acción\./g, "Una misión orienta la acción.")
      .replace(/El riesgo vuelve las decisiones con consecuencias\./g, "El riesgo hace que cada decisión tenga consecuencias.")
      .replace(/ejemplos trabajados/g, "ejemplos resueltos")
      .replace(/empleando con cuidado la incompletitud generativa/g, "utilizando con cuidado el valor generativo de esos espacios incompletos")
      .replace(/reforzar la incompletitud generativa/g, "preservar el valor generativo de lo incompleto")
      .replace(/cargó la resolución inmediata sin construir la capacidad subyacente/g, "resolvió el problema inmediato sin desarrollar la capacidad subyacente")
      .replace(/Un concepto filosófico da palabra a distinciones/g, "Un concepto filosófico da nombre a distinciones")
      .replace(/El aprendizaje real es desafiante/g, "El aprendizaje auténtico requiere un desafío")
      .replace(/Debe escuchar señales de aprendizaje\./g, "Debe saber reconocer las señales del aprendizaje.")
      .replace(/Esto produce telemetría de aprendizaje más rica\./g, "Esto también genera evidencia de aprendizaje más rica.")
      .replace(/El dolor de no saber no debe siempre eliminarse\./g, "La incomodidad de no saber no siempre debe eliminarse.")
      .replace(/El aprendizaje no es irreducible computacional/g, "El aprendizaje no es computacionalmente irreductible");
  });

  const exactParagraphs = new Map([
    [
      "Imaginen que estamos haciendo un curso online para un nuevo cargo. En la pantalla aparece una situación compleja: un cliente está molesto, la información disponible es incompleta y cada posible decisión tiene un riesgo.",
      "Imaginemos que estamos realizando un curso online para asumir un nuevo cargo. En la pantalla aparece una situación compleja: un cliente está molesto, la información disponible es incompleta y cada decisión posible entraña un riesgo.",
    ],
    [
      "Antes de decidir, abrimos un asistente de IA. En segundos identifica el problema, recomienda la mejor respuesta y redacta el mensaje por nosotros.",
      "Antes de tomar una decisión, recurrimos a un asistente de IA. En pocos segundos identifica el problema, recomienda la mejor respuesta y redacta el mensaje por nosotros.",
    ],
    [
      "Y sin embargo, en algún punto entre la pregunta y la respuesta algo falló. Se transmitió conocimiento, pero no se desarrolló una habilidad ni se alcanzó una competencia.",
      "Y sin embargo, en algún punto entre la pregunta y la respuesta algo se perdió: recibimos una solución, pero no desarrollamos la habilidad ni alcanzamos la competencia.",
    ],
    [
      "No es extraño que muchas personas teman ser reemplazadas por la IA. La estamos usando mal.",
      "No sorprende que muchas personas teman ser reemplazadas por la IA. La estamos utilizando de un modo que reemplaza el aprendizaje en lugar de potenciarlo.",
    ],
    [
      "Ese modelo explica por qué tantos cursos online parecen presentaciones: la información se divide en diapositivas, se adorna con imágenes y se culmina con un cuestionario. Si el aprendiz llega a la última pantalla y recuerda suficientes respuestas correctas, el sistema declara éxito.",
      "Ese modelo explica por qué tantos cursos online se parecen a una presentación: dividimos la información en diapositivas, la adornamos con imágenes y terminamos con un cuestionario. Si el aprendiz llega a la última pantalla y recuerda suficientes respuestas correctas, damos por cumplido el objetivo.",
    ],
    [
      "Un dispositivo no se convierte en herramienta de aprendizaje sólo porque lo utilicemos. El ejemplo familiar es la navegación por GPS. Aumenta nuestro control sobre el entorno: llegamos rápido a destinos desconocidos, evitamos la congestión y nos recuperamos de un giro equivocado. Para la movilidad, es una ampliación extraordinaria.",
      "Un dispositivo no se convierte en herramienta de aprendizaje sólo porque lo utilicemos. Pensemos, por ejemplo, en la navegación por GPS. Esta herramienta amplía nuestro control sobre el entorno: nos permite llegar rápidamente a un destino desconocido, evitar la congestión y corregir el rumbo después de un giro equivocado. Como herramienta de movilidad, su aporte es extraordinario.",
    ],
    [
      "La incompletitud generativa plantea una propuesta más radical: el aprendizaje genuino requiere espacios cuidadosamente diseñados que el aprendiz deba completar.",
      "El valor generativo de lo incompleto propone algo más radical: el aprendizaje auténtico requiere espacios cuidadosamente diseñados que el aprendiz deba completar.",
    ],
    [
      "La incomodidad de no saber no siempre debe eliminarse. A veces la falta debe ser habitada el tiempo suficiente para dejar espacio a la curiosidad y a la ingeniosa reparación.",
      "La incomodidad de no saber no siempre debe eliminarse. A veces debemos habitar esa falta el tiempo suficiente para que aparezcan la curiosidad y el ingenio necesarios para resolverla.",
    ],
  ]);

  $("p").each((_, element) => {
    const paragraph = $(element);
    const replacement = exactParagraphs.get(paragraph.text().replace(/\s+/g, " ").trim());
    if (replacement) paragraph.text(replacement);
  });

  $("h2").each((_, element) => {
    const heading = $(element);
    if (heading.text().trim() === "Incompletitud generativa") {
      heading.text("El valor generativo de lo incompleto");
    }
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

async function fetchAuthorStyleSamples() {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/blog_posts?id=neq.${encodeURIComponent(articleId)}&published_at=not.is.null&select=title,content_html,published_at&order=published_at.asc`,
    { headers: apiHeaders },
  );
  if (!response.ok) throw new Error(`Unable to load author style corpus (${response.status}): ${await response.text()}`);

  const posts = await response.json();
  return posts
    .map((post) => {
      const $ = load(normalizeHtml(post.content_html), null, false);
      const paragraphs = $("p")
        .map((_, element) => $(element).text().replace(/\s+/g, " ").trim())
        .get()
        .filter(Boolean);
      return { title: post.title, sample: paragraphs.join("\n\n") };
    })
    .filter((post) => post.sample.length >= 8_000)
    .slice(0, 3)
    .map((post) => ({ title: post.title, sample: post.sample.slice(0, 6_500) }));
}

async function translateToSpanish(article, htmlOverride = "") {
  const englishHtml = localizeEnglishLinks(normalizeHtml(htmlOverride || article.content_html));
  const styleSamples = await fetchAuthorStyleSamples();
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
      reasoning: { effort: "medium" },
      instructions: [
        "Create the Spanish edition of this authored EdTech essay. This is a literary and editorial adaptation into natural Chilean Spanish, not a literal translation.",
        "The supplied STYLE_SAMPLES are previous Spanish essays by the same author and are the binding voice reference. Reproduce their intellectual cadence without copying sentences: begin with a concrete tension, widen the argument through examples and conceptual history, use the first-person plural naturally, and invite the reader into the reasoning with well-placed questions and contrasts.",
        "Prefer connected, substantial paragraphs over clipped translated sentences. The voice is reflective, precise and essayistic; it can be eloquent, but never inflated, promotional or generic.",
        "Use educated Chilean Spanish. Say 'el computador', never 'la computadora' or 'el ordenador'. Prefer 'curso online', 'aprendiz', 'retroalimentación', 'ciclo', 'herramienta' and natural local constructions. Avoid calques such as 'interfaz general', 'giro a giro', 'cargar la carga', 'se declaró éxito' or repetitive 'puede'.",
        "You may rephrase and reorganize sentences inside each paragraph so the ideas sound originally written in Spanish. Preserve every claim, example, citation, percentage, proper noun and conceptual distinction. Do not summarize, expand the evidence or invent facts.",
        "Translate the title, excerpt and every piece of visible prose, including link labels and prose surrounding proper nouns.",
        "Preserve every HTML tag, class, image, attribute, external URL and the order of all media. Keep the existing section and paragraph topology so the English and Spanish editions remain editorial counterparts.",
        "Use established Spanish terminology for instructional design, cybernetics, generative AI, scaffolding, active inference and learning science.",
        "Keep Rasika, CourseMentor, names, publication titles and acronyms unchanged when they are proper nouns.",
        "A suitable title should sound authored in Spanish. Prefer the conceptual idea 'el valor de lo incompleto' over the literal gerund 'abrazar la incompletitud'.",
        "The proxy requires an outer JSON object. Set assistant_response to one string in exactly this format: <RASIKA-TITLE>Spanish title</RASIKA-TITLE><RASIKA-EXCERPT>Spanish excerpt</RASIKA-EXCERPT><RASIKA-CONTENT>Spanish HTML</RASIKA-CONTENT>. Set profile_update to {}, quote_request to {\"should_send\":false}, and ui_action to null.",
        "Do not infer, repeat or change any lead information; this request is an editorial translation operation.",
      ].join("\n"),
      input: [{
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({
            STYLE_SAMPLES: styleSamples,
            ENGLISH_ARTICLE: { title: article.title, excerpt: article.excerpt, content_html: englishHtml },
          }),
        }],
      }],
      max_output_tokens: 40_000,
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
  if (shouldRewriteInAuthorVoice) {
    ({ translated } = await translateToSpanish(
      { ...article, ...original, content_html: englishHtml },
      englishHtml,
    ));
  } else {
    translated = polishSpanishTranslation({
      ...artifact.spanish,
      content_html: localizeSpanishLinks(normalizeHtml(artifact.spanish.content_html))
        .replaceAll('target="blank"', 'target="_blank"'),
    });
  }
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
