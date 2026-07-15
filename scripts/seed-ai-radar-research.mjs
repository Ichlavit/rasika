#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_FILES = [".env", ".env.local"];
const SEED_FILE = path.join(ROOT, "supabase", "seed", "ai-radar-research.json");
const SOURCE_OVERRIDES = {
  "SRC-13": {
    feed_or_api_url: "https://moodle.com/feed/",
    note:
      "Operational correction 2026-07-15: /news/feed/ returned a closed-comments 403; the verified publication feed is /feed/.",
  },
};

function readEnv() {
  const env = { ...process.env };

  for (const filename of ENV_FILES) {
    const filePath = path.join(ROOT, filename);
    if (!fs.existsSync(filePath)) continue;

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      let value = rawValue.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in env)) env[key] = value;
    }
  }

  return env;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function splitList(value) {
  const text = clean(value);
  if (!text) return [];

  return text
    .split(/\s*;\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value) {
  return /^(yes|si|true)$/i.test(String(value ?? "").trim());
}

function parseInteger(value) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? number : null;
}

function parseDate(value) {
  const text = clean(value);
  const match = text?.match(/^(\d{4}-\d{2}-\d{2})(?:\b|\s|$)/);
  if (!match) return null;

  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]
    ? null
    : match[1];
}

function parsePollMinutes(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const hourMatch = text.match(/(?:every\s+)?(\d+)\s*hours?/);
  if (hourMatch) return Number(hourMatch[1]) * 60;
  if (text.includes("daily")) return 24 * 60;
  if (text.includes("weekly")) return 7 * 24 * 60;
  return null;
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildPayloads(research) {
  const sheets = research.sheets;

  return {
    ai_radar_sources: sheets.Sources.map((row) => {
      const override = SOURCE_OVERRIDES[row.source_id];
      return {
        source_key: clean(row.source_id),
        source_name: clean(row.source_name),
        organization: clean(row.organization),
        homepage_url: clean(row.homepage_url),
        feed_or_api_url: override?.feed_or_api_url || clean(row.feed_or_api_url),
        source_section_url: clean(row.source_section_url),
        source_type: clean(row.source_type),
        content_format: clean(row.content_format),
        languages: splitList(row.language),
        region: clean(row.region),
        authority_reason: clean(row.authority_reason),
        trust_tier: clean(row.trust_tier),
        evidence_position: clean(row.primary_or_secondary),
        editorial_independence: clean(row.editorial_independence),
        relevant_topics: splitList(row.relevant_topics),
        excluded_topics: splitList(row.excluded_topics),
        update_frequency: clean(row.update_frequency),
        access_method: clean(row.access_method),
        authentication_required: parseBoolean(row.authentication_required),
        paywall_status: clean(row.paywall_status),
        robots_url: clean(row.robots_url),
        robots_or_terms_notes: clean(row.robots_or_terms_notes),
        rate_limit_notes: clean(row.rate_limit_notes),
        publication_date_available: parseBoolean(row.publication_date_available),
        author_available: clean(row.author_available),
        canonical_url_available: clean(row.canonical_url_available),
        full_text_available: clean(row.full_text_available),
        recommended_poll_interval: clean(row.recommended_poll_interval),
        poll_interval_minutes: parsePollMinutes(row.recommended_poll_interval),
        active_recommendation: clean(row.active_recommendation),
        research_notes: [clean(row.research_notes), override?.note].filter(Boolean).join(" ") || null,
        verified_at: clean(row.verified_at),
      };
    }),
    ai_radar_rubric: sheets.Rubric.map((row) => ({
      criterion_key: slugify(row.criterion),
      criterion_name: clean(row.criterion),
      weight_percent: parseInteger(row.weight_percent),
      operational_definition: clean(row.operational_definition),
      score_0: clean(row.score_0),
      score_3: clean(row.score_3),
      score_5: clean(row.score_5),
      evidence_to_inspect: clean(row.evidence_to_inspect),
      decision_rule: clean(row.decision_rule),
    })),
    ai_radar_taxonomy: sheets.Taxonomy.map((row) => ({
      topic_key: clean(row.topic_id),
      topic_es: clean(row.topic_es),
      topic_en: clean(row.topic_en),
      parent_topic: clean(row.parent_topic),
      keywords_es: splitList(row.keywords_es),
      keywords_en: splitList(row.keywords_en),
      synonyms: splitList(row.synonyms),
      related_rasika_service: clean(row.related_rasika_service),
      related_rasika_article: clean(row.related_rasika_article),
      target_audience: clean(row.target_audience),
      commercial_relevance: clean(row.commercial_relevance),
      editorial_priority: clean(row.editorial_priority),
      notes: clean(row.notes),
    })),
    ai_radar_exclusions: sheets.Exclusions.map((row) => ({
      exclusion_key: clean(row.exclusion_id),
      pattern_name: clean(row.pattern_name),
      pattern_type: clean(row.pattern_type),
      description: clean(row.description),
      example_url: clean(row.example_url),
      default_action: clean(row.default_action),
      exception_rule: clean(row.exception_rule),
      rationale: clean(row.rationale),
    })),
    ai_radar_benchmarks: sheets["Golden Set"].map((row) => ({
      benchmark_key: clean(row.example_id),
      article_title: clean(row.article_title),
      article_url: clean(row.article_url),
      source_name: clean(row.source_name),
      published_at: parseDate(row.published_at),
      published_at_label: clean(row.published_at),
      accessed_at: parseDate(row.accessed_at),
      accessed_at_label: clean(row.accessed_at),
      expected_decision: clean(row.expected_decision),
      decision_reason: clean(row.decision_reason),
      innovation_score: parseInteger(row.innovation_score_0_5),
      evidence_score: parseInteger(row.evidence_score_0_5),
      authority_score: parseInteger(row.authority_score_0_5),
      rasika_alignment_score: parseInteger(row.rasika_alignment_score_0_5),
      practical_relevance_score: parseInteger(row.practical_relevance_score_0_5),
      latam_relevance_score: parseInteger(row.latam_relevance_score_0_5),
      freshness_score: parseInteger(row.freshness_score_0_5),
      hype_or_marketing_risk: parseInteger(row.hype_or_marketing_risk_0_5),
      matched_rasika_services: splitList(row.matched_rasika_services),
      matched_rasika_articles: splitList(row.matched_rasika_articles),
      claims_worth_preserving: clean(row.claims_worth_preserving),
      necessary_caveats: clean(row.necessary_caveats),
      suggested_editorial_angle: clean(row.suggested_editorial_angle),
      suggested_headline: clean(row.suggested_headline),
      source_attribution_required: clean(row.source_attribution_required),
      researcher_notes: clean(row.researcher_notes),
    })),
  };
}

async function upsertRows(baseUrl, serviceRoleKey, table, conflictColumn, rows) {
  const response = await fetch(
    `${baseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflictColumn)}`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );

  if (!response.ok) {
    throw new Error(`${table} seed failed (${response.status}): ${await response.text()}`);
  }
}

const research = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
const payloads = buildPayloads(research);
const counts = Object.fromEntries(
  Object.entries(payloads).map(([table, rows]) => [table, rows.length]),
);

if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ mode: "dry-run", counts }, null, 2));
  process.exit(0);
}

const env = readEnv();
const supabaseUrl = String(env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

for (const [table, rows] of Object.entries(payloads)) {
  const conflictColumn = {
    ai_radar_sources: "source_key",
    ai_radar_rubric: "criterion_key",
    ai_radar_taxonomy: "topic_key",
    ai_radar_exclusions: "exclusion_key",
    ai_radar_benchmarks: "benchmark_key",
  }[table];

  await upsertRows(supabaseUrl, serviceRoleKey, table, conflictColumn, rows);
}

console.log(JSON.stringify({ mode: "applied", counts }, null, 2));
