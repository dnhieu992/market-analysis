## Description
A standalone experiment (started 2026-09-09): a monitor that paper-trades BTC scalps
where **Claude Code decides** every order by reading raw H1+M15 candles — there is no
fixed entry rule. It is **limit-order based**: instead of entering at market, Claude
pre-computes a resting LIMIT order, and it fills *mechanically* only if a candle actually
trades at the limit price. Fully simulated — no exchange orders are ever placed.
Deliberately separate from the worker's scheduled analysis pipeline and from
`/strategy-backtest` (which is for the trader's own hand-written setups). Never more than
one active order/position at a time.

**Two clocks, a clean split of labour (since 2026-09-12):**
- **Claude = the analyst / market watcher**, on a **30-min** tick (`scalp-monitor.timer`
  → headless `claude -p`). It reads the market and makes *judgment* calls only: place a
  limit / keep-update-cancel a resting one / hold-adjust-close an open trade, plus
  commentary and risk management. **It never detects a fill or sends a notification.**
- **The system = a deterministic realtime watcher**, on a **1-min** tick
  (`scalp-watch.timer` → `watch.sh` → `watch.mjs`, no LLM). It is what actually *executes*:
  every minute it replays fresh 1m candles and settles the order — limit fill, stop hit,
  target hit, stale-limit expiry — updates the DB, and fires the Telegram alert within
  ~60s of the wick. This is why fills/TP/SL feel realtime instead of waiting for the next
  30-min Claude tick.

The two never clobber each other: every state transition (in both `mechanical.mjs` and
`apply-decision.mjs`) is a **compare-and-swap** guarded on the status the writer read, so
if the watcher fills a limit the same moment Claude tries to cancel it, exactly one wins
and the loser goes quiet.

**Runs as headless Claude Code (like `claude-cron/portfolio-review`), NOT the paid
Anthropic Messages API.** An earlier version of this feature called
`api.anthropic.com` directly with `CLAUDE_API_KEY` on a 15-minute loop — the trader
rejected that (real per-token billing) and asked for the same approach already used by
the daily portfolio review: the `claude` CLI running headless (`claude -p`), billed under
the Claude Code plan the trader already has, not metered API usage. There is no
`CLAUDE_API_KEY`/`axios` call anywhere in this feature.

What is left to Claude's judgment vs. enforced in code:
- **Claude decides:** when flat, whether to place a limit and its direction / limit price
  / stop / target (`PLACE_LIMIT_LONG` / `PLACE_LIMIT_SHORT` / `NO_TRADE`); while a limit is
  resting, whether to `KEEP`, `UPDATE_LIMIT` (move any of limit/stop/target) or `CANCEL`
  it; once the limit has filled into an open trade, whether to `HOLD`, `ADJUST` (move the
  stop/target) or `CLOSE_NOW`. `prompt.md` imposes soft trading rules (not enforced in
  code): trade top-down with the trend (follow H1; if H1 is sideway follow H4; if both are
  sideway `NO_TRADE`); **place the limit AT the level price must return to** — a sell-limit
  at the resistance a bounce is expected to test (above price), a buy-limit at the support
  a pullback should retest (below price) — so you never chase a market entry mid-move;
  **anchor the stop to confirmed structure** just beyond that level; require at least 1:1.5
  reward:risk (limit→stop vs limit→target) or else `NO_TRADE`; and only trail to breakeven
  after a *full* +1R (not +0.5R). Computed H4/H1 swing-structure labels are informational
  hints in the snapshot.
- **Enforced in code (the realtime watcher / `mechanical.mjs`), never left to the model:**
  position sizing (a stop-out always costs exactly $1 — `SCALP_RISK_USD`), a resting limit
  must sit on the correct side of the current price (buy-limit below / sell-limit above)
  with SL/TP on the structurally-correct sides (`validateLimit` in apply-decision, else the
  order is rejected), whether a resting limit actually filled (a candle touching the limit —
  `checkLimitFill`) and whether a stop/target then filled (`checkStopTakeProfitHit`,
  pessimistic: a candle touching both is scored as the stop) — both decided every minute by
  replaying real 1m candle highs/lows, not by asking the model — the stop can only ever be
  tightened once open (never loosened), and at most one active order/position at a time.
  A resting limit also has a **hard max age** (`SCALP_LIMIT_MAX_AGE_MIN`, default 240 min):
  the watcher auto-cancels any PENDING limit that has rested longer without filling — a
  scalp entry that never triggers is not left resting forever. Claude is separately told
  (prompt.md, section B) to `CANCEL` a stale/ran-away limit *earlier* based on the market
  (`ageMinutes` vs `maxAgeMinutes`, a widening `distanceToPricePct`, or a flipped H1/H4
  read) rather than let it drift to that ceiling.

**Telegram alerts.** Every lifecycle transition of a scalp order fires a one-off Telegram
message to the trader (same bot/chat as the portfolio review, `TELEGRAM_BOT_TOKEN` /
`TELEGRAM_CHAT_ID`), via `notify.mjs`: 📌 limit placed, 🟢 limit filled (entry), ✅ TP,
🛑 SL, ⚪ early close (`CLOSE_NOW`), ❌ manual cancel, ⏱️ auto-cancel (stale/expired).
- The **market events** — 🟢 fill / ✅ TP / 🛑 SL / ⏱️ expiry — are the realtime ones: sent
  by the system watcher (`watch.mjs`) the minute they happen, decoupled from Claude entirely.
- The **decision events** — 📌 place / ❌ manual cancel / ⚪ early close — are sent by
  `apply-decision.mjs` the moment Claude's decision is applied (i.e. at the 30-min tick,
  which is inherently when such a decision is made).

