## Description
A standalone experiment (started 2026-09-09): a monitor that watches BTCUSDT daily,
12:00–00:00 UTC, and paper-trades BTC scalps where **Claude Code itself decides** every
entry, hold/adjust, and early-close call by reading raw H1+M15 candles — there is no fixed
entry rule. Fully simulated — no exchange orders are ever placed. Deliberately separate
from the worker's scheduled analysis pipeline and from `/strategy-backtest` (which is for
the trader's own hand-written setups). Never more than one paper position open at a time.

**Runs as headless Claude Code (like `claude-cron/portfolio-review`), NOT the paid
Anthropic Messages API.** An earlier version of this feature called
`api.anthropic.com` directly with `CLAUDE_API_KEY` on a 15-minute loop — the trader
rejected that (real per-token billing) and asked for the same approach already used by
the daily portfolio review: the `claude` CLI running headless (`claude -p`), billed under
the Claude Code plan the trader already has, not metered API usage. There is no
`CLAUDE_API_KEY`/`axios` call anywhere in this feature.

What is left to Claude's judgment vs. enforced in code:
- **Claude decides:** whether to enter, direction, entry price, initial stop-loss and
  take-profit, and — every tick while a trade is open — whether to HOLD, ADJUST (move the
  stop/target) or CLOSE_NOW (cut the trade immediately, without waiting for the stop or
  target). The judgment is still the model's, but `prompt.md` now imposes soft trading
  rules on it (not enforced in code): trade top-down with the trend (follow H1; if H1 is
  sideway follow H4; if both are sideway `NO_TRADE`), place the stop beyond structure
  rather than at a fixed tiny distance, require at least 1:1.5 reward:risk or else
  `NO_TRADE`, and only trail the stop to breakeven after the trade is +1R. Computed H4 and
  H1 swing-structure labels are offered as informational hints in the snapshot.
- **Enforced in code, never left to the model:** position sizing (a stop-out always costs
  exactly $1 — `SCALP_RISK_USD`), the stop can only ever be tightened by an ADJUST (never
  loosened, regardless of what Claude writes), whether a stop/target actually filled
  between ticks (decided by replaying real candle highs/lows, not by asking the model —
  see `checkStopTakeProfitHit`), and at most one open position at a time.

## Main Flow
1. `scalp-monitor.timer` (systemd, `OnCalendar=*-*-* 12..23:0/15:00 UTC`) fires
   `scalp-monitor.service` every 15 minutes, 12:00–23:45 UTC, one-shot each time —
   nothing runs outside that window, no persistent process at all.
