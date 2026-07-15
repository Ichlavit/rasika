import { XMLParser } from "npm:fast-xml-parser@5.10.0";

export type RadarFeedItem = {
  title: string;
  url: string;
  author: string | null;
  publishedAt: string | null;
  excerpt: string | null;
  guid: string | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
});

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function scalarText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  return scalarText(record["#text"] ?? record["@href"] ?? "");
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "...",
    laquo: "«",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    nbsp: " ",
    quot: '"',
    raquo: "»",
    rdquo: "”",
    rsquo: "’",
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

export function stripFeedMarkup(value: unknown, maxLength = 3500): string {
  return decodeEntities(scalarText(value))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function atomLink(value: unknown): string {
  const links = asArray(value as Record<string, unknown> | Array<Record<string, unknown>>);
  const preferred = links.find((link) => !link?.["@rel"] || link["@rel"] === "alternate") ?? links[0];
  return scalarText(preferred?.["@href"] ?? preferred);
}

function isoDate(value: unknown): string | null {
  const text = scalarText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseRadarFeed(xml: string): RadarFeedItem[] {
  const document = parser.parse(xml) as Record<string, any>;
  const rssItems = asArray(document?.rss?.channel?.item);
  const atomItems = asArray(document?.feed?.entry);
  const isAtom = atomItems.length > 0;
  const items = isAtom ? atomItems : rssItems;

  return items.map((item: Record<string, unknown>) => {
    const guid = scalarText(item.guid || item.id) || null;
    const rawUrl = isAtom
      ? atomLink(item.link)
      : scalarText(item.link) || (guid?.startsWith("http") ? guid : "");
    const excerpt = stripFeedMarkup(
      item.description ?? item.summary ?? item.encoded ?? item.content,
    );

    return {
      title: stripFeedMarkup(item.title, 500),
      url: rawUrl,
      author: stripFeedMarkup(item.creator ?? item.author, 300) || null,
      publishedAt: isoDate(item.pubDate ?? item.published ?? item.updated),
      excerpt: excerpt || null,
      guid,
    };
  }).filter((item) => item.title && item.url);
}

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
]);

export function normalizeRadarUrl(rawUrl: string, allowedHosts: string[]): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase();
    const allowed = allowedHosts.some((allowedHost) =>
      host === allowedHost || host.endsWith(`.${allowedHost}`)
    );
    if (!allowed) return null;

    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}
