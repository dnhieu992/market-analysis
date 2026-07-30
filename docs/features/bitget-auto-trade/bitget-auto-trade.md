## Description
**"Auto vào lệnh"** — a per-coin switch on the `/bitget` **Setup** tab that lets the server trade
one fixed, long-only strategy on that coin without any click:

1. **00:00 UTC** every day — open a **market LONG** in **cross** margin, sized from that coin's
   saved **LONG** setup config (leverage + margin from `bitget_setup_configs`).
2. Immediately place a **take-profit at entry +2%** on the exchange. The 2% is a **price** move,
   **before leverage** — at 10× that is roughly +20% ROE. The TP is a real Bitget position plan
   order, so it fires even when this app is down.
3. **09:00 UTC** — review every live auto position:
   - PnL **≥ −0.5%** (in profit, flat, or down at most 0.5%) → **force-close at market**.
   - PnL **< −0.5%** → **leave the position running**, but move the **TP down to the entry
     price**, so a recovery exits at break-even (minus fees) instead of chasing +2%.

There is **no stop-loss** by design, and an extended position has no time limit — it lives until
its break-even TP hits.

The switch is stored in `bitget_auto_trade_configs`; every day the engine touches a coin it
writes one row to `bitget_auto_trade_runs`, which doubles as the **idempotency guard** (unique on
`symbol + tradeDate`) and the **audit trail** shown at the bottom of the coin's ⚙ dialog.

> ⚠️ **Backtest context (2026-07-30):** this exact rule was measured on ETH 2025-01-01 → 2026-07-30
> (576 trades, fee 0.06%/side, no leverage) in
> [`claude-backtest/runs/2026-07-30-eth-0000-long-tp2-close0800.md`](../../../claude-backtest/runs/2026-07-30-eth-0000-long-tp2-close0800.md):
> win rate 51.9%, **profit factor 0.83**, $1000 compounded → **$482**. The "extend at −0.5%,
> TP back to entry" variant was measured separately
> ([`…-tp2-extend-recover.md`](../../../claude-backtest/runs/2026-07-30-eth-0000-long-tp2-extend-recover.md))
> and came out **worse** (PF 0.76, max DD 68.6%). The feature is implemented as specified; the
> numbers are recorded here so the switch is never flipped on by accident.

## Main Flow
1. Trader opens `/bitget` → **Setup** tab → the row's **⚙** → ticks **Auto vào lệnh** → **Lưu**.
   The web layer saves the LONG/SHORT config first, then `PUT /bitget/auto-trade { symbol, enabled }`.
   `BitgetAutoTradeService.setEnabled()` refuses to arm a coin with no saved LONG margin (400).
   An armed coin shows an **AUTO** badge next to its name, whose tooltip carries the strategy and
   the latest run's detail line.
2. **00:00:05 UTC** (`@Cron('5 0 0 * * *', { timeZone: 'UTC' })` → `runEntry()`): for every enabled
   coin, in sequence —
   - a run row already exists for today's UTC date → **skip** (nothing is ever opened twice);
   - no LONG config with margin > 0 → row `status = skipped`;
   - a LONG position is **already open** on the exchange → row `status = skipped` (the engine never
     scales into a position it does not own, and never exposes a manual position to the 09:00 close);
   - otherwise `BitgetService.openPosition()` places the market order, the position is read back
     ~1.5s later for its true `openPriceAvg` + exchange `cTime`, `BitgetService.setTpsl()` places
     the **+2% TP**, and the run is written as `status = open` with entry, size, leverage, margin,
     TP and `openedAt`.
3. **09:00:00 UTC** (`@Cron('0 0 9 * * *', …)` → `runReview()`): for every run in `open` /
   `extended` —
   - the position is **gone** from the exchange → `closed` (`tp_or_manual`, or `breakeven_hit`
     for an extended one);
   - the live position's `cTime` differs from the recorded `openedAt` by more than 10 minutes →
     it is **not the engine's position** → the run is closed as `position_changed` and nothing is
     touched on the exchange;
   - `status = extended` already → nothing to do, the break-even TP on the exchange does the work;
   - PnL `(mark − entry) / entry × 100 ≥ −0.5%` → `BitgetService.closePosition()` at market, run
     → `closed` (`forced_review`);
   - PnL `< −0.5%` → `setTpsl(takeProfitPrice = entry)`, run → `extended`.
