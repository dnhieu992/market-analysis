## Description
BTC **SHORT score** in the 🐻 Short AI chat of `/trades`: the trader's own checklist, each criterion
worth points, scored as **% short = points met / total points of the enabled criteria**. The score is
the trader's rule, not a probability; `backtest_short_score` shows how each score level actually
played out.

The criteria set is a versioned JSON document (`chat_skill_versions`, skillId `okx-short-score`) that
the trader edits by asking the chat. No deploy is needed. Each criterion is a small JS snippet, run
in the backtest Docker sandbox (`BacktestLabService.evaluate`), never in the API process. The same
code scores today and replays the past.

## Default criteria (v0, the user's list of 2026-11-07, 1 point each)
| id | rule |
|---|---|
| `d1_trend_down` | D1 close < EMA50 and EMA20 < EMA50 |
| `h4_trend_down` | H4 close < EMA50 and EMA20 < EMA50 |
| `fear_greed` | Fear & Greed (alternative.me, latest published) in (30, 50) or > 70 |
| `rsi_h4` | RSI(14) H4 in (40, 50) or > 80 |
| `sonic_h4_stack_down` | Sonic R on H4: EMA34 < EMA89 < EMA200 |
| `morning_pump` | 07:00–12:00 Vietnam time: high ≥ +1.2 % above the 07:00 open (15m bars) |
| `h4_fib_retest` | H4: highest high of the last 60 bars → lowest low after it is a drop of ≥ 5 %; in the last 6 bars price touched the 0.5 fib (−0.5 % tolerance); the last close is still below 0.618 |
| `d1_fib_retest` | Same on D1: 60 bars, drop ≥ 12 %, last 3 bars, 1 % tolerance |

## Main Flow
1. **Daily:** cron `ShortScoreService.dailyScore` runs at 05:05 UTC (12:05 VN) and stores a row in
   `short_score_snapshots` (trigger CRON).
2. **Chat:**
   - Every reply's context carries the latest snapshot.
   - "Chấm điểm…" → `get_short_score` scores now (trigger CHAT).
   - Then `find_resistance_levels(mode)` returns zones from `analyzeMarketStructure`:
     - swing: W / D1 / H4 (entries at H4 and higher);
     - scalp: H1 / M30 / M15.
   - The chat proposes the short entry from those zones (card only on request).
3. **Edit:** "thêm tiêu chí…" → `get_score_criteria` → `update_score_criteria(full set, note)`.
   - The set is validated (`parseScoreSet`), then dry-run on live data.
   - A syntax error or a criterion that throws rejects the save with the message.
   - Otherwise it is appended as a new version.
4. **Backtest:** `backtest_short_score(days ≤ 1000, hourVn, moves, set?)` scores once a day at `hourVn`
   over the past `days`. For each score level it reports how often price then touched −m % before
   +m % (short won). It also gives each criterion's short-win when met vs not met.
5. **UI:** the strip under the chat header shows the latest score, each criterion ✅/❌ with its
   numbers, the last 7 scores and a "↻ Chấm lại" button (`POST /okx/ai/score/run`, trigger UI).

## Criterion contract
`{ id: slug, label, points (0,10], enabled, code }`. `code` is the body of a synchronous
`function (d, ta, ext, lib)` and returns either a boolean or `{ hit, detail }`.

- `d[interval]`: the CLOSED candles (≤ 1000) up to the scoring time, for the set's `intervals`
  (≤ 4, default 1d/4h/1h/15m).
- `ext`:
  - `now`
  - `price`: last close of the smallest interval
  - `fngNow`, `fng` (60 days)
- `ta`: the sandbox helpers.
- `lib`:
  - `trendDown`, `trendUp`
  - `emaStackDown`
  - `rsiLast`, `lastEma`
  - `morningMove`
  - `fibRetest`
  - `fmt`

## Edge Cases
- Fear & Greed is fetched from `https://api.alternative.me/fng/` and cached 1 h. If it is
  unavailable, `fngNow` is null and the default criterion is ❌ with the reason.
- A criterion that throws at scoring time is ⚠️, counts as not met, and shows its error. A save with
  such a criterion is refused.
- The morning criterion before 12:00 VN uses the bars closed so far (detail says "chưa hết buổi sáng").
- Only one score / backtest runs at a time (shared sandbox queue with `/backtest`). A live score is
  about 3 s; a 2-year backtest is about 15 s.

## Files
- `apps/api/src/modules/short-score/`: engine (default set, `lib`, sandbox program), service (set
  versions, scoring, backtest, cron), controller (`GET /okx/ai/score`, `POST /okx/ai/score/run`,
  `GET /okx/ai/score/criteria`, `POST …/criteria/versions/:v/restore`, `GET /okx/ai/score/backtest`).
- `apps/api/src/modules/backtest-lab/backtest-lab.service.ts`: `evaluate()` runs code in the sandbox
  without persisting a backtest run.
- `apps/api/src/modules/chat/tools/short-score.tools.ts`: the chat tools.
- `packages/skills/src/short-score/prompt.ts`: `SHORT_SCORE_PROMPT` / `SHORT_SCORE_TOOLS` (enabled in
  `okx-short-ai`).
- `apps/web/src/widgets/trades-history/okx-short-ai-chat.tsx`: `ScoreStrip`.
- `packages/db`: `short_score_snapshots` table and repository.

## Research
- `claude-backtest/runs/2026-11-07-btc-long-short-score.md`
- `claude-backtest/runs/2026-11-07-btc-short-nosl-community-scan.md`

The first live backtest of the default set (2 years, 12:05 VN, ±1–3 %) gave short-win rates of about
40–59 % per score level, with no level consistently better. Per criterion, only `h4_trend_down`
separated (+5 points).
