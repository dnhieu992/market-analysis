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

echo "── Run worker tests (gate — aborts deploy on failure)"
# A red suite here means a regression in worker analysis/signal logic — stop
# before it reaches production (set -e aborts).
pnpm --filter worker test

echo "── Stop running apps to free RAM for the build"
# This box has 2 vCPU / 3.8GB and no swap. The three pm2 apps hold ~440MB that
# the build needs; leaving them up during `next build` is what triggers the
# OOM killer. They get deleted + restarted below anyway, so stopping is free
# apart from the downtime. Placed AFTER the test gate so a red suite leaves
# production untouched.
pm2 stop "$PM2_API" "$PM2_WORKER" "$PM2_WEB" 2>/dev/null || true

echo "── Build all apps"
# --workspace-concurrency=1 forces one workspace at a time. pnpm defaults to 4,
# which fires tsc for core/db/api/worker alongside `next build` on 2 cores.
pnpm -r --workspace-concurrency=1 build

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