Routine `KEEP` / `HOLD` / `UPDATE_LIMIT` / `ADJUST` / `NO_TRADE` ticks are silent — only
real state changes alert. Sending is best-effort and never throws: a Telegram outage is
logged and swallowed, never breaking a tick.

## Main Flow

### A. Realtime execution — the system watcher (every 1 min, no LLM)
1. `scalp-watch.timer` (systemd, `OnCalendar=*-*-* *:*:00 UTC`) fires `scalp-watch.service`
   every minute, 24/7, one-shot.
2. It runs `claude-cron/scalp-monitor/watch.sh` → `node watch.mjs`, which fetches the last
   ~300 fresh 1m BTCUSDT candles and calls `runMechanical` (`mechanical.mjs`) on the single
   active `ScalpPaperTrade`, replaying every candle since `lastCheckedAt`:
   - **PENDING** → `checkLimitFill`: a candle touched the limit → CAS the row to OPEN at the
     limit price (openedAt = fill time), then check the same/later candles for a stop/target
     too (a fast in-and-out closes in the same run). Fires a 🟢 fill alert (+ ✅/🛑 if it
     also closed) and POSTs the entry chart. If the limit instead aged past
     `SCALP_LIMIT_MAX_AGE_MIN` without filling → CAS to CANCELLED + ⏱️ alert.
   - **OPEN** → `checkStopTakeProfitHit` (pessimistic — a candle touching both scores as the
     stop): if hit, CAS the row closed + ✅/🛑 alert.
   Every transition is a status-guarded `updateMany` (compare-and-swap); a write that loses
   the race (`count === 0`) sends no alert. Quiet on a no-op minute; logs events/errors to
   `/var/log/scalp-monitor/watch-<date>.log` (kept 7 days).

### B. Decisions — the Claude analyst tick (every 30 min)
1. `scalp-monitor.timer` (systemd, `OnCalendar=*-*-* *:0/30:00 UTC`) fires
   `scalp-monitor.service` every 30 minutes, 24/7, one-shot.
2. The service runs `claude-cron/scalp-monitor/run.sh`, which:
   a. Runs `node snapshot.mjs` — deterministic, **read-only** now: fetches fresh H4+H1+M15
      Binance candles, reads the single active `ScalpPaperTrade` in whatever state the
      watcher has already settled it to, and writes `/var/tmp/scalp-monitor/snapshot.json`
      (current price, H4+H1 trend hints, last 30 H4 / 40 H1 / 60 M15 candles as text, plus
      `pendingLimit` — including `ageMinutes`/`maxAgeMinutes` — and/or `openPosition`). It
      no longer detects fills or closes and only writes a `skip-claude` sentinel when
      Binance returned no candles.
   b. If no sentinel, runs `claude -p "$(cat prompt.md)" --model claude-opus-4-8 --add-dir
      /var/tmp/scalp-monitor --allowedTools "Bash(node:*) Write"` — a headless session that
      reads the snapshot and decides (analyst only): flat →
      `PLACE_LIMIT_LONG`/`PLACE_LIMIT_SHORT`/`NO_TRADE`; resting limit →
      `KEEP`/`UPDATE_LIMIT`/`CANCEL`; open → `HOLD`/`ADJUST`/`CLOSE_NOW` — writing
      `/var/tmp/scalp-monitor/decision.json`.
   c. Runs `node apply-decision.mjs`, which re-reads current DB state, validates the
      decision (`validateLimit` for a new/updated limit; stop-only-tightens for ADJUST),
      applies sizing, and writes the result via **status-guarded CAS** (a manage action that
      the watcher already settled under it is a logged no-op). A `PLACE_LIMIT_*` becomes a
      **PENDING** row + 📌 alert; `CANCEL` → CANCELLED + ❌ alert; `CLOSE_NOW` → CLOSED_EARLY
      + ⚪ alert. The entry chart itself is rendered by the watcher on fill (`POST
      /scalp-paper-trades/:id/chart` → 15m chart → R2 → `chartUrl`), best-effort.
   d. Logs to `/var/log/scalp-monitor/<date>.log` (kept 7 days).