4. The trader can re-open the ⚙ dialog any time to read the latest run line
   (`GET /bitget/auto-trade` returns each coin's switch + latest run).
   `POST /bitget/auto-trade/run { phase: 'entry' | 'review' }` runs either pass **immediately
   against the live account** — the same code path the cron uses — for verifying a setup without
   waiting for the hour.

## Edge Cases
- **Cron fires twice / manual trigger during a cron pass:** an in-process `running` flag rejects
  the overlapping pass, and the `(symbol, tradeDate)` unique key rejects a second entry for the
  day even across a restart.
- **App down at 00:00:** no entry is taken that day (no catch-up — a 06:00 entry is a different
  trade from the one the strategy defines).
- **App down at 09:00:** the run stays `open`; the next 09:00 pass picks it up and force-closes /
  extends it then. The +2% TP is on the exchange throughout, so the position is never unprotected.
- **Position already open at 00:00** (yesterday's extended trade, or a manual one): the day is
  **skipped** and logged; the engine neither adds volume nor manages that position.
- **Manual position opened after the auto one closed:** the `cTime` guard (10-min tolerance)
  stops the 09:00 pass from force-closing it.
- **TP placement fails after the entry filled:** the run is still recorded as `open` (with the
  error in `detail`) — the position exists and must be managed at 09:00 — and the failure is
  logged at `error` level. `tpPrice` stays null so the UI shows no TP was set.
- **Entry order fails** (insufficient margin, size below the contract minimum, exchange error):
  the run is written as `failed` with the message, which also blocks a retry that day.
- **Bitget credentials missing:** both passes log a warning and return without touching anything.
- **Margin too small for the contract minimum:** surfaces as a `failed` run carrying the API's
  Vietnamese "ký quỹ quá nhỏ" message.
- **`setTpsl` direction check:** the break-even TP is only ever placed while the position is more
  than 0.5% underwater, so `TP > markPrice` always holds for a long — the API's direction guard
  can never reject it.
- **A stop-loss placed by hand on an auto position:** `setTpsl` clears whatever it is not given,
  so the 09:00 extend path reads the live `pos_loss` trigger back and re-sends it with the
  break-even TP. If that read fails the stop is dropped (logged as a warning) — leaving the
  position without its break-even exit was judged the worse outcome.
- **Fees:** a break-even exit still loses the round-trip fee (~0.12% at Bitget market rates, see
  `project_bitget_real_fee`) — "hoà vốn" is on price, not on PnL.

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/bitget/bitget-auto-trade.service.ts` — the engine: both `@Cron` passes, `runEntry()` / `runReview()`, the per-coin `enterOne()` / `reviewOne()` steps, `list()` / `setEnabled()` for the UI, and the strategy constants (`TP_PCT`, `KEEP_THRESHOLD_PCT`, cron expressions, `POSITION_MATCH_TOLERANCE_MS`).
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/auto-trade`, `PUT /bitget/auto-trade`, `POST /bitget/auto-trade/run`.
- `apps/api/src/modules/bitget/dto/upsert-auto-trade.dto.ts` — validates `{ symbol, enabled }`.
- `apps/api/src/modules/bitget/dto/run-auto-trade.dto.ts` — validates `{ phase: 'entry' | 'review' }`.
- `apps/api/src/modules/bitget/bitget.module.ts` — registers `BitgetAutoTradeService`.
- `apps/api/src/modules/bitget/bitget.service.ts` — reused as-is for `openPosition()`, `setTpsl()`, `closePosition()` (each writes its own journal system log).
- `apps/api/src/modules/bitget/bitget-trade.client.ts` — `getPosition()` (live entry/mark/cTime) + `isConfigured()` used directly by the engine.
- `packages/db/prisma/schema.prisma` — `BitgetAutoTradeConfig` (`bitget_auto_trade_configs`) and `BitgetAutoTradeRun` (`bitget_auto_trade_runs`, unique on `symbol + tradeDate`).
- `packages/db/prisma/migrations/20260730120000_add_bitget_auto_trade/migration.sql` — both tables' DDL.
- `packages/db/src/repositories/bitget-auto-trade.repository.ts` — `createBitgetAutoTradeConfigRepository` (`findAll`, `findEnabled`, `upsert`) and `createBitgetAutoTradeRunRepository` (`findByDate`, `create`, `findLive`, `update`, `findLatestPerSymbol`).
- `apps/web/src/widgets/bitget/coin-setup-dialog.tsx` — the ⚙ dialog block that arms the strategy, spells out its rules, and shows the coin's latest run.
- `apps/web/src/widgets/bitget/bitget-setup-feed.tsx` — hydrates `GET /bitget/auto-trade`, renders the **AUTO** badge, and `saveCoinSetup()` (sides first, then the switch).
- `apps/web/src/shared/api/client.ts` — `fetchBitgetAutoTrades()`, `saveBitgetAutoTrade()`.
- `apps/web/src/shared/api/types.ts` — `BitgetAutoTrade`, `BitgetAutoTradeStatus`.
- `apps/web/src/app/globals.css` — `.bg-auto-badge`, `.bg-auto-block`, `.bg-auto-head/-title/-state`, `.bg-auto-rules`, `.bg-auto-run*`, `.bg-setup-btn--coin`.
- `claude-backtest/runs/2026-07-30-eth-0000-long-tp2-close0800.md` + `…-extend-recover.md` — the measured edge of this exact rule set.
