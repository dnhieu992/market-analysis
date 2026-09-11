## Description
A standalone experiment (started 2026-09-09): a monitor that watches BTCUSDT **24/7,
every 30 min** (since 2026-09-11), and paper-trades BTC scalps where **Claude Code itself
decides** every order by reading raw H1+M15 candles — there is no fixed entry rule. It is
**limit-order based**: instead of entering at market, Claude pre-computes a resting LIMIT
order, and a later tick fills it *mechanically* only if a candle actually trades at the
limit price. Fully simulated — no exchange orders are ever placed. Deliberately separate
from the worker's scheduled analysis pipeline and from `/strategy-backtest` (which is for
the trader's own hand-written setups). Never more than one active order/position at a time.

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
- **Enforced in code, never left to the model:** position sizing (a stop-out always costs
  exactly $1 — `SCALP_RISK_USD`), a resting limit must sit on the correct side of the
  current price (buy-limit below / sell-limit above) with SL/TP on the structurally-correct
  sides (`validateLimit` in apply-decision, else the order is rejected), whether a resting
  limit actually filled (a candle touching the limit — `checkLimitFill`) and whether a
  stop/target then filled (`checkStopTakeProfitHit`, pessimistic: a candle touching both is
  scored as the stop) — both decided by replaying real candle highs/lows, not by asking the
  model — the stop can only ever be tightened once open (never loosened), and at most one
  active order/position at a time.

## Main Flow
1. `scalp-monitor.timer` (systemd, `OnCalendar=*-*-* *:0/30:00 UTC`) fires
   `scalp-monitor.service` every 30 minutes, 24/7, one-shot each time — no persistent
   process at all, just a fresh tick every half hour around the clock.
2. The service runs `claude-cron/scalp-monitor/run.sh`, which:
   a. Runs `node claude-cron/scalp-monitor/snapshot.mjs` — deterministic, no LLM: fetches
      fresh H4+H1+M15 Binance candles, loads the single active `ScalpPaperTrade` (a PENDING
      limit or an OPEN trade) and replays the candles it hasn't seen since `lastCheckedAt`:
      - **PENDING** → `checkLimitFill`: if a candle touched the limit, flip the row to OPEN
        at the limit price (openedAt = fill time), then check the same/later candles for a
        stop/target fill too; POST the entry chart (the fill IS the entry moment); write a
        `skip-claude` sentinel — nothing for Claude to decide this tick.
      - **OPEN** → `checkStopTakeProfitHit` (pessimistic — a candle touching both is scored
        as the stop): if hit, close the trade right here and write `skip-claude`.
      Otherwise (limit still resting / trade still running / flat) it writes
      `/var/tmp/scalp-monitor/snapshot.json` (current price, H4+H1 trend hints, last
      30 H4 / 40 H1 / 60 M15 candles as text, plus `pendingLimit` and/or `openPosition`).
   b. If no sentinel was written, runs `claude -p "$(cat prompt.md)" --model
      claude-opus-4-8 --add-dir /var/tmp/scalp-monitor --allowedTools "Bash(node:*)
      Write"` — a headless Claude Code session restricted to running `node ...` commands
      and writing files. Per `prompt.md`, it reads the snapshot and decides — flat:
      `PLACE_LIMIT_LONG`/`PLACE_LIMIT_SHORT`/`NO_TRADE`; resting limit:
      `KEEP`/`UPDATE_LIMIT`/`CANCEL`; open: `HOLD`/`ADJUST`/`CLOSE_NOW` — writing it to
      `/var/tmp/scalp-monitor/decision.json`.
   c. Runs `node claude-cron/scalp-monitor/apply-decision.mjs`, which re-reads the current
      DB state (not trusting anything stale), validates the decision (`validateLimit` for a
      new/updated limit; stop-only-tightens for an open ADJUST), applies sizing, and writes
      the result — a `PLACE_LIMIT_*` becomes a **PENDING** `ScalpPaperTrade` row (no chart
      yet — nothing has filled). The entry chart is rendered later, by snapshot.mjs, the
      moment the limit fills: it POSTs
      `POST /scalp-paper-trades/:id/chart`, which renders the 15m BTCUSDT chart at that
      moment (with an entry-price marker), uploads the PNG to R2, and stores the URL on the
      trade's `chartUrl`. This call is best-effort: if the API is down or R2 is
      unconfigured it is logged and swallowed, and the trade stays intact without a chart.
   d. Logs everything to `/var/log/scalp-monitor/<date>.log` (kept 7 days).
