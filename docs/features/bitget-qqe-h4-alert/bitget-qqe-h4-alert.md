## Description
_A worker cron that, after every H4 (4h) candle close, recomputes the colinmck QQE indicator for every coin the trader keeps in the `/bitget` **Setup tab** and sends a Telegram message for each coin whose just-closed 4h candle is a **fresh** QQE flip — Long (bull) or Short (bear). It mirrors the QQE the Setup-tab "QQE" column already shows, so the alert fires on exactly the same Long/Short signal, without the trader having to watch the page._

## Main Flow
1. `SchedulerService.runBitgetQqeH4Alert()` fires at `15 0 0,4,8,12,16,20 * * *` UTC — 15 seconds after each H4 candle close (00/04/08/12/16/20 UTC). The 15s offset lets the just-closed candle land on Binance before it is read.
2. `BitgetQqeAlertService.checkAndAlert()`:
   - Loads all Setup-tab configs via `createBitgetSetupConfigRepository().findAll()` and reduces them to the distinct bare coin symbols (e.g. `BTCUSDT` → `BTC`).
   - For each coin (pooled, max 6 concurrent Binance calls): fetches the last 200 4h klines, drops the still-forming candle (`closeTime > now`), and runs `calculateQqe` from `@app/core` with the same params as the chart (`rsiPeriod 10, smoothing 4, qqeFactor 3.2`).
   - A coin qualifies only when `cross[]`'s **last** element is non-null — i.e. the just-closed candle IS the flip bar (a brand-new signal).
3. If any coin flipped, one Telegram message (HTML, Vietnamese) is sent to `TELEGRAM_CHAT_ID` listing each coin with 🟢 BULL / 🔴 BEAR.

## Manual Trigger (testing)
Run on demand instead of waiting for the H4-close cron (on the server, where `.env` has `DATABASE_URL` / `TELEGRAM_*`):
- `pnpm --filter worker qqe:trigger` — runs the **exact production path** (`checkAndAlert()`); Telegrams only if a coin's just-closed 4h candle is a fresh flip, so it may send nothing.
- `pnpm --filter worker qqe:trigger -- --preview` — sends a clearly-labelled "manual test" Telegram listing the **current** QQE regime (bull/bear) of every Setup coin, regardless of freshness. Use this to confirm the full DB → Binance → QQE → Telegram chain end-to-end.

The script (`apps/worker/src/scripts/trigger-qqe-alert.ts`) bootstraps a standalone Nest context from `BitgetQqeAlertModule` only — it does **not** start the scheduler crons. `--preview` uses `BitgetQqeAlertService.previewCurrentStates()`, which shares the `crossFor()` fetch/compute helper with `checkAndAlert()` (single source of truth, `mode: 'current'` vs `'fresh'`).

## Edge Cases
- **No dedup store needed** — `freshCross` gates the send, so each flip alerts exactly once. The next H4 tick sees a different "last closed candle" and will not re-fire the same flip.
- **Empty Setup tab** — logs and returns without sending.
- **Overlap guard** — a `running` flag skips a tick if the previous one is still in flight.
- **Per-coin fetch/compute failure** — logged as a warning and skipped; other coins still alert.
- **Too few candles** (`< 60` closed) — coin skipped (QQE bands not warmed).
- **Telegram failure** — `TelegramService.sendToChat` never throws; failure is logged and the tick still completes.
- **Side-agnostic** — a coin shows both long/short rows in the Setup tab, but QQE is per-coin, so it is scanned once regardless of how many config rows it has.

## Related Files (FE / BE / Worker)
- `apps/worker/src/modules/bitget-qqe-alert/bitget-qqe-alert.service.ts` — Worker: loads Setup coins, computes QQE on the closed H4 candle, formats + sends the alert; also exposes `previewCurrentStates()` for the manual trigger
- `apps/worker/src/scripts/trigger-qqe-alert.ts` — Worker: manual CLI trigger (`qqe:trigger`, `--preview`) to run/test the alert on demand
- `apps/worker/src/modules/bitget-qqe-alert/bitget-qqe-alert.module.ts` — Worker: wires the service to `MarketModule` + `TelegramModule`
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — Worker: `runBitgetQqeH4Alert()` cron at the H4 close
- `apps/worker/src/modules/scheduler/scheduler.module.ts` — Worker: imports `BitgetQqeAlertModule`
- `packages/core/src/indicators/qqe.ts` — Shared: `calculateQqe` (the QQE cross series)
- `packages/db/src/repositories/bitget-setup-config.repository.ts` — Shared: `findAll()` for the Setup-tab coin list
- `apps/api/src/modules/bitget/setup-chart-renderer.ts` — API: `QQE_PARAMS` source of truth the worker's params must match
