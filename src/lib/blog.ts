export type PublishedBlogPost = {
  id: string;
  type: "human" | "agent";
  title: string;
  author: string;
  category: string | null;
  icon: string | null;
  read_time: string | null;
  content_html: string;
  cover_image: string | null;
  slug: string;
  excerpt: string;
  source_name: string | null;
  source_url: string | null;
  source_published_at: string | null;
  published_at: string;
  updated_at: string;
  radar_candidate_id: string | null;
};

const PUBLISHED_POST_FIELDS = [
  "id",
  "type",
  "title",
  "author",
  "category",
  "icon",
  "read_time",
  "content_html",
  "cover_image",
  "slug",
  "excerpt",
  "source_name",
  "source_url",
  "source_published_at",
  "published_at",
  "updated_at",
  "radar_candidate_id",
].join(",");

function requiredPublicEnvironment() {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY are required to build published blog pages.",
    );
  }

  return { supabaseUrl, anonKey };
}

export async function getPublishedBlogPosts(): Promise<PublishedBlogPost[]> {
  const { supabaseUrl, anonKey } = requiredPublicEnvironment();
  const params = new URLSearchParams({
    select: PUBLISHED_POST_FIELDS,
    published_at: "not.is.null",
    slug: "not.is.null",
    order: "published_at.desc",
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/blog_posts?${params}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Unable to load published blog posts (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as PublishedBlogPost[];
}

export function articlePath(slug: string) {
  return `/blog/${slug}/`;
}

export function articleWordCount(contentHtml: string) {
  return contentHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