3. With 24/7 ticks there is no scheduled gap, so a resting limit and an open trade are
   checked every 30 min around the clock. Should a tick still be missed (host reboot,
   `claude` mid-autoupdate,
   Binance hiccup), the next tick's snapshot replays every M15 candle it missed in order
   first, so a mechanical fill during the miss is still recorded against the correct
   historical candle, just reported late.
4. `GET /scalp-paper-trades` (API) reads the table back: the resting `pendingOrder` (if
   any), the current `openTrade` (with live unrealized PnL from a fresh Binance price),
   plus closed/cancelled history and win-rate/PnL/R stats (a CANCELLED limit never filled,
   so it is excluded from the stats).
5. `/paper-scalp` (web) renders that board — the pending-limit card, the open-trade card,
   entry/placement reasoning, Claude's latest running commentary (`lastNote`) — polling the
   API every 30s.

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
- A candle both fills the resting limit AND then hits the stop/target in the same 30-min
  window: snapshot.mjs flips it to OPEN at the limit and immediately closes it that tick
  (checking the stop/target only on candles at/after the fill), so a fast in-and-out is
  still recorded correctly.
- A candle that hits both the stop and the take-profit: scored as the stop (pessimistic —
  OHLC can't tell which happened first intra-candle).
- Claude sends an ADJUST that would loosen the stop (more risk): silently clamped to the
  tighter of old/new — `SCALP_RISK_USD` stays a real ceiling regardless of what the model
  asks for.
- A tick fires while the previous one is still running (a `claude -p` tick can take up to
  360s): systemd's oneshot service will not start a second concurrent instance, so the
  overlapping tick is simply skipped — the following 30-min tick picks up normally.
- Entry-chart render fails (API down, R2 unconfigured, Binance hiccup): `apply-decision.mjs`
  logs it and moves on — the entry is already committed, `chartUrl` just stays null and the
  board shows "—" in the Chart column. The chart is never on the entry's critical path.

## Related Files (FE / BE / Worker / Cron)
- `claude-cron/scalp-monitor/run.sh` — systemd-invoked wrapper: snapshot → (maybe) headless
  `claude -p` → apply-decision, logged to `/var/log/scalp-monitor/`.
- `claude-cron/scalp-monitor/snapshot.mjs` — deterministic candle fetch + mechanical
  fill-check; the only place Binance/the DB are touched before a decision exists.
- `claude-cron/scalp-monitor/prompt.md` — the instructions the headless session follows.
- `claude-cron/scalp-monitor/apply-decision.mjs` — validates and applies the decision;
  owns every guardrail (sizing, stop-only-tightens, SL/TP-vs-entry sanity).
- `/etc/systemd/system/scalp-monitor.service`, `/etc/systemd/system/scalp-monitor.timer` —
  scheduling (every 30 min, 24/7 — `OnCalendar=*-*-* *:0/30:00 UTC`).
- `packages/core/src/setups/scalp-paper-trade.ts` — the parts NOT left to the model:
  sizing/PnL math, `clampStopTighten`, `checkLimitFill` (did a candle touch the resting
  limit), `checkStopTakeProfitHit` (did a candle hit the stop/target), and `detectTrend`
  (the informational hint). Shared by `snapshot.mjs`/`apply-decision.mjs` (via
  `require('@app/core')`, resolved from the compiled `dist` through the root `@app/core`
  workspace devDependency) and by the API.
- `packages/db/src/repositories/scalp-paper-trade.repository.ts` — `ScalpPaperTrade` CRUD
  (used by the API; the cron scripts talk to `@app/db`'s `prisma` client directly).
- `packages/db/prisma/schema.prisma` (`ScalpPaperTrade` model: `PENDING`/`OPEN`/`CLOSED_*`/
  `CANCELLED`, nullable `openedAt`, `chartUrl`) + migrations
  `20260909151800_add_scalp_paper_trades`, `20260909160000_scalp_paper_trade_llm_driven`,
  `20260911120000_scalp_paper_trade_entry_chart`, `20260911160000_scalp_paper_trade_limit_orders`.
- `apps/api/src/modules/scalp-paper-trades/*` — `GET /scalp-paper-trades` board (pending
  limit + open trade + live unrealized PnL, closed/cancelled history, stats) and
  `POST /scalp-paper-trades/:id/chart` (called by snapshot.mjs the moment a limit fills),
  which renders the 15m entry-moment chart (reusing `bitget/setup-chart-renderer`), uploads
  it to R2 via `StorageService`, and stores the URL on the trade (`renderAndAttachEntryChart`).
- `apps/web/src/app/paper-scalp/page.tsx`, `apps/web/src/_pages/paper-scalp-page/*`,
  `apps/web/src/widgets/paper-scalp-board/*` — the `/paper-scalp` page.
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry.
