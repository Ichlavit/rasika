import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { load } from "cheerio";

const root = process.cwd();
const outputPath = path.join(root, "src/i18n/en.json");
const pageFiles = [
  "dist/index.html",
  "dist/demos/index.html",
  "dist/lms/index.html",
  "dist/clients/index.html",
  "dist/pricing/index.html",
  "dist/blog/index.html",
  "dist/newsletter/unsubscribe/index.html",
];
const blogDirectory = path.join(root, "dist/blog");
if (fs.existsSync(blogDirectory)) {
  for (const entry of fs.readdirSync(blogDirectory, { withFileTypes: true })) {
    const articleFile = path.join("dist/blog", entry.name, "index.html");
    if (entry.isDirectory() && fs.existsSync(path.join(root, articleFile))) pageFiles.push(articleFile);
  }
}

for (const envFile of [".env.local", ".env.production", ".env"]) {
  const filePath = path.join(root, envFile);
  if (fs.existsSync(filePath) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(filePath);
    } catch {
      // A later environment file may contain the required key.
    }
  }
}

const apiKey = process.env.OPENAI_API_KEY || "";
const supabaseUrl = String(process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!apiKey && (!supabaseUrl || !supabaseServiceRoleKey)) {
  throw new Error("A valid OpenAI key or the Supabase localization configuration is required.");
}
if (!pageFiles.every((file) => fs.existsSync(path.join(root, file)))) {
  throw new Error("Build the Spanish site before generating the English catalog.");
}

const existing = fs.existsSync(outputPath)
  ? JSON.parse(fs.readFileSync(outputPath, "utf8"))
  : {};
const sources = new Set();

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function collect(value) {
  const text = normalizedText(value);
  if (text && /[A-Za-zÁÉÍÓÚÑáéíóúñ¿¡]/.test(text)) sources.add(text);
}

function collectJsonLd(value) {
  if (Array.isArray(value)) {
    value.forEach(collectJsonLd);
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach(collectJsonLd);
    return;
  }
  if (typeof value !== "string" || /^https?:\/\//i.test(value)) return;
  collect(value);
}

for (const relativePath of pageFiles) {
  const $ = load(fs.readFileSync(path.join(root, relativePath), "utf8"));
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      collectJsonLd(JSON.parse($(element).html() || "null"));
    } catch {
      // Invalid third-party structured data is ignored by the locale catalog.
    }
  });
  $("script,style,noscript,svg,.article-content").remove();
  $("title").each((_, element) => collect($(element).text()));
  $("meta[name='description'],meta[name='keywords'],meta[name='classification'],meta[property='og:title'],meta[property='og:description'],meta[property='og:image:alt'],meta[name='twitter:title'],meta[name='twitter:description']")
    .each((_, element) => collect($(element).attr("content")));
  $("body *").contents().each((_, node) => {
    if (node.type === "text") collect($(node).text());
  });
  $("[placeholder],[aria-label],[title],[alt]").each((_, element) => {
    for (const attribute of ["placeholder", "aria-label", "title", "alt"]) {
      collect($(element).attr(attribute));
    }
  });
}

const missing = [...sources].filter((source) => !existing[source]);
if (!missing.length) {
  console.log(`English catalog is complete (${Object.keys(existing).length} entries).`);
  process.exit(0);
}

async function translateBatch(batch) {
  const useDirectOpenAi = /^sk-/.test(apiKey);
  const endpoint = useDirectOpenAi
    ? "https://api.openai.com/v1/responses"
    : `${supabaseUrl}/functions/v1/localization-admin`;
  const headers = useDirectOpenAi
    ? { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
    : {
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        apikey: supabaseServiceRoleKey,
        "Content-Type": "application/json",
      };
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(useDirectOpenAi ? {
      model: "gpt-5-mini",
      store: false,
      reasoning: { effort: "low" },
      instructions: [
        "Translate website interface and B2B marketing copy from Chilean Spanish into natural professional international English.",
        "The domain is corporate learning, EdTech, SCORM, LMS, instructional design and audiovisual production.",
        "Preserve Rasika, CourseMentor, company names, personal names, product names, acronyms, URLs, prices, UF, CLP, SCORM, xAPI, RAG, Moodle and TalentLMS.",
        "Do not add claims, explanations, markdown or quotation marks. Keep already-English labels unchanged when appropriate.",
        "Translate fragments so they remain grammatical when surrounding inline emphasis is reassembled.",
      ].join("\n"),
      input: [{
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(batch) }],
      }],
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
    } : { texts: batch }),
  });

  if (!response.ok) {
    throw new Error(`Translation request failed (${response.status}): ${await response.text()}`);
  }
  const payload = await response.json();
  if (!useDirectOpenAi) return payload.translations || [];
  const outputText = payload.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI returned no translation payload.");
  return JSON.parse(outputText).translations;
}

const catalog = { ...existing };
for (let index = 0; index < missing.length; index += 45) {
  const batch = missing.slice(index, index + 45);
  const translations = await translateBatch(batch);
  const returned = new Map(translations.map((item) => [item.source, item.translation]));
  for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
    const source = batch[batchIndex];
    const positional = translations.length === batch.length ? translations[batchIndex]?.translation : "";
    const translation = normalizedText(returned.get(source) || positional);
    if (!translation) throw new Error(`Missing generated translation for: ${source}`);
    catalog[source] = translation;
  }
  const checkpoint = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b, "es")));
  fs.writeFileSync(outputPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  console.log(`Translated ${Math.min(index + batch.length, missing.length)}/${missing.length}`);
}

const ordered = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b, "es")));
fs.writeFileSync(outputPath, `${JSON.stringify(ordered, null, 2)}\n`);
console.log(`Wrote ${Object.keys(ordered).length} translations to ${path.relative(root, outputPath)}.`);
