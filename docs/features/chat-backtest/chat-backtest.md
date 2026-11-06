## Description
`/backtest` inside the AI chat — the in-app version of the Claude Code backtest flow in
`claude-backtest/README.md`. The trader types `/backtest <strategy>` (or just `/backtest` after
discussing a setup); Claude turns the strategy into mechanical rules, writes the backtest as
JavaScript, runs it on real Binance klines and saves a write-up. Enabled today on the **🐻 Short AI**
chat of `/trades` (skill `okx-short-ai`); any skill opts in by adding `BACKTEST_TOOLS` to its `tools`
and `BACKTEST_PROMPT` to its system prompt.

The chat runs as a headless Claude Code session with every built-in tool (Bash, Read, Write…) off,
so it cannot run scripts the way Claude Code in a terminal does. Instead `run_backtest` hands the code
to the API, which runs it in a throw-away Docker container — never in the API process (root, exchange
keys).

## Main Flow
1. User: `/backtest short khi RSI H4 cắt xuống 70, TP 5%, không SL, BTC ETH SOL 1 năm`.
2. Claude (prompt `BACKTEST_PROMPT`): restates the rules + assumptions, writes the body of a sync
   `function (ctx, ta, core)` that returns `{ trades: [...] }`, calls `run_backtest`.
3. `BacktestLabService.run()`:
   - validates the spec (≤ 20 symbols, ≤ 4 intervals, ≤ 1500 days, ≤ 300k candles in total);
   - loads CLOSED klines (Binance USDT-M futures, spot fallback / `market: 'spot'`) for the window plus
     300 warm-up bars, cached 20 min so a fix-and-rerun does not refetch;
   - runs the code in `docker run --rm --network none --read-only --user 65534 --cap-drop ALL
     --memory 512m --cpus 1 --pids-limit 64 node:22-alpine` with `@app/core`'s dist (and zod) mounted
     read-only, so `ta.qqe / supertrend / utbot / stochRsi` are the app's own indicators. Inside, the
     code runs in a `vm` context with a 90 s limit; the container is killed after 110 s;
   - validates + prices the trades in the API (`backtest-stats.ts`): fees (default 0.05 %/side),
     DCA average by coins, open-at-end trades marked to the last close, MAE/MFE from the smallest
     interval loaded, win rate, profit factor, closed-trade drawdown, losing streak, max concurrent
     trades / notional, by symbol / side / month;
   - stores the run in `backtest_runs` (spec, code, stats, ≤ 3000 compact trades, logs) and returns
     the stats + sample trades.
4. On an error (exception, wrong return shape, bad trades) Claude gets the message + stack (line
   numbers of its own code) and retries — up to 3 times per the prompt.
5. Claude writes the report (rules tested, config, results table, variants with runIds, takeaway) →
   `save_backtest_report` → `backtest_runs.report`. The reply shows the conclusion, the table and the
   runId.
6. Later: "chạy lại với TP 3%" → `list_backtest_runs` / `get_backtest_run` give the old code to edit.

## Edge Cases
- **Look-ahead**: the prompt requires entries on the next bar's open (or the signal bar's close),
  higher timeframes read through `ta.lastClosedIndex`, pivots only from `confirmedIndex`, SL-first when a
  bar touches both TP and SL. Trades entered before `ctx.fromMs` (warm-up) are dropped and reported.
- **Not backtestable** parts of a skill (chart reading, news) are named in the report, not invented.
- **Concurrency**: one sandbox at a time, at most 2 waiting; the box has 2 vCPU.
- **Image missing**: pulled in the background on API start; a run before it is ready fails with a
  clear message and retries the pull next time.
- **Turn length**: the OKX short chat allows 12 min per reply (others keep 5 min); the web watcher
  waits 13 min.
- Results exclude slippage and funding.
- The chat never saves the analysis skill by itself after a backtest — it recommends, the user decides.

## Related Files (FE / BE / Worker)

### Frontend
- `apps/web/src/shared/ui/chat/chat-parts.tsx` — progress labels for the backtest tools
- `apps/web/src/widgets/trades-history/okx-short-ai-chat.tsx` — placeholder hint, longer watch timeout

### Backend (API)
- `apps/api/src/modules/backtest-lab/backtest-lab.service.ts` — data loading, Docker sandbox, persistence
- `apps/api/src/modules/backtest-lab/sandbox-runner.ts` — the program run inside the container (`ta` helpers)
- `apps/api/src/modules/backtest-lab/backtest-stats.ts` — trade validation + stats
- `apps/api/src/modules/backtest-lab/kline-loader.ts` — paged Binance klines
- `apps/api/src/modules/chat/tools/backtest.tools.ts` — `run_backtest`, `save_backtest_report`, `list_backtest_runs`, `get_backtest_run`
- `apps/api/src/modules/chat/providers/claude-chat.provider.ts` — `timeoutMs` run option
- `packages/skills/src/backtest/prompt.ts` — `BACKTEST_PROMPT`, `BACKTEST_TOOLS`
- `apps/api/test/backtest-stats.spec.ts`

### Database
- `packages/db/prisma/schema.prisma` — `BacktestRun` (`backtest_runs`)
- `packages/db/prisma/migrations/20261106160000_backtest_runs/migration.sql`
- `packages/db/src/repositories/backtest-run.repository.ts`
