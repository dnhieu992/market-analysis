## Description

**Long Signal** is a LONG-only intraday "FOMO" strategy gated by the **M30 UTBot trend**.
Each day at a fixed UTC hour, for each coin in a configured basket (default
POL/XRP/SOL/TAO), the bot checks the UTBot trend on the last closed 30-minute
candle. If the trend is **bull**, it opens a LONG with a fixed USD notional, a
`+tpPct` take-profit, and a wide catastrophe stop-loss; if **bear**, it skips that
coin for the day. Any position still open at the configured exit hour is
force-closed at market.

It mirrors the day-trading feature (DB → worker scanner → API → web feed reusing
the `dt-*` styles) and supports both **PAPER** (persist only) and **LIVE** (real
Bitget USDT-futures orders) modes.

Backtest basis: `scripts/run-long-fomo-m30utbot-filter-backtest.ts` and
`claude-backtest/runs/2026-06-20-long-fomo-m30-utbot-filter.md` — POL/XRP/SOL/TAO,
entry 00:00 UTC, exit 08:00 UTC, TP +2%, UTBot kv=1/ATR10 → +$92.98 net over 365d
on $100/coin (~+23%/yr on $400), win rate 61.1%.

## Main Flow

1. **Entry (hourly cron, acts at `entryHour` UTC)** — for each basket symbol:
   - Skip if a signal already exists for that symbol today (idempotent re-runs).
   - Fetch M30 candles, drop the in-progress last one, evaluate UTBot
     (`keyValue`, `atrPeriod`). Bear → skip; bull → continue.
   - Entry price = live ticker; `takeProfit = entry × (1 + tpPct/100)`,
     `stopLoss = entry × (1 − catastropheStopPct/100)`; size = `notional / entry`.
   - PAPER: persist ACTIVE. LIVE: persist ACTIVE, set leverage, place a market
     LONG with preset TP/SL, store the broker order id (or mark FAILED).
2. **Take-profit** — PAPER: per-minute monitor closes on TP/SL touch vs the live
   price. LIVE: the exchange's preset TP/SL fills; the per-minute reconcile reads
   the real broker fill (close price + net PnL after fees) and closes the DB row.
3. **Force-close (hourly cron, acts at `exitHour` UTC)** — market-close any still-open
   position; LIVE reads the real fill, PAPER estimates from the live price.
4. **Web feed** (`/long-signal`) — stats header, status filters, per-trade cards
   (entry/TP/SL/notional, live unrealized P&L while open, why-this-trade, markdown
   note, manual close). Settings panel edits the strategy knobs.
   - **LIVE on/off toggle** (header) — flips the DB `mode` (PAPER ↔ LIVE) and
     persists immediately. It reads `GET /long-signal/live-status`
     (`envEnabled && bitgetConfigured = armed`) and, when LIVE is selected but
     the server side isn't armed, warns that the bot still runs PAPER.

## Defaults & Margin

- **Default notional `$50` per order**; at the default `5x` leverage that is
  ~`$10` margin per coin per day. Leverage only changes the margin used, not P&L
  (P&L = `qty × Δprice`, `qty = notional / entry`).
- LIVE orders are always placed with **isolated** margin
  (`marginMode: 'isolated'` in `placeLong`).

## Edge Cases

- **No naked LIVE position**: Bitget requires TP and SL on the order; the
  catastrophe SL satisfies this (the backtest had no stop — it is a LIVE safety
  net only, the real exits are the TP and the force-close).
- **Per-symbol precision**: alt contracts have different size/price decimals and
  minimums; the LIVE trade service reads them from `/api/v2/mix/market/contracts`
  and floors size/price before sending. Sub-minimum size is rejected with a clear
  error (signal marked FAILED).
- **Idempotency**: one signal per coin per day; the LIVE order's `clientOid` is the
  signal id so the exchange rejects duplicates.
- **Restart safety**: in-memory state is not relied upon — the per-minute reconcile
  syncs DB-ACTIVE LIVE signals against the real broker state.
- **Race-safe close**: `closeActiveSignal` only writes while still ACTIVE, so a
  manual close, a TP/SL reconcile, and the force-close can't double-close.
- **Hedge vs one-way mode**: `tradeSide`/`holdSide` are sent only in hedge mode
  (`BITGET_POSITION_MODE`), matching the day-trading client.
- **Missing credentials with LIVE on**: falls back to PAPER with a loud error
  rather than dropping the signal.

## Related Files (FE / BE / Worker)

- `packages/db/prisma/schema.prisma` — `LongSignal` + `LongSignalSettings` models
- `packages/db/prisma/migrations/20260620140000_add_long_signal/migration.sql` — tables
- `packages/db/prisma/migrations/20260621150000_long_signal_default_notional_50/migration.sql` — default notional → $50
- `packages/db/src/repositories/long-signal.repository.ts` — repository
- `apps/worker/src/modules/long-signal/long-signal.service.ts` — orchestrator (entry/exit/monitor crons)
- `apps/worker/src/modules/long-signal/long-signal-executor.service.ts` — PAPER/LIVE open
- `apps/worker/src/modules/long-signal/long-signal-trade.service.ts` — authenticated multi-symbol Bitget client (per-contract precision)
- `apps/worker/src/modules/long-signal/bitget.service.ts` — public candle/ticker reads
- `apps/worker/src/modules/long-signal/utbot.ts` — UTBot trend evaluation
- `apps/worker/src/modules/long-signal/long-signal.module.ts` + `worker.module.ts` — wiring
- `apps/api/src/modules/long-signal/long-signal.controller.ts` / `.service.ts` — REST API (signals/stats/settings/prices/live-status/close)
- `apps/api/src/modules/long-signal/dto/*` — request DTOs
- `apps/web/src/_pages/long-signal-page/long-signal-page.tsx` + `app/long-signal/page.tsx` — route
- `apps/web/src/widgets/long-signal/long-signal-feed.tsx` — feed UI (reuses `dt-*` styles)
- `apps/web/src/shared/api/types.ts` + `client.ts` — types + client methods
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry

## Env

- `LIVE_TRADING_ENABLED=true` + `BITGET_API_KEY` / `BITGET_API_SECRET` /
  `BITGET_API_PASSPHRASE` for LIVE mode (plus the `mode: LIVE` setting).
- `BITGET_PRODUCT_TYPE` (default `usdt-futures`), `BITGET_POSITION_MODE`
  (`hedge` default | `one-way`).