### C. Read-back
- `GET /scalp-paper-trades` (API) reads the table back: the resting `pendingOrder` (if any),
  the current `openTrade` (with live unrealized PnL from a fresh Binance price), plus
  closed/cancelled history and win-rate/PnL/R stats (a CANCELLED limit never filled, so it
  is excluded from the stats).
- `/paper-scalp` (web) renders that board — the pending-limit card, the open-trade card,
  entry/placement reasoning, Claude's latest running commentary (`lastNote`) — polling the
  API every 30s. Because the watcher settles fills/closes within a minute, the board reflects
  them well before the next 30-min Claude tick.

## Edge Cases
- Binance unreachable in snapshot.mjs: logged, `skip-claude` sentinel written (`no-candle-
  data`), no Claude session started, `lastCheckedAt` untouched so no candle is lost.
- `claude` not found on PATH (e.g. mid-autoupdate — see `claude-cron/portfolio-review`'s
  own history of this): `run.sh` logs a preflight failure and skips the tick; the next
  timer firing tries again in 30 minutes.
- Claude's headless run fails, times out (300s ceiling), or never writes a valid
  `decision.json`: `apply-decision.mjs` fails loudly (non-zero exit, logged) and nothing
  is written to the DB for that tick — never a silent bad write.
- Claude proposes a limit on the wrong side of price (sell-limit at/below, buy-limit
  at/above) or with SL/TP on the wrong side of the limit, or omits one: `validateLimit` in
  `apply-decision.mjs` rejects it before writing anything, logged, tried again next tick.
- A candle both fills the resting limit AND then hits the stop/target in the same 1-min
  window: `runMechanical` flips it to OPEN at the limit and immediately closes it in the same
  run (checking the stop/target only on candles at/after the fill), firing both the 🟢 fill
  and the ✅/🛑 close alert — a fast in-and-out is still recorded correctly.
