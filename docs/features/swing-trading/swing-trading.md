## Description

Swing Trading is a full-stack feature (web page + API + worker) that runs the
**UTBot trend stop-and-reverse strategy on candle close** — the flow validated in
`claude-backtest/` (ETH H4, keyValue=2 default). It mirrors the Day Trading feature
but uses a single always-in-market position that flips direction whenever a closed
candle confirms a UTBot trend change. Built to graduate from PAPER simulation to
**live Bitget execution** via a localized executor seam.

## Main Flow

1. **Worker scan** (`SwingTradingService`, cron `0 1 */4 * * *` UTC — just after each H4 close):
   - Load `SwingTradingSettings` (symbol, timeframe, atrPeriod, keyValue, riskPerTrade, leverage, mode).
   - **Resolve keyValue** (`resolveKeyValue` in `utbot-kv-table.ts`): a positive `settings.keyValue`
     is an explicit override; `<= 0` ("auto") looks up the optimal kv for `SYMBOL:timeframe`
     (e.g. ETHUSDT:4h→2, BNBUSDT:4h→4), falling back to `DEFAULT_KEY_VALUE` (2) for unknown combos.
   - Fetch candles from Bitget (`SwingBitgetService`), **drop the in-progress last candle**.
   - Evaluate UTBot (`UtBotStrategyService`): `nLoss = keyValue × ATR(atrPeriod)`, `trend = close > stop ? bull : bear`.
   - Compare trend to the open position (which may be several legs — a BASE + pullback adds):
     - **no position** → open a BASE leg in the trend direction.
     - **position == trend** → keep; sync the trailing UTBot stop on every leg (display);
       then maybe fire a **pullback scale-in** (see below).
     - **position != trend** → **flip**: close **ALL** legs at the candle close (gross P&L each), open the reverse BASE leg.
   - **Pullback add-on** (`pullback-addon.ts`, gated to effective `keyValue === 4`): while aligned
     with the trend, when the close returns within **1%** of the UTBot line, open one more leg in the
     trend direction (`legKind: 'ADD'`). Re-arm only after price moves **>1%** away from the line and
     returns; **max 3 adds** per trend leg. The re-arm flag (`pullbackArmed`) lives on the BASE leg.
     Backtest finding: the rule amplifies clean (kv=4) trends but bleeds on chop (kv=2/3), hence the gate
     (`claude-backtest/runs/2026-06-15-pullback-addon-rule.md`).
2. **Execution** (`SwingExecutorService`): PAPER persists the position to `swing_trading_signals`;
   LIVE (future) places the real Bitget order at the same seam. Sizing: `notional = riskPerTrade × leverage`, `qty = notional / entryPrice`.
3. **API** (`/swing-trading/*`): list signals, stats (wins/losses/winRate/pnl), live price, per-signal note, settings GET/PUT.
4. **Web** (`/swing-trading`): stats header, status filter (Tất cả / Đang mở / Đã đóng), signal cards
   (entry, UTBot flip level, notional, live unrealized P&L + distance-to-flip), markdown note, settings panel.

## Edge Cases

- **Auto keyValue**: `settings.keyValue <= 0` means "auto" → per-symbol/timeframe optimum from
  `utbot-kv-table.ts` (backtest-derived). Unknown symbol/timeframe → `DEFAULT_KEY_VALUE` (2).
  The kv table reflects a single year/regime — re-run `claude-backtest/` and update it periodically.
- **Pullback add-on gate**: scale-in legs only fire when the effective `keyValue === 4`
  (`PULLBACK_KEYVALUE`). At any other kv the add-on is inert — the flow is the plain stop-and-reverse.
- **Pullback re-arm state**: `pullbackArmed` is tracked only on the BASE leg and reset to `false`
  whenever a fresh BASE opens (first entry or flip), so each trend leg re-arms independently.
- **Multi-leg flip**: a flip closes every ACTIVE leg for the symbol (base + adds), each booked as its
  own realized `pnlUsd`, then opens one fresh BASE leg.
- **In-progress candle**: the scan drops the last candle so it only acts on a confirmed close (`candles.slice(0, -1)`).
- **Idempotent re-run**: a second scan in the same candle sees the position already matching the trend
  → re-syncs the stop and re-evaluates the deterministic add-on rule; it opens no duplicate entry
  because firing an add immediately clears `pullbackArmed`.
- **Insufficient candles** (`< atrPeriod + 3`) → scan logs and returns.
- **Bitget/price failure**: candle fetch returns `[]` (scan skips); live price falls back to last cached value, never throws.
- **No fixed TP/SL**: `takeProfit` stored as 0; exit is purely the trend flip. Win/loss derived from realized `pnlUsd` sign.
- **P&L is gross** (fees excluded) to mirror the day-trading monitor; real Bitget fees (~0.05%/side) reduce live results — see `claude-backtest/`.

## Related Files (FE / BE / Worker)

- `apps/web/src/app/swing-trading/page.tsx` — route (thin re-export)
- `apps/web/src/_pages/swing-trading-page/swing-trading-page.tsx` — server component, loads initial data
- `apps/web/src/widgets/swing-trading/swing-trading-feed.tsx` — client widget (cards, stats, filters, settings); reuses `dt-*` CSS
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — "Swing Trading" nav entry
- `apps/web/src/shared/api/types.ts` — `SwingTradingSignal/Stats/Settings/Price` types
- `apps/web/src/shared/api/client.ts` — `fetchSwingTrading*` / `updateSwingTrading*` methods
- `apps/api/src/modules/swing-trading/swing-trading.controller.ts` — `/swing-trading/*` routes
- `apps/api/src/modules/swing-trading/swing-trading.service.ts` — signals/stats/settings + live Bitget price
- `apps/api/src/modules/swing-trading/dto/*` — query/update-settings/update-note DTOs
- `apps/api/src/app.module.ts` — registers `SwingTradingModule`
- `apps/worker/src/modules/swing-trading/swing-trading.service.ts` — cron orchestrator + flip logic
- `apps/worker/src/modules/swing-trading/utbot-strategy.service.ts` — UTBot ATR stop computation
- `apps/worker/src/modules/swing-trading/utbot-kv-table.ts` — optimal keyValue lookup per symbol/timeframe (`resolveKeyValue`)
- `apps/worker/src/modules/swing-trading/pullback-addon.ts` — pullback scale-in rule (gate + `evaluateAddOn`)
- `apps/worker/src/modules/swing-trading/bitget.service.ts` — Bitget candles + ticker (per-symbol)
- `apps/worker/src/modules/swing-trading/swing-executor.service.ts` — open/close/sync position (PAPER now, Bitget LIVE seam)
- `apps/worker/src/modules/swing-trading/swing-trading.module.ts` — worker module
- `apps/worker/src/worker.module.ts` — registers `SwingTradingModule`
- `packages/db/prisma/schema.prisma` — `SwingTradingSignal` + `SwingTradingSettings` models
- `packages/db/prisma/migrations/20260615045030_add_swing_trading/migration.sql` — tables
- `packages/db/prisma/migrations/20260615122530_swing_pullback_addon/migration.sql` — `legKind` + `pullbackArmed` columns
- `packages/db/src/repositories/swing-trading.repository.ts` — `createSwingTradingRepository`
