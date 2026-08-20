const optimizedImageNames = new Set([
  "20260818-200839-d4d10a3375ef0246ea64",
  "20260818-204023-3dbce32078b75970fe73",
  "20260818-221154-bc5e8b503435ef2a8eeb",
  "20260818-221325-5ed03b7591220603db6f",
  "20260818-222000-85edf39d4e57d3d52f6f",
  "20260818-222152-d8d7ada9ebb6073ece14",
  "20260818-233031-a8adc2ad5ffd8728df96",
  "20260819-003625-f1056209f96032671458",
  "20260819-013238-57919e406c31ee4ddc5e",
  "20260819-014707-3e265c288e632bf81bf8",
]);

const legacyImageNames = new Map([
  ["/images/blog/press_start.gif", "legacy-press-start"],
  ["/images/blog/vr_set.png", "legacy-vr-set"],
  ["/images/blog/tech_learning.jpg", "legacy-tech-learning"],
  ["/images/general/1778101836_skinner_box.jpg", "legacy-skinner-box"],
  ["/images/general/1778101774_interactive_hamburger.gif", "legacy-interactive-hamburger"],
  ["/images/general/1778099519_lego_pieces.png", "legacy-lego-pieces"],
  ["/images/general/1778099286_jean_piaget.jpg", "legacy-jean-piaget"],
  ["/images/general/1778098759_graphics-transformational_short.png", "legacy-graphics-transformational"],
  ["/images/general/1778098706_kidney-bean-plant-timelapse.gif", "legacy-kidney-bean"],
  ["/images/general/1778098802_dual_coding_brain.jpg", "legacy-dual-coding"],
  ["/images/general/1778098841_two_brains.jpg", "legacy-two-brains"],
  ["/images/general/1778099728_starbucks_loyalty_app.png", "legacy-starbucks-loyalty"],
]);

export const optimizedArticleImageSources = Object.fromEntries([
  ...[...optimizedImageNames].map((name) => [`/images/blog/${name}.png`, name]),
  ...legacyImageNames,
]);

const socialImageNames = new Set([
  "20260818-233031-a8adc2ad5ffd8728df96",
  "legacy-press-start",
  "legacy-vr-set",
  "legacy-tech-learning",
]);

type ImageVariants = {
  mobile: string;
  desktop: string;
  srcset: string;
};

function optimizedImageName(source: string | null | undefined) {
  if (!source) return null;
  try {
    return optimizedArticleImageSources[new URL(source, "https://www.rasika.cl").pathname] || null;
  } catch {
    return optimizedArticleImageSources[source.split("?")[0].split("#")[0]] || null;
  }
}

export function articleImageVariants(source: string | null | undefined): ImageVariants | null {
  const name = optimizedImageName(source);
  if (!name) return null;
  const directory = "/images/blog/optimized";
  const mobile = `${directory}/${name}-768.webp`;
  const desktop = `${directory}/${name}-1280.webp`;
  return { mobile, desktop, srcset: `${mobile} 768w, ${desktop} 1280w` };
}

export function optimizedArticleImageSource(source: string | null | undefined) {
  return articleImageVariants(source)?.desktop || source || "";
}

export function socialArticleImageSource(source: string | null | undefined) {
  const name = optimizedImageName(source);
  return name && socialImageNames.has(name) ? `/images/blog/optimized/${name}-og.jpg` : source || "";
}

export function optimizeArticleContentImages(contentHtml: string) {
  return String(contentHtml || "").replace(/<img\b([^>]*?)>/gi, (tag, attributes) => {
    const sourceMatch = attributes.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
    const variants = articleImageVariants(sourceMatch?.[2]);
    if (!variants) return tag;

    const preservedAttributes = attributes
      .replace(/\s+(?:src|srcset|sizes|loading|decoding|width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .trim();
    const prefix = preservedAttributes ? ` ${preservedAttributes}` : "";
    return `<img${prefix} src="${variants.desktop}" srcset="${variants.srcset}" sizes="(max-width: 640px) calc(100vw - 3rem), 768px" width="1280" height="715" loading="lazy" decoding="async">`;
  });
}
