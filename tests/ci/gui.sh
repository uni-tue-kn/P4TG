#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo_root/Configuration GUI"
npm ci
npm run build
npm run test:coverage

if [[ ${CI:-} == true ]]; then
  npx playwright install --with-deps chromium
else
  npx playwright install chromium
fi

preview_port=$(shuf -i 20000-49151 -n 1)
preview_log=$(mktemp /tmp/p4tg-ci-gui-preview-XXXXXX.log)
npm run preview -- --host 127.0.0.1 --port "$preview_port" --strictPort \
  > "$preview_log" 2>&1 &
preview_pid=$!
cleanup() {
  kill "$preview_pid" 2>/dev/null || true
  wait "$preview_pid" 2>/dev/null || true
  rm -f "$preview_log"
}
trap cleanup EXIT

ready=false
for _ in $(seq 1 60); do
  if curl --fail --silent --output /dev/null "http://127.0.0.1:$preview_port/"; then
    ready=true
    break
  fi
  if ! kill -0 "$preview_pid" 2>/dev/null; then
    printf 'GUI preview server exited before becoming ready:\n' >&2
    sed -n '1,160p' "$preview_log" >&2
    exit 1
  fi
  sleep 1
done
[[ $ready == true ]] || {
  printf 'GUI preview server did not become ready:\n' >&2
  sed -n '1,160p' "$preview_log" >&2
  exit 1
}

P4TG_PLAYWRIGHT_BASE_URL="http://127.0.0.1:$preview_port" npm run test:e2e
