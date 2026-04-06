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
pm2 restart "$PM2_API" \
  || pm2 start apps/api/dist/apps/api/src/main.js --name "$PM2_API"

echo "── Restart Worker"
pm2 restart "$PM2_WORKER" \
  || pm2 start apps/worker/dist/apps/worker/src/main.js --name "$PM2_WORKER"

echo "── Restart Web"
if pm2 describe "$PM2_WEB" > /dev/null 2>&1; then
  pm2 restart "$PM2_WEB" --update-env
else
  pm2 start apps/web/node_modules/.bin/next \
    --name "$PM2_WEB" \
    --cwd apps/web \
    --env production \
    -- start -p 3001
fi

echo "── Save pm2 process list"
pm2 save

echo "── Status"
pm2 list

echo "==> Deploy complete"
