#!/bin/sh
set -e

cd /app

mkdir -p /app/.wrangler

echo "Applying D1 migrations (local)..."
wrangler d1 migrations apply ternssh --local --config wrangler.jsonc

echo "Starting ternssh on 0.0.0.0:${PORT:-8787}..."
exec wrangler dev \
  --config wrangler.jsonc \
  --ip 0.0.0.0 \
  --port "${PORT:-8787}" \
  --local
