import { SITE } from "../data/seo";

export async function GET() {
  return new Response(`User-agent: *
Allow: /
Disallow: /admin/
Crawl-delay: 10

Sitemap: ${SITE.origin}/sitemap.xml
`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
