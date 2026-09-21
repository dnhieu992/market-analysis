## Description
Read-only sync of live OKX USDT-perpetual (SWAP) positions into the generic `Order` table
(`source='okx'`) so they appear on `/trades` alongside manual trades and the BingX-synced ones.
This is the OKX twin of the BingX order sync — same anchor/baseline model, same close-reconcile,
same false-close protection. Read-only: only GET calls, never places or cancels anything.

## Main Flow
1. `SchedulerService.runOkxOrderSync` runs every 5 min (UTC); `OkxHistoryService` also does one
   catch-up sync ~14s after boot. No-op when OKX credentials are not configured.
2. Fetch live positions: `GET /api/v5/account/positions?instType=SWAP`, keep rows with size ≠ 0.
   Contracts are converted to base-asset quantity via each instrument's `ctVal`
   (`GET /api/v5/public/instruments`, cached).
3. **First run only anchors**: records `historyStartAt` + the currently-open externalIds
   (`baseline`) in `okx_order_sync_state`, and ingests nothing (no historical backfill).
4. Subsequent runs:
   - New position (posId unseen, not in baseline) → insert an open `Order` (`externalId=okx-<posId>`,
     `broker='OKX'`, `exchange='OKX'`, `orderType='perpetual'`).
   - Still-open tracked position whose entry/size/leverage changed → patch the row.
   - Tracked open Order no longer live → flip to `closed`, filling close price + realized PnL from
     `GET /api/v5/account/positions-history` (`closeAvgPx`, `realizedPnl`/`pnl`, `uTime`).
5. `/trades` shows the rows automatically — the broker filter is populated from distinct brokers,
   so "OKX" appears as a new option with no web changes.

## Edge Cases
- **Fetch failure vs empty**: a failed/timed-out positions read is distinguished from a genuinely
  empty one (`ok` flag). On failure the close-reconcile is skipped entirely, so tracked orders are
  not false-closed and re-opened (the ~5-min flicker the BingX sync also guards against).
- **First-run anchor** is skipped if the positions fetch failed, so the baseline is never captured
  from an incomplete set.
- **Net vs long/short mode**: side comes from `posSide` when explicit, else the sign of `pos`.
- **posId re-open**: a live position whose stored Order is `closed` is reconciled back to open and
  its stale close fields cleared.
- **Baseline vs. reconcile**: the baseline only suppresses *creating* new orders for pre-existing
  positions. If an order already exists for a baselined position's externalId (e.g. a manual order
  linked to it), it is still reconciled — so adding volume to a baselined position updates the row
  (`findByExternalId` runs before the baseline skip). Same fix applied to the BingX sync.
- **Overlap-guarded** with an in-flight flag so a slow run can't overlap the next tick.
- Realized PnL prefers OKX's `realizedPnl` (incl. fees/funding), then `pnl`, then a price-derived fallback.

## Configuration
Requires these env vars in the monorepo-root `.env` (worker reads `process.env`):
- `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE` — read-only API key is sufficient.
- Optional: `OKX_API_BASE_URL` (host override), `OKX_SIMULATED=true` (route to demo trading).

Signing: base64 HMAC-SHA256 over `ISO-timestamp + "GET" + requestPath(+query)`; headers
`OK-ACCESS-KEY/-SIGN/-TIMESTAMP/-PASSPHRASE`.

## Related Files (Worker / DB)
- `apps/worker/src/modules/okx-history/okx-history.service.ts` — the sync engine (fetch/anchor/insert/close)
- `apps/worker/src/modules/okx-history/okx-history.module.ts` — Nest module
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — `runOkxOrderSync` cron + DI
- `apps/worker/src/modules/scheduler/scheduler.module.ts` — imports `OkxHistoryModule`
- `apps/worker/test/stubs/app-db.ts` — stub `createOkxOrderSyncStateRepository` for worker-bootstrap
- `packages/db/src/repositories/okx-order-sync-state.repository.ts` — anchor/baseline singleton repo
- `packages/db/prisma/schema.prisma` — `OkxOrderSyncState` model (`okx_order_sync_state`)
- `packages/db/prisma/migrations/20260921140000_add_okx_order_sync_state/migration.sql` — table migration
- `packages/db/src/repositories/order.repository.ts` — reused generic `Order` repo (`source='okx'`)
