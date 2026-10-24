## Description
Swing trade journal on `/tracking-coins` (added 2026-10-24). Setups (4H–1D) come from Claude
or are typed by hand, run as **paper trades only**, and every step is logged so the user and
Claude can learn from them. Nothing shows on Trading Analysis; skills on `/skills` can only
read the active setups (the `activeSetups` column of `get_tracking_coins`).

It replaces the old signal scanner: `tracking_coin_signals`, `tracking_coin_signal_history`,
`tracking_coin_orders` and the worker `backtest:orders` script were dropped (backup:
`~/backups/tracking-signals-20261024-1629.sql.gz` on the VPS). Coins and DCA links stay.

## Lifecycle
`PROPOSED` (Claude suggested it) → `WATCHING` (idea kept, waiting for its trigger) →
`PENDING` (LIMIT/STOP placed, never expires) → `OPEN` → `CLOSED`.
Side exits: `DISCARDED` (idea dropped), `CANCELLED` (pending order cancelled).
MARKET — or a LIMIT/STOP whose price is already through — fills at once when placed.

- 1R = `tracking_trade_config.riskUsd` (default $10, editable in the "Lệnh & nhật ký" tab);
  quantity = riskUsd / |fill − SL|, frozen when placed.
- Targets 1–3, default split 50/30/20 (editable per setup). TP1 → SL to break-even,
  TP2 → SL to TP1. Fee 0.05 % per side (`FEE_PCT`).
- Manual move-SL / close (25–100 %) need a reason and set `manualIntervention`.

## Monitor
`TrackingTradesService.scheduledTick` (cron `40 * * * * *` in the API) replays Binance 1m
candles since `lastCheckedAt` through the pure engine `tracking-engine.ts`: stop is checked
before targets, on the fill candle only the stop counts, gaps fill at the open. It tracks
MFE/MAE (R) and an hourly R path (`pathR`). Updates are optimistic (`updateIfUnchanged`).

On PLACED / FILLED / CLOSED a 4H chart is rendered to R2 (`tracking-charts/`) and attached to
the event. After a close Claude writes a post-mortem (`ClaudeChatProvider.chat`); it can be
rewritten from the card.

## Learning loop
- User self-rating 1–5 + note on each closed setup.
- Stats by setup type, coin, direction, source, intervention and close reason.
- Every 100 closed setups not in a batch, Claude drafts a lesson batch
  (`tracking_lesson_batches`); the user edits and approves it. Only **approved** lessons are
  added to later analyses (`buildTrackingContext`).

## Claude analysis
Hidden skill `tracking-swing` (`packages/skills/src/tracking-swing`, not on `/skills`).
A conversation created with `symbol` stores `metadata.symbol`; its system prompt gets the
time plus `buildTrackingContext(symbol)` (active setups, closed stats, approved lessons, 1R).
Claude proposes setups with the `propose_swing_setup` tool → `PROPOSED` rows linked to the
reply message (`ChatMessage.trackingSetups`). The first reply of a coin chat is also saved as
an `ANALYSIS` event in the journal. A conversation without `symbol` is the "Quét cả danh
sách" scan over the whole watchlist.

## UI (`apps/web/src/widgets/tracking-coins/`)
- `tracking-coins-feed.tsx` — tabs **Coins** (table + "Setup" badge column) and
  **Lệnh & nhật ký**; a row click opens the coin panel; "🧭 Quét" opens the scan panel.
- `coin-panel.tsx` — right drawer: **Phân tích** (chat with live progress, stop/retry,
  follow-ups, setup cards), **Lệnh** (setup cards + manual setup), **Nhật ký** (events,
  chart snapshots, notes with images).
- `setup-card.tsx` — card with stage actions; `SetupFormModal` for new/edit.
- `trades-tab.tsx` — all setups with filters, stats, lesson batches, 1R config.

## API (`/tracking-trades`)
`GET /` overview · `GET /active-by-coin` · `GET /coin/:symbol` · `GET /:id` ·
`POST /` (manual, `place: true` to place at once) · `PUT /:id` (edit unplaced plan) ·
`POST /:id/watch|place|discard|cancel|move-stop|close|review|postmortem` ·
`POST /notes`, `DELETE /notes/:id` · `POST /lessons/draft`, `PUT /lessons/:id` ·
`PUT /config` · `POST /tick`.

## Tests
`apps/api/test/tracking-engine.spec.ts` — targets/validation, TP ladder with stop moves,
BE exit, stop-first rule, STOP gap fill, SHORT excursions/path, manual partial + full close.