- A candle that hits both the stop and the take-profit: scored as the stop (pessimistic —
  OHLC can't tell which happened first intra-candle).
- **Race between the watcher and the Claude tick** (e.g. a limit fills the same moment
  Claude decides `CANCEL`, or a stop hits the moment Claude decides `HOLD`): every write on
  both sides is a status-guarded `updateMany` (compare-and-swap). Exactly one transition
  wins; the loser sees `count === 0`, logs "already settled by the realtime watcher", and
  sends no alert — so the row is never double-transitioned and no duplicate/contradictory
  Telegram is sent.
- Claude sends an ADJUST that would loosen the stop (more risk): silently clamped to the
  tighter of old/new — `SCALP_RISK_USD` stays a real ceiling regardless of what the model
  asks for.
- The watcher misses some minutes (host busy, brief Binance outage): its next run fetches
  ~300 fresh 1m candles and replays every one since `lastCheckedAt`, so a fill/stop/target
  during the gap is still recorded against the correct historical candle, just reported late.
  `lastCheckedAt` is untouched on a no-candle-data minute, so nothing is lost.
- Two watcher/decision instances overlapping: systemd oneshot won't start a second
  concurrent instance of the same unit, and the CAS handles a watcher-vs-apply overlap.
- Entry-chart render fails (API down, R2 unconfigured, Binance hiccup): the watcher logs it
  and moves on — the entry (and its 🟢 alert) is already committed, `chartUrl` just stays
  null and the board shows "—" in the Chart column. The chart is never on the fill's critical
  path.
- A resting limit that never fills: auto-cancelled once `ageMinutes >= SCALP_LIMIT_MAX_AGE_MIN`
  (default 240) in the watcher — CANCELLED status, `lastNote` records why, a ⏱️ Telegram
  alert is sent. The fill check runs first, so a candle that fills the limit on the same run
  it would expire is honored as a fill, not a cancel.
- Telegram unreachable / `TELEGRAM_BOT_TOKEN` unset when an alert fires: `notify.mjs` logs
  and swallows it (never throws) — the trade state is already committed to the DB, only the
  notification is lost. Alerts are best-effort, never on a trade's critical path.

## Related Files (FE / BE / Worker / Cron)

**Realtime system watcher (every 1 min, no LLM):**
- `claude-cron/scalp-monitor/watch.sh` — systemd wrapper: sets nvm PATH, runs `watch.mjs`,
  appends only non-empty output to `/var/log/scalp-monitor/watch-<date>.log`.
- `claude-cron/scalp-monitor/watch.mjs` — fetches 1m candles, calls `runMechanical`, and
  sends the market-event Telegram alerts (🟢 fill / ✅ TP / 🛑 SL / ⏱️ expiry) + attaches the
  entry chart on fill. Quiet on no-op minutes.
- `claude-cron/scalp-monitor/mechanical.mjs` — the shared, LLM-free execution engine:
  `runMechanical` (fill / stop / target / stale-expiry detection, all as status-guarded CAS
  writes) + `LIMIT_MAX_AGE_MIN`. Returns the events that actually committed, for the caller
  to alert.
- `claude-cron/scalp-monitor/systemd/scalp-watch.{service,timer}` — reference copies of the
  units installed at `/etc/systemd/system/scalp-watch.*` (every minute — `OnCalendar=*-*-*
  *:*:00 UTC`).

**Claude analyst tick (every 30 min):**
- `claude-cron/scalp-monitor/run.sh` — systemd-invoked wrapper: snapshot → (maybe) headless
  `claude -p` → apply-decision, logged to `/var/log/scalp-monitor/`.
- `claude-cron/scalp-monitor/snapshot.mjs` — deterministic, **read-only** candle fetch +
  current-state read; builds `snapshot.json` for Claude. No fill detection, no alerts.
- `claude-cron/scalp-monitor/prompt.md` — the instructions the headless session follows
  (analyst role: decide setups / manage risk / comment; never execute or notify).
- `claude-cron/scalp-monitor/apply-decision.mjs` — validates and applies Claude's decision
  via status-guarded CAS; owns the decision guardrails (sizing, stop-only-tightens,
  SL/TP-vs-entry sanity); sends the decision Telegram alerts (📌 place / ❌ manual cancel /
  ⚪ early close).
- `/etc/systemd/system/scalp-monitor.service`, `/etc/systemd/system/scalp-monitor.timer` —
  scheduling (every 30 min, 24/7 — `OnCalendar=*-*-* *:0/30:00 UTC`).

**Shared:**
- `claude-cron/scalp-monitor/notify.mjs` — Telegram alert helper (`sendScalpAlert` +
  per-event message builders in Vietnamese); best-effort, never throws. Used by both
  `watch.mjs` and `apply-decision.mjs`.
- `packages/core/src/setups/scalp-paper-trade.ts` — the parts NOT left to the model:
  sizing/PnL math, `clampStopTighten`, `checkLimitFill` (did a candle touch the resting
  limit), `checkStopTakeProfitHit` (did a candle hit the stop/target), and `detectTrend`
  (the informational hint). Shared by `mechanical.mjs`/`watch.mjs`/`snapshot.mjs`/
  `apply-decision.mjs` (via `require('@app/core')`, resolved from the compiled `dist`
  through the root `@app/core` workspace devDependency) and by the API.
- `packages/db/src/repositories/scalp-paper-trade.repository.ts` — `ScalpPaperTrade` CRUD
  (used by the API; the cron scripts talk to `@app/db`'s `prisma` client directly).
- `packages/db/prisma/schema.prisma` (`ScalpPaperTrade` model: `PENDING`/`OPEN`/`CLOSED_*`/
  `CANCELLED`, nullable `openedAt`, `chartUrl`) + migrations
  `20260909151800_add_scalp_paper_trades`, `20260909160000_scalp_paper_trade_llm_driven`,
  `20260911120000_scalp_paper_trade_entry_chart`, `20260911160000_scalp_paper_trade_limit_orders`.
- `apps/api/src/modules/scalp-paper-trades/*` — `GET /scalp-paper-trades` board (pending
  limit + open trade + live unrealized PnL, closed/cancelled history, stats) and
  `POST /scalp-paper-trades/:id/chart` (called by watch.mjs the moment a limit fills),
  which renders the 15m entry-moment chart (reusing `bitget/setup-chart-renderer`), uploads
  it to R2 via `StorageService`, and stores the URL on the trade (`renderAndAttachEntryChart`).
- `apps/web/src/app/paper-scalp/page.tsx`, `apps/web/src/_pages/paper-scalp-page/*`,
  `apps/web/src/widgets/paper-scalp-board/*` — the `/paper-scalp` page.
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry.
