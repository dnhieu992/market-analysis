## Description
_A worker cron that, after every H4 (4h) **and** D1 (daily) candle close, recomputes the colinmck QQE indicator for every coin the trader keeps in the `/bitget` **Setup tab** and sends a Telegram message for each coin whose just-closed candle is a **fresh** QQE flip — Long (bull) or Short (bear). It mirrors the QQE the Setup-tab "QQE" column already shows, so the alert fires on exactly the same Long/Short signal, without the trader having to watch the page. Each message header is labelled `[H4]` or `[D1]` so the two timeframes are easy to tell apart._

## Main Flow
1. Two crons in `SchedulerService`, both `timeZone: 'UTC'`:
   - `runBitgetQqeH4Alert()` at `15 0 0,4,8,12,16,20 * * *` — 15 seconds after each H4 candle close (00/04/08/12/16/20 UTC) → `checkAndAlert('4h')`.
   - `runBitgetQqeD1Alert()` at `30 0 0 * * *` — 30 seconds after the daily candle close (00:00 UTC) → `checkAndAlert('1d')`. (Requested cadence: 00:00 UTC ±10 min.)
   - The seconds offset lets the just-closed candle land on Binance before it is read. Around 00:00 UTC both fire; each sends its own labelled message.
2. `BitgetQqeAlertService.checkAndAlert(timeframe)`:
   - Loads all Setup-tab configs via `createBitgetSetupConfigRepository().findAll()` and reduces them to the distinct bare coin symbols (e.g. `BTCUSDT` → `BTC`).
   - For each coin (pooled, max 6 concurrent Binance calls): fetches the last 200 klines **for that timeframe** (`4h` or `1d`), drops the still-forming candle (`closeTime > now`), and runs `calculateQqe` from `@app/core` with the same params as the chart (`rsiPeriod 10, smoothing 4, qqeFactor 3.2`).
   - A coin qualifies only when `cross[]`'s **last** element is non-null — i.e. the just-closed candle IS the flip bar (a brand-new signal).
3. **A Telegram message is sent on every candle close** (HTML, Vietnamese) to `TELEGRAM_CHAT_ID`:
   - If any coin flipped → `🔔 [H4] QQE — tín hiệu mới` / `🔔 [D1] …`, listing each coin with 🟢 BULL / 🔴 BEAR.
   - If nothing flipped (or the Setup tab is empty) → a heartbeat `🔕 [H4] QQE — không có tín hiệu mới` ("Đã quét N coin, không có coin nào vừa đảo chiều QQE."), so silence never looks like a broken bot.
   - Both carry the `⏱ Nến H4 / D1 (ngày) vừa đóng cửa` footer.

## Manual Trigger (testing)
Run on demand instead of waiting for the candle-close cron (on the server, where `.env` has `DATABASE_URL` / `TELEGRAM_*`):
- `pnpm --filter worker qqe:trigger` — runs the **exact production path** (`checkAndAlert('4h')`); Telegrams only if a coin's just-closed 4h candle is a fresh flip, so it may send nothing.
- `pnpm --filter worker qqe:trigger -- --preview` — sends a clearly-labelled "manual test" Telegram listing the **current** QQE regime (bull/bear) of every Setup coin, regardless of freshness. Use this to confirm the full DB → Binance → QQE → Telegram chain end-to-end.
- Add `--d1` to either form to target the daily candle instead of H4 (e.g. `qqe:trigger -- --d1`, `qqe:trigger -- --d1 --preview`).

The script (`apps/worker/src/scripts/trigger-qqe-alert.ts`) bootstraps a standalone Nest context from `BitgetQqeAlertModule` only — it does **not** start the scheduler crons. `--preview` uses `BitgetQqeAlertService.previewCurrentStates(timeframe)`, which shares the `crossFor()` fetch/compute helper with `checkAndAlert()` (single source of truth, `mode: 'current'` vs `'fresh'`).

## Edge Cases
- **No dedup store needed** — `freshCross` gates the send, so each flip alerts exactly once. The next tick sees a different "last closed candle" and will not re-fire the same flip.
- **Empty Setup tab** — sends the `🔕 … không có tín hiệu mới` heartbeat ("Setup tab đang trống") instead of staying silent.
- **No fresh flips** — sends the heartbeat too; a candle close is never silent.
- **Overlap guard** — a per-timeframe `running` set skips a tick if the previous one of the **same** timeframe is still in flight; H4 and D1 (both near 00:00 UTC) may run concurrently without blocking each other.
- **Per-coin fetch/compute failure** — logged as a warning and skipped; other coins still alert.
- **Too few candles** (`< 60` closed) — coin skipped (QQE bands not warmed). For D1 this needs ~60 days of daily history, which Binance provides in the 200-kline fetch.
- **Telegram failure** — `TelegramService.sendToChat` never throws; failure is logged and the tick still completes.
- **Side-agnostic** — a coin shows both long/short rows in the Setup tab, but QQE is per-coin, so it is scanned once regardless of how many config rows it has.

## Related Files (FE / BE / Worker)
- `apps/worker/src/modules/bitget-qqe-alert/bitget-qqe-alert.service.ts` — Worker: loads Setup coins, computes QQE on the closed H4/D1 candle, formats + sends the labelled alert; also exposes `previewCurrentStates(timeframe)` for the manual trigger
- `apps/worker/src/scripts/trigger-qqe-alert.ts` — Worker: manual CLI trigger (`qqe:trigger`, `--preview`, `--d1`) to run/test the alert on demand
- `apps/worker/src/modules/bitget-qqe-alert/bitget-qqe-alert.module.ts` — Worker: wires the service to `MarketModule` + `TelegramModule`
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — Worker: `runBitgetQqeH4Alert()` (H4 close) + `runBitgetQqeD1Alert()` (00:00 UTC daily close) crons
- `apps/worker/src/modules/scheduler/scheduler.module.ts` — Worker: imports `BitgetQqeAlertModule`
- `packages/core/src/indicators/qqe.ts` — Shared: `calculateQqe` (the QQE cross series)
- `packages/db/src/repositories/bitget-setup-config.repository.ts` — Shared: `findAll()` for the Setup-tab coin list
- `apps/api/src/modules/bitget/setup-chart-renderer.ts` — API: `QQE_PARAMS` source of truth the worker's params must match
