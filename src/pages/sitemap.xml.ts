import {
  absoluteUrl,
  publicSeoPages,
  VIDEO_ENHANCE_SEO,
} from "../data/seo";
import { articlePath, getPublishedBlogPosts } from "../lib/blog";

const routeMeta: Record<string, { changefreq: string; priority: string }> = {
  "/": { changefreq: "weekly", priority: "1.0" },
  "/demos/": { changefreq: "monthly", priority: "0.8" },
  "/lms/": { changefreq: "monthly", priority: "0.9" },
  "/clients/": { changefreq: "monthly", priority: "0.7" },
  "/pricing/": { changefreq: "monthly", priority: "0.8" },
  "/blog/": { changefreq: "weekly", priority: "0.9" },
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function videoEnhanceSitemapEntry() {
  return `
    <video:video>
      <video:thumbnail_loc>${escapeXml(absoluteUrl(VIDEO_ENHANCE_SEO.thumbnailPath))}</video:thumbnail_loc>
      <video:title>${escapeXml(VIDEO_ENHANCE_SEO.name)}</video:title>
      <video:description>${escapeXml(VIDEO_ENHANCE_SEO.description)}</video:description>
      <video:content_loc>${escapeXml(absoluteUrl(VIDEO_ENHANCE_SEO.contentPath))}</video:content_loc>
      <video:duration>19</video:duration>
      <video:publication_date>${VIDEO_ENHANCE_SEO.uploadDate}</video:publication_date>
      <video:uploader info="${absoluteUrl("/")}">Rasika Producciones</video:uploader>
      <video:family_friendly>yes</video:family_friendly>
      <video:live>no</video:live>
      <video:tag>postproduccion de video con IA</video:tag>
      <video:tag>chroma key</video:tag>
      <video:tag>fondos generados con IA</video:tag>
      <video:tag>vestuario virtual</video:tag>
      <video:tag>video corporativo</video:tag>
    </video:video>`;
}

export async function GET() {
  const lastmod = new Date().toISOString().slice(0, 10);
  const pages = publicSeoPages;
  const posts = await getPublishedBlogPosts();

  const pageUrls = pages
    .map((page) => {
      const meta = routeMeta[page.path] || {
        changefreq: "monthly",
        priority: "0.75",
      };

      const videoEntry =
        page.path === "/demos/" ? videoEnhanceSitemapEntry() : "";

      return `  <url>
    <loc>${escapeXml(absoluteUrl(page.path))}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${meta.changefreq}</changefreq>
    <priority>${meta.priority}</priority>
${videoEntry}
  </url>`;
    })
    .join("\n");

  const articleUrls = posts
    .map((post) => `  <url>
    <loc>${escapeXml(absoluteUrl(articlePath(post.slug)))}</loc>
    <lastmod>${new Date(post.updated_at || post.published_at).toISOString()}</lastmod>
  </url>`)
    .join("\n");

  const urls = [pageUrls, articleUrls].filter(Boolean).join("\n");

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${urls}
</urlset>
`, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
