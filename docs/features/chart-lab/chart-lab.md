## Description
`/chart-lab` — the user's chart library ("kho chart"). The user uploads a screenshot and types a quick
analysis: coin, timeframe, time, direction (LONG / SHORT / ĐỨNG NGOÀI), entry / TP / SL prices, tags, note.
Saving only inserts it into the DB (**no AI**). The server pins it to the Binance candle containing the
time, fingerprints the market (RSI / EMA distance / BB / volume / ATR) and scores what happened next (move
after 6/24/72 candles + whether the user's TP or SL was hit first). Claude runs **only when the user clicks
🔍 Analyze** on a chart: it evaluates the user's analysis against the real result, gives its own analysis,
compares with the most similar library charts and summarizes. The answer is kept on the chart (aiSummary)
and follow-up questions go to the same thread.

## Main Flow
1. Upload (file / drag-drop / paste) → `POST /uploads/images` (R2) → `NewChartDialog` (one form per image).
2. Save → `POST /chart-lab/samples {imageUrl, imageKey, symbol, interval, chartTime, direction, entryPrice, tpPrice, slPrice, tags, note}`.
   `ChartLabService.parse` normalizes coin/timeframe and pins `chartTime` to the candle containing it (empty = latest
   closed candle); `recompute` → features + outcome. Entry = user's price, else the candle close (`features.close`);
   TP/SL % from the user's prices, else defaults by timeframe (`levelsOf`).
3. Edit in the detail drawer (`PATCH`, only changed fields). Coin/timeframe/time/prices changes re-score.
4. Cron `*/10 * * * *` (`refreshPending`) re-scores PENDING charts until 72 candles + both TP/SL resolved, or 200 candles.
5. Analyze (tile button or drawer) → `POST /chart-lab/samples/:id/analyze` (`ChartLabAnalyzeController`, chat module):
   ensures the chart's conversation (skill `chart-lab`, metadata `{sampleId}`) and sends `CHART_LAB_ANALYZE_PROMPT`.
   `ConversationService` builds the prompt with `ChartLabService.buildChatContext` (user analysis + real outcome +
   up to 4 similar charts as images + win rates on the OTHER charts) and stores the reply via `saveAnalysis`.
   Follow-ups: `POST …/conversation` + normal chat messages.

## Similarity
`distance()` in chart-lab.engine.ts: RMS of an 11-dim vector with moves in ATR units (so 1h alt and 1d BTC compare),
minus 0.35 × tag Jaccard, +0.1 if timeframes differ. `similarityPct = 100·e^(−d)`.

## Edge Cases
- No coin/timeframe → saved anyway, `outcomeStatus=ERROR` with a message; scoring starts once the user fills them.
- Coin not on Binance spot → USDT-M futures klines; neither → ERROR.
- TP and SL inside the same candle → counted as SL (conservative).
- Only images from `R2_PUBLIC_URL` are fetched server-side (no arbitrary URL fetch).

## Related Files (FE / BE)
- `apps/web/src/widgets/chart-lab/*` — page view, new-chart dialog, shared form, detail drawer, Claude panel, parts, CSS (FE)
- `apps/web/src/app/chart-lab/page.tsx`, `_pages/chart-lab-page` — route (FE)
- `apps/api/src/modules/chart-lab/*` — engine (klines/features/outcome/similarity), service, controller, module (BE)
- `apps/api/src/modules/chat/chart-lab-analyze.controller.ts` — Analyze + the chart's conversation (BE)
- `apps/api/src/modules/chat/tools/chart-lab.tools.ts` — find_similar_charts, get_chart_lab_stats, get_chart_outcome, update_chart_sample (BE)
- `apps/api/src/modules/chat/providers/claude-chat.provider.ts` — `images` run option (streaming input) + `askWithImages` (BE)
- `packages/skills/src/chart-lab` — chat skill prompt
- `packages/db` — `ChartSample` model (`chart_samples`), migrations 20261110100000_chart_samples + 20261110120000_chart_samples_user_analysis, repository
