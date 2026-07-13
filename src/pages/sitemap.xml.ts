import { absoluteUrl, publicSeoPages } from "../data/seo";

const routeMeta: Record<string, { changefreq: string; priority: string }> = {
  "/": { changefreq: "weekly", priority: "1.0" },
  "/demos/": { changefreq: "monthly", priority: "0.8" },
  "/lms/": { changefreq: "monthly", priority: "0.9" },
  "/clients/": { changefreq: "monthly", priority: "0.7" },
  "/pricing/": { changefreq: "monthly", priority: "0.8" },
  "/blog/": { changefreq: "weekly", priority: "0.9" },
};

export async function GET() {
  const lastmod = new Date().toISOString().slice(0, 10);
  const pages = publicSeoPages;

  const urls = pages
    .map((page) => {
      const meta = routeMeta[page.path] || {
        changefreq: "monthly",
        priority: "0.75",
      };

      return `  <url>
    <loc>${absoluteUrl(page.path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${meta.changefreq}</changefreq>
    <priority>${meta.priority}</priority>
  </url>`;
    })
    .join("\n");

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
