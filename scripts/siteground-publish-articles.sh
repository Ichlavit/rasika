#!/bin/bash
set -euo pipefail

if [[ -z "${RASIKA_PUBLIC_ROOT:-}" ]]; then
  printf 'RASIKA_PUBLIC_ROOT is required\n'
  exit 1
fi

export GOMAXPROCS="${GOMAXPROCS:-1}"
export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-1}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=160}"
export ASTRO_TELEMETRY_DISABLED=1
export RASIKA_LOW_MEMORY_BUILD=1

/bin/timeout -k 5s 45s npm ci --no-audit --no-fund
node scripts/prepare-siteground-build.mjs

build_succeeded=0
for attempt in 1 2 3; do
  if /bin/timeout -k 5s 60s npm run build; then
    build_succeeded=1
    break
  fi

  printf 'Build attempt %s failed; waiting for SiteGround memory before retrying\n' "$attempt"
  rm -rf dist .astro
  sleep $((attempt * 5))
done

if [[ "$build_succeeded" -ne 1 ]]; then
  printf 'Build failed after 3 attempts\n'
  exit 1
fi

if [[ ! -f dist/blog/index.html || ! -f dist/sitemap.xml || ! -f dist/upload.php || ! -f dist/article-admin.php ]]; then
  printf 'Build output is incomplete\n'
  exit 1
fi

mkdir -p "$RASIKA_PUBLIC_ROOT/blog"
mkdir -p "$RASIKA_PUBLIC_ROOT/en/blog"
mkdir -p "$RASIKA_PUBLIC_ROOT/_astro"
rsync -az --delete dist/blog/ "$RASIKA_PUBLIC_ROOT/blog/"
rsync -az --delete dist/en/blog/ "$RASIKA_PUBLIC_ROOT/en/blog/"
rsync -az dist/_astro/ "$RASIKA_PUBLIC_ROOT/_astro/"
install -m 0644 dist/admin/index.html "$RASIKA_PUBLIC_ROOT/admin/index.html"
install -m 0644 dist/article-content.css "$RASIKA_PUBLIC_ROOT/article-content.css"
install -m 0644 dist/sitemap.xml "$RASIKA_PUBLIC_ROOT/sitemap.xml"
install -m 0644 dist/robots.txt "$RASIKA_PUBLIC_ROOT/robots.txt"
install -m 0644 dist/llms.txt "$RASIKA_PUBLIC_ROOT/llms.txt"
install -m 0644 dist/seo-publish-hook.php "$RASIKA_PUBLIC_ROOT/seo-publish-hook.php"
install -m 0644 dist/upload.php "$RASIKA_PUBLIC_ROOT/upload.php"
install -m 0644 dist/article-admin.php "$RASIKA_PUBLIC_ROOT/article-admin.php"
