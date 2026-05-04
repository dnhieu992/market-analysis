#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
# Load env vars
if [ -f .env ]; then
  set -a && source .env && set +a
fi

PM2_API="market-api"       # runs on PORT from .env (default 3000)
PM2_WORKER="market-worker"
PM2_WEB="market-web"       # runs on port 3001
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
pm2 delete "$PM2_API" 2>/dev/null || true
sleep 1
pm2 start dist/apps/api/src/main.js --name "$PM2_API" --cwd apps/api

echo "── Restart Worker"
pm2 delete "$PM2_WORKER" 2>/dev/null || true
pm2 start dist/apps/worker/src/main.js --name "$PM2_WORKER" --cwd apps/worker

echo "── Restart Web"
pm2 delete "$PM2_WEB" 2>/dev/null || true
pm2 start "node_modules/.bin/next start -p 3001" --name "$PM2_WEB" --cwd apps/web

echo "── Save pm2 process list"
pm2 save

echo "── Status"
pm2 list

echo "==> Deploy complete"