2. The service runs `claude-cron/scalp-monitor/run.sh`, which:
   a. Runs `node claude-cron/scalp-monitor/snapshot.mjs` — deterministic, no LLM: fetches
      fresh H4+H1+M15 Binance candles, loads the current OPEN `ScalpPaperTrade` (if any), and
      replays the candles it hasn't seen since `lastCheckedAt` against the current
      stop/target (`checkStopTakeProfitHit`, pessimistic — a candle touching both is
      scored as the stop). If that fills the trade, snapshot.mjs closes it right there,
      writes a `skip-claude` sentinel, and **no Claude Code session is even started this
      tick**. Otherwise it writes `/var/tmp/scalp-monitor/snapshot.json` (current price,
      H4 + H1 trend hints, last 30 H4 / 40 H1 / 60 M15 candles as text, and the open
      position's direction/entry/stop/target/unrealized PnL if any).
   b. If no sentinel was written, runs `claude -p "$(cat prompt.md)" --model
      claude-opus-4-8 --add-dir /var/tmp/scalp-monitor --allowedTools "Bash(node:*)
      Write"` — a headless Claude Code session restricted to running `node ...` commands
      and writing files. Per `prompt.md`, it reads the snapshot, decides
      ENTER_LONG/ENTER_SHORT/NO_TRADE (flat) or HOLD/ADJUST/CLOSE_NOW (open), and writes
      its decision to `/var/tmp/scalp-monitor/decision.json`.
   c. Runs `node claude-cron/scalp-monitor/apply-decision.mjs`, which re-reads the current
      DB state (not trusting anything stale), validates the decision, applies the sizing
      and stop-only-tightens guardrails, and writes the result — this is where an ENTER_*
      decision actually becomes a `ScalpPaperTrade` row. **Immediately AFTER the row is
      created** (never before — the entry must not wait on a render), it POSTs to
      `POST /scalp-paper-trades/:id/chart`, which renders the 15m BTCUSDT chart at that
      moment (with an entry-price marker), uploads the PNG to R2, and stores the URL on the
      trade's `chartUrl`. This call is best-effort: if the API is down or R2 is
      unconfigured it is logged and swallowed, and the trade stays intact without a chart.
   d. Logs everything to `/var/log/scalp-monitor/<date>.log` (kept 7 days).
3. A trade left OPEN across the overnight 00:00–12:00 UTC gap is unmanaged during the
   gap — the 12:00 UTC tick's snapshot replays every M15 candle it missed in order first,
   so a mechanical fill during the gap is still recorded against the correct historical
   candle, just reported late.
4. `GET /scalp-paper-trades` (API) reads the table back: the current open trade (with live
   unrealized PnL from a fresh Binance price) plus closed history and win-rate/PnL/R stats.
5. `/paper-scalp` (web) renders that board — entry reasoning, Claude's latest running
   commentary (`lastNote`), and which model decided — polling the API every 30s.

## Edge Cases
- Binance unreachable in snapshot.mjs: logged, `skip-claude` sentinel written (`no-candle-
  data`), no Claude session started, `lastCheckedAt` untouched so no candle is lost.
- `claude` not found on PATH (e.g. mid-autoupdate — see `claude-cron/portfolio-review`'s
  own history of this): `run.sh` logs a preflight failure and skips the tick; the next
  timer firing tries again in 15 minutes.
- Claude's headless run fails, times out (300s ceiling), or never writes a valid
  `decision.json`: `apply-decision.mjs` fails loudly (non-zero exit, logged) and nothing
  is written to the DB for that tick — never a silent bad write.
- Claude proposes an entry with SL/TP on the wrong side of its own entry price, or omits
  one: `apply-decision.mjs` rejects it before writing anything, logged, tried again next
  tick.
- A candle that hits both the stop and the take-profit: scored as the stop (pessimistic —
  OHLC can't tell which happened first intra-candle).
- Claude sends an ADJUST that would loosen the stop (more risk): silently clamped to the
  tighter of old/new — `SCALP_RISK_USD` stays a real ceiling regardless of what the model
  asks for.
- Any OPEN trade at 00:00 UTC is left OPEN, unmanaged, until the window reopens at 12:00
  UTC — intentional, not a bug (see Main Flow point 3).
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
  scheduling (15 min, 12:00–23:45 UTC daily).
- `packages/core/src/setups/scalp-paper-trade.ts` — the parts NOT left to the model:
  sizing/PnL math, `clampStopTighten`, `checkStopTakeProfitHit`, and `detectTrend` (the
  informational hint). Shared by `snapshot.mjs`/`apply-decision.mjs` (via `require('@app/core')`,
  resolved from the compiled `dist` through the root `@app/core` workspace devDependency)
  and by the API.
- `packages/db/src/repositories/scalp-paper-trade.repository.ts` — `ScalpPaperTrade` CRUD
  (used by the API; the cron scripts talk to `@app/db`'s `prisma` client directly).
- `packages/db/prisma/schema.prisma` (`ScalpPaperTrade` model) + migrations
  `20260909151800_add_scalp_paper_trades`, `20260909160000_scalp_paper_trade_llm_driven`.
- `apps/api/src/modules/scalp-paper-trades/*` — `GET /scalp-paper-trades` board (open trade +
  live unrealized PnL, closed history, stats) and `POST /scalp-paper-trades/:id/chart`, which
  renders the 15m entry-moment chart (reusing `bitget/setup-chart-renderer`), uploads it to R2
  via `StorageService`, and stores the URL on the trade (`renderAndAttachEntryChart`).
- `apps/web/src/app/paper-scalp/page.tsx`, `apps/web/src/_pages/paper-scalp-page/*`,
  `apps/web/src/widgets/paper-scalp-board/*` — the `/paper-scalp` page.
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry.
