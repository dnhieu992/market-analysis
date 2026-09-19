## Description
_Daily macro market analysis (BTC price action + BTC.D / USDT.D / ETH.D dominance + TOTAL/2/3
regime) generated automatically by a headless Claude Code session and written into the `/journal`
database as a draft entry. The entry is tagged **author = LLM**; the moment the trader edits and
saves it in `/journal`, the app re-tags it **author = USER**, so the page can distinguish a
Claude-generated draft from the trader's own writing._

This complements the personal trading journal on `/journal` (freeform notes the trader writes) by
seeding each day with a market overview. Both live in the same `TradingJournalEntry` GENERAL scope;
the `author` column keeps them separable (e.g. the clone-training corpus filters on `author=USER`).

## Main Flow
1. `market-journal.timer` fires `market-journal.service` at **00:30 UTC (07:30 VN)** — 30 min after
   `portfolio-review` so the two headless Claude sessions never run at once on the 3.8GB box.
2. `run.sh` runs `claude -p "$(cat prompt.md)"` (model `claude-sonnet-5`, `--allowedTools "Bash(node:*) Read Write"`).
3. The session runs `snapshot.mjs` → `/var/tmp/market-journal/snapshot.json`:
   - BTC D1 + H4 and ETH D1 price action (EMA34/89/200, RSI14, ATR14, swing30, EMA stacking) from public Binance klines.
   - `btc.waveContext` — ZigZag(10%) current-wave context for the **experience-based re-buy rule**:
     `regime` (bull/bear by close vs EMA200), `waveLow`/`waveLowDaysAgo`, `waveHigh`/`runFromLowPct`,
     `deepestPullbackInWavePct`, `currentPullbackFromHighPct`, shallow re-buy levels
     (`rebuyShallowMinus5`/`rebuyShallowMinus10`) and `deepDipReversalWarn` (−15% = ~50% reversal zone).
   - Dominance / market-cap regime reused verbatim from `portfolio-review/macro.mjs` (`collectMacro()`).
   - `fearGreed` — Crypto Fear & Greed Index from `api.alternative.me/fng/` (value, classification,
     `change7d`, `avg30`, `extreme` flag). Interpreted in `## Nhận định` as a sentiment overlay:
     extreme greed → caution/avoid FOMO, extreme fear → favourable accumulation zone.
3b. The session runs `assets.mjs` → `/var/tmp/market-journal/assets.json`, which builds and uploads
    two images to Cloudflare R2 (deterministic keys `journal/<date>/{btc-d1,fear-greed}.png`):
    - **BTC D1 candlestick chart** (last ~130 daily candles + EMA34/89/200), rendered with
      `chartjs-node-canvas` using the same manual candlestick plugin style as `swing-pa-chart.ts`.
    - **Fear & Greed gauge** downloaded from `alternative.me` and **re-hosted** (the source URL always
      shows today's value, so re-hosting freezes the day's gauge with the entry).
    Resilient: a failed piece is skipped, the rest still upload, exit 0 so the run never fails on images.
4. The session writes the analysis as `/journal`-format Markdown (`#` title + `## Bitcoin` /
   `## Dominance & dòng tiền` / `## Nhận định` / `## Kế hoạch` / `## Vùng mua lại (kinh nghiệm)`,
   Vietnamese, bold key numbers) into `/var/tmp/market-journal/entry.json` (`{ date, content, tags }`).
   The last section applies an empirical rule (backtested in
   `claude-backtest/runs/2026-09-19-btc-wave-retest-single-wave.md`): in an uptrend BTC rarely
   corrects deep enough to re-buy, so in `bull` regime it recommends buying **shallow −5÷−10%
   dips** off the wave high (not waiting for a ≥15% dip, which is rare and ~50% trend reversal);
   in `bear` regime the rule is suppressed (don't buy dips into a downtrend).
5. `publish.mjs` upserts one `TradingJournalEntry` (scope GENERAL, `author=LLM`) for the day + a
   `TradingJournalRevision` snapshot (`author=LLM`), mirroring the app's own upsert/revision logic.
   It now persists `entry.json.images` (the R2 URLs from `assets.mjs`) onto the entry + revision,
   which the `/journal` widget renders as `<img>` under the note.
6. On `/journal` the entry shows a **🤖 Claude** badge; opening it shows a banner inviting the trader
   to review & save, which flips it to **✍️ Bạn**.

## Edge Cases
- **Trader already wrote the day by hand:** `publish.mjs` checks the existing entry; if `author=USER`
  it leaves it untouched (the cron never clobbers the human's own entry).
- **Trader edits an LLM draft:** any save through `POST /journal` forces `author=USER` (server-side,
  client cannot set it), so a reviewed day is permanently marked as the trader's.
- **Macro source down:** `snapshot.mjs` still returns BTC/ETH from Binance; `macro.error` is set and
  the prompt tells the model to note dominance was unavailable rather than invent numbers.
- **Fear & Greed source down:** `fearGreed.error` is set (non-fatal, own `catch`); the prompt tells
  the model to skip the sentiment line rather than invent a value.
- **Legacy entries:** the `author` column defaults to `USER`, so all 20 pre-existing hand-written
  entries read correctly as the trader's without a backfill.
- **Bear regime / thin data:** if `close < EMA200` the re-buy section flips to "stand aside" instead
  of suggesting shallow dips; if there aren't enough candles for a ZigZag pivot, `waveContext.note`
  says so and the model omits concrete re-buy levels rather than inventing them.
- **`claude` missing from PATH** (npm auto-update killed mid-flight): `run.sh` preflights and exits
  cleanly instead of a silent systemd success; `DISABLE_AUTOUPDATER=1` in both unit and script.

## Related Files (FE / BE / Worker / Ops)
- `packages/db/prisma/schema.prisma` — `author VARCHAR(8) DEFAULT 'USER'` on `TradingJournalEntry` and `TradingJournalRevision`.
- `packages/db/prisma/migrations/20260919120000_journal_author/migration.sql` — adds both columns.
- `packages/db/src/repositories/trading-journal.repository.ts` — `upsertByDate` accepts + persists `author` on entry and revision.
- `apps/api/src/modules/journal/journal.service.ts` — DTOs carry `author`; `upsert` forces `author='USER'` (web edits are always the trader).
- `apps/web/src/shared/api/types.ts` — `author?: 'USER' | 'LLM'` on entry & revision types.
- `apps/web/src/widgets/trading-journal/trading-journal.tsx` — `AuthorBadge`, LLM banner in editor, badges on history rows & entry list.
- `apps/web/src/widgets/trading-journal/journal-entry-dialog.tsx` — author badge in the read-only dialog header.
- `apps/web/src/app/globals.css` — `.tj-author*`, `.tj-llm-banner` styles.
- **Ops (server-local, gitignored under `claude-cron/`):** `claude-cron/market-journal/{snapshot.mjs,assets.mjs,prompt.md,publish.mjs,run.sh,systemd/*}` + installed units `market-journal.{service,timer}`.
  `assets.mjs` renders/uploads the D1 chart + F&G gauge to R2 (reads `R2_*` from root `.env`,
  resolves `@aws-sdk/client-s3` from `apps/api` and `chartjs-node-canvas` from `apps/worker`).
