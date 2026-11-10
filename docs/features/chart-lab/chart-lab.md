## Description
`/chart-lab` — the user's library of price-chart screenshots. Each upload is read by Claude (coin,
timeframe, last candle, setup description, suggested tags), pinned to its Binance candle, fingerprinted
(RSI / EMA distance / BB / volume / ATR at that candle) and scored as candles close (move after 6/24/72
candles + which of TP/SL is hit first, for LONG and SHORT). The user labels each chart LONG / SHORT /
ĐỨNG NGOÀI with tags + a note; the page shows win rates of those calls per direction and per tag. Each
chart has an analysis chat: Claude gets the chart image + the most similar library charts (images, labels,
real outcomes) + tag win rates, so it "learns" from the library without any model training.

## Main Flow
1. Upload (file / drag-drop / paste) → `POST /uploads/images` (R2) → `POST /chart-lab/samples {imageUrl, imageKey}`.
2. `ChartLabService.create`: Claude vision one-shot (`ClaudeChatProvider.askWithImages`, READ_SYSTEM prompt) →
   `normalizeSymbol` / `normalizeInterval` → `resolveChartCandle` (candle near the axis time whose close matches
   the price read; no time → latest closed candle) → default TP/SL by timeframe → features + outcome.
3. Detail drawer: user edits label / tags / note / TP-SL or fixes coin-timeframe-time (`PATCH`, re-pins to the
   candle containing the time and recomputes). Result stays hidden until the chart is labeled (no spoiler).
4. Cron `*/10 * * * *` (`refreshPending`) re-scores PENDING charts until 72 candles + both TP/SL resolved, or 200 candles.
5. Chat: `POST /chart-lab/samples/:id/conversation` creates a conversation (skill `chart-lab`, metadata `{sampleId}`).
   Every turn `ConversationService` calls `ChartLabService.buildChatContext` → system prompt + images
   (image 1 = this chart, then up to 4 similar charts; known outcomes preferred). This chart's own outcome is NOT in
   the context — tool `get_chart_outcome` only when the user asks.

## Similarity
`distance()` in chart-lab.engine.ts: RMS of an 11-dim vector with moves in ATR units (so 1h alt and 1d BTC compare),
minus 0.35 × tag Jaccard, +0.1 if timeframes differ. `similarityPct = 100·e^(−d)`.

## Edge Cases
- Claude can't read coin/timeframe → sample saved with `outcomeStatus=ERROR` and a message; user fixes in the form.
- Coin not on Binance spot → USDT-M futures klines; neither → ERROR.
- TP and SL inside the same candle → counted as SL (conservative).
- Only images from `R2_PUBLIC_URL` are fetched server-side (no arbitrary URL fetch).

## Related Files (FE / BE)
- `apps/web/src/widgets/chart-lab/*` — page view, detail drawer, chat, parts, CSS (FE)
- `apps/web/src/app/chart-lab/page.tsx`, `_pages/chart-lab-page` — route (FE)
- `apps/api/src/modules/chart-lab/*` — engine (klines/features/outcome/similarity), service, controller, module (BE)
- `apps/api/src/modules/chat/tools/chart-lab.tools.ts` — find_similar_charts, get_chart_lab_stats, get_chart_outcome, update_chart_sample (BE)
- `apps/api/src/modules/chat/providers/claude-chat.provider.ts` — `images` run option (streaming input) + `askWithImages` (BE)
- `packages/skills/src/chart-lab` — chat skill prompt
- `packages/db` — `ChartSample` model (`chart_samples`), migration 20261110100000_chart_samples, repository
