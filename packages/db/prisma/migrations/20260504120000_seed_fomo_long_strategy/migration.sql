-- Seed fomo-long TradingStrategy
INSERT INTO `TradingStrategy` (`id`, `name`, `content`, `imageReference`, `version`, `createdAt`, `updatedAt`)
VALUES (UUID(), 'fomo-long', 'FOMO Long Strategy (Time-Based + UT Bot Filter)

Timeframe: 1h (forced)
Type: Time-based long with M30 UT Bot trend filter

Entry Rules:
- Long every day at 03:00 UTC (configurable via params.entryHourUtc)
- Entry price = close of the 03:00 UTC candle
- FILTER: M30 UT Bot indicator must be in uptrend at entry time
  (close of most recent M30 candle must be above the UT Bot trailing stop)

UT Bot Indicator (M30):
- ATR period: 10 (configurable via params.utBotPeriod)
- ATR multiplier: 1 (configurable via params.utBotMultiplier)
- Trailing stop calculated with Wilder RMA ATR
- Uptrend = close > trailing stop

Exit Rules:
- Take Profit: entry × (1 + tpPct) — default 1% above entry (configurable via params.tpPct)
- Stop Loss: 999,999 price steps below entry — effectively no price-based SL
- Force Close: 16:00 UTC on the same day if TP not reached (configurable via params.exitHourUtc)

Configurable Parameters:
- entryHourUtc (default: 3) — hour to enter the long
- exitHourUtc (default: 16) — hour to force-close if TP not hit
- tpPct (default: 0.01 = 1%) — take-profit as a percentage of entry price
- utBotPeriod (default: 10) — ATR period for UT Bot calculation
- utBotMultiplier (default: 1) — ATR multiplier for UT Bot trailing stop

Notes:
- Mirror of fomo-short but for long positions, with an additional trend filter
- UT Bot filter prevents longs during downtrends, improving win rate
- Time is the primary risk control — no traditional stop loss
- Best suited for high-volatility assets like BTC/ETH', '[]', '1.0.0', NOW(), NOW());
