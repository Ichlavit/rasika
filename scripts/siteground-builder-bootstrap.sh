#!/bin/bash
set -euo pipefail

BUILDER_ROOT="${RASIKA_BUILDER_ROOT:-$HOME/rasika-builder}"
REPOSITORY_ROOT="$BUILDER_ROOT/repository"
ENV_FILE="$BUILDER_ROOT/.env.production"
LOG_FILE="$BUILDER_ROOT/publish.log"

mkdir -p "$BUILDER_ROOT"
exec 9>"$BUILDER_ROOT/publish.lock"
if ! flock -n 9; then
  exit 75
fi

exec >>"$LOG_FILE" 2>&1
printf '[%s] Starting article publication\n' "$(date -u +%FT%TZ)"

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'Missing build environment: %s\n' "$ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ ! -d "$REPOSITORY_ROOT/.git" ]]; then
  git clone --depth 1 --branch main https://github.com/Ichlavit/rasika.git "$REPOSITORY_ROOT"
else
  git -C "$REPOSITORY_ROOT" pull --ff-only origin main
fi

cd "$REPOSITORY_ROOT"
/bin/bash scripts/siteground-publish-articles.sh
printf '[%s] Article publication completed\n' "$(date -u +%FT%TZ)"
