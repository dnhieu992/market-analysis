## Description

Read-only sync of BingX positions into the /trades book. The worker polls the
BingX account every 5 minutes and mirrors currently-open positions — on **both**
the Perpetual Futures (swap) and Standard Futures (standard contract) products —
into the generic `Order` table with `source='bingx'`, so they appear on
`/trades` next to the manual trade book and roll into its statistics.

It is strictly **read-only** (only GET calls; no order placement or cancellation)
and does **no historical backfill**: the first sync only records a start line and
the set of positions already open at that moment; those pre-existing positions are
treated as "past" and ignored forever. Only positions opened from the start line
onward are collected.

## Main Flow

1. `SchedulerService.runBingxOrderSync` fires every 5 min (`*/5 * * * *`, UTC) and
   calls `BingxHistoryService.sync()`. A boot catch-up also runs ~12s after start.
2. The service fetches live positions from both products (independent, non-fatal):
   - Perpetual: `GET /openApi/swap/v2/user/positions`
   - Standard: `GET /openApi/contract/v1/allPosition`
3. **First run only (anchor):** persist `BingxSyncState.historyStartAt = now` and
   `baseline = [current externalIds]`, then return without inserting anything.
4. **Subsequent runs:**
   - **Open:** for each live position whose `externalId` is not in the baseline
     and not already in `Order`, insert an open Order (`source='bingx'`,
     `broker='BingX'` or `'BingX Standard'`, `exchange='BingX'`).
   - **Close:** for each still-open `source='bingx'` Order whose position is no
     longer live, flip it to `closed`, filling close price + realized PnL:
     - Perpetual: `GET /openApi/swap/v1/trade/positionHistory` (uses reported
       `netProfit`/`realisedProfit`). Requires `symbol` + `startTs` + `endTs`;
       omitting them returns error 109400 and yields no close price / PnL.
     - Standard: `GET /openApi/contract/v1/allOrders` (PnL derived from
       close vs entry price, since it isn't reported).
5. `/trades` renders these rows read-only: symbol edit, Close, and Delete are
   hidden for `source='bingx'`; Notes / Journal / Analyze remain available.

### One-off backfill (`src/scripts/bingx-backfill.ts`)

The ongoing sync only reads LIVE positions and, on its first run, baselines-out
whatever was already open — so on initial setup, positions open at that moment and
trades already closed earlier the same day never appear. The backfill runner
covers that gap for the current UTC day:

1. `resetAnchor(dayStart)` — re-anchor with an **empty baseline** so the next
   `sync()` ingests every currently-open position instead of ignoring it.
2. `backfillClosedSince(dayStartMs)` — insert positions CLOSED since 00:00 UTC
   today (both products), deduped by `externalId`. Probes symbols from the union
   of currently-open symbols, `TRACKED_SYMBOLS`, and a majors fallback, because
   the history endpoints require an explicit `symbol`.
3. `sync()` — ingest the currently-open positions via the normal path.

Run: `pnpm --filter worker exec ts-node src/scripts/bingx-backfill.ts`

### externalId scheme (dedupe key, unique on `Order`)
- Perpetual: `bingx-swap-<positionId>`
- Standard: `bingx-std-<symbol>-<side>-<openTimeMs>` (no id in `allPosition`; the
  open time makes a later re-open a distinct order, not a collision).

## Edge Cases
- **No credentials** (`BINGX_API_KEY`/`BINGX_API_SECRET` unset): sync is skipped.
- **One product errors** (e.g. Standard futures not enabled): logged and skipped;
  the other product still syncs.
- **Position opened and closed between two 5-min polls:** never seen live, so never
  ingested — acceptable given the read-only/statistics intent and the 5-min cadence.
- **Close details not found:** the Order is still flipped to `closed` with
  `closedAt=now` and null price/PnL.
- **Live position carrying a `closed` Order (re-open reconcile):** if a position
  the exchange reports LIVE already has a `closed` Order for its `externalId`
  (e.g. the backfill mis-ingested a still-open position from close history, or the
  same position id was genuinely re-opened), the sync flips that row back to
  `open`, clears the close fields, and refreshes entry/qty/openedAt. Without this,
  the open-insert path skipped the existing externalId and the live position never
  returned to /trades.
- **Overlapping runs:** guarded by an in-memory `syncing` flag.
- **Signing:** HMAC-SHA256 (hex) over the exact query string, appended as
  `&signature=`; key in header `X-BX-APIKEY`; every request carries `timestamp`.

## Related Files (FE / BE / Worker)
- `apps/worker/src/modules/bingx-history/bingx-history.service.ts` — the client + sync + backfill logic
- `apps/worker/src/scripts/bingx-backfill.ts` — one-off runner: current-day closed + open backfill
- `apps/worker/src/modules/bingx-history/bingx-history.module.ts` — module
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — the 5-min cron
- `apps/worker/src/modules/scheduler/scheduler.module.ts` — registers the module
- `packages/db/prisma/schema.prisma` — `Order.externalId`, `BingxSyncState`
- `packages/db/prisma/migrations/20260915120000_add_bingx_sync/migration.sql`
- `packages/db/src/repositories/order.repository.ts` — `findByExternalId`, `listOpenBySource`
- `packages/db/src/repositories/bingx-sync-state.repository.ts` — anchor/get state
- `apps/web/src/widgets/trades-history/trades-table.tsx` — read-only rendering for `source='bingx'`
- `apps/web/src/app/globals.css` — `.tt-symbol-btn--readonly`
- `.env.example` — `BINGX_API_KEY` / `BINGX_API_SECRET` / `BINGX_API_BASE_URL`
