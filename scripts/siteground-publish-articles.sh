#!/bin/bash
set -euo pipefail

if [[ -z "${RASIKA_PUBLIC_ROOT:-}" ]]; then
  printf 'RASIKA_PUBLIC_ROOT is required\n'
  exit 1
fi

npm ci --no-audit --no-fund
npm run build

if [[ ! -f dist/blog/index.html || ! -f dist/sitemap.xml ]]; then
  printf 'Build output is incomplete\n'
  exit 1
fi

mkdir -p "$RASIKA_PUBLIC_ROOT/blog"
mkdir -p "$RASIKA_PUBLIC_ROOT/_astro"
rsync -az --delete dist/blog/ "$RASIKA_PUBLIC_ROOT/blog/"
rsync -az dist/_astro/ "$RASIKA_PUBLIC_ROOT/_astro/"
install -m 0644 dist/admin/index.html "$RASIKA_PUBLIC_ROOT/admin/index.html"
install -m 0644 dist/sitemap.xml "$RASIKA_PUBLIC_ROOT/sitemap.xml"
install -m 0644 dist/robots.txt "$RASIKA_PUBLIC_ROOT/robots.txt"
install -m 0644 dist/llms.txt "$RASIKA_PUBLIC_ROOT/llms.txt"
install -m 0644 dist/seo-publish-hook.php "$RASIKA_PUBLIC_ROOT/seo-publish-hook.php"
