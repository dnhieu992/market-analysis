#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
# Load env vars
if [ -f .env ]; then
  set -a && source .env && set +a
fi

PM2_API="market-api"
PM2_WORKER="market-worker"
PM2_WEB="market-web"
# ─────────────────────────────────────────────────────────────────────────────

echo "── Pull latest code"
git pull

echo "── Install dependencies"
pnpm install --frozen-lockfile

echo "── Generate Prisma client"
pnpm prisma:generate

echo "── Run DB migrations"
pnpm --filter @app/db exec prisma migrate deploy

echo "── Build all apps"
pnpm -r build

echo "── Restart API"
pm2 restart "$PM2_API" \
  || pm2 start dist/apps/api/src/main.js --name "$PM2_API"

echo "── Restart Worker"
pm2 restart "$PM2_WORKER" \
  || pm2 start dist/apps/worker/src/main.js --name "$PM2_WORKER"

echo "── Restart Web"
pm2 restart "$PM2_WEB" \
  || pm2 start "pnpm --filter web start" --name "$PM2_WEB"

echo "── Save pm2 process list"
pm2 save

echo "── Status"
pm2 list

echo "==> Deploy complete"
