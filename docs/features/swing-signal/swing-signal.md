## Description

Daily swing signal scanner that runs at 00:30 UTC. For each symbol in the user's watchlist (`User.symbolsTracking`), it fetches multi-timeframe candle data (Weekly/Daily/4H), pre-processes price action metrics deterministically in code, then calls Claude AI to identify breakout patterns and generate structured BUY setups. Valid signals are sent to Telegram; SKIP recommendations are silently dropped.

## Main Flow

1. **Cron trigger** — `@Cron('30 0 * * *', { timeZone: 'UTC' })` fires at 00:30 UTC daily.
2. **Load watchlist** — `userRepository.findFirst()` → `User.symbolsTracking` (string[]). If empty, exit.
3. **Loop each symbol** with 1.5s delay between coins (rate limiting).
4. **Fetch candles** — `Promise.all([1w×150, 1d×365, 4h×360])` via `MarketDataService`.
5. **Pre-process** — `preProcess()` computes: swing detection (3-bar rule), trend direction/strength, volume metrics (MA20, ratio, spike), ATR(14), S/R key levels (clustering 1.5%), Fibonacci levels.
6. **Build prompt** — `buildSwingSignalPrompt()` assembles user prompt with all pre-processed data. System prompt is a constant with strict pattern definitions (7 patterns), breakout quality rules, and confidence rubric.
7. **Call Claude** — `POST /messages` via axios with `temperature: 0.2`, `max_tokens: 4000`, prompt caching on system prompt (`cache_control: ephemeral`). Returns plain JSON text.
8. **Parse** — `parseAiResponse()` JSON.parse + shape check.
9. **Validate** — `validateAnalysis()` applies 7 hard rules (reject invalid setups) + 3 soft rules (warnings). Recomputes R:R from raw numbers and overrides AI value.
10. **Send** — If `recommendation !== 'SKIP'` and at least 1 valid setup remains, `formatSwingSignalBreakoutMessage()` → `TelegramService.sendAnalysisMessage()`. Telegram errors are non-fatal (warn + continue).

## Edge Cases

- `symbolsTracking` empty → log and exit, no Telegram sent.
- Insufficient candles (< 30 daily) → skip symbol silently.
- Claude returns invalid JSON → `parseAiResponse()` returns null, skip symbol.
- All buy_setups fail hard validation → `recommendation` forced to `SKIP`, no Telegram.
- Telegram send failure → `Logger.warn()`, continue to next symbol (non-fatal).
- Claude API error (timeout, 5xx) → `Logger.warn()` with HTTP status + body, skip symbol, continue loop.
- Per-symbol errors never crash the entire scan loop — each is wrapped in try/catch.

## Validation Hard Rules (per setup)

1. TP1 > current price
2. SL < entry target
3. R:R >= 2.0 (recomputed, AI value overridden)
4. SL distance 1.5%–15% from entry
5. TPs in ascending order
6. TP size percentages normalized to 100%
7. Entry target within entry zone bounds

## Related Files (Worker)

- `apps/worker/src/modules/swing-signal/swing-signal.service.ts` — orchestrates the full pipeline per symbol; Claude axios client; `checkAll()` entry point
- `apps/worker/src/modules/swing-signal/swing-signal-preprocessor.ts` — deterministic math: swing detection, trend, volume, ATR, S/R levels, Fibonacci
- `apps/worker/src/modules/swing-signal/swing-signal-prompt.ts` — `SWING_SIGNAL_SYSTEM_PROMPT` constant and `buildSwingSignalPrompt()` user prompt builder
- `apps/worker/src/modules/swing-signal/swing-signal-validator.ts` — AI response types, `parseAiResponse()`, `validateAnalysis()` with hard + soft rules
- `apps/worker/src/modules/swing-signal/swing-signal-formatter.ts` — `formatSwingSignalBreakoutMessage()` HTML Telegram formatter
- `apps/worker/src/modules/swing-signal/swing-signal.module.ts` — NestJS module (imports MarketModule, TelegramModule)
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — `@Cron('30 0 * * *')` triggers `swingSignalService.checkAll()`
- `apps/worker/src/modules/market/market-data.service.ts` — `getCandles(symbol, timeframe, limit)` via Binance
- `apps/worker/src/modules/telegram/telegram.service.ts` — `sendAnalysisMessage()` used to deliver signals
