-- Seed TradingStrategy table with strategies from back-test module

INSERT INTO `TradingStrategy` (`id`, `name`, `content`, `imageReference`, `version`, `createdAt`, `updatedAt`)
VALUES (UUID(), 'rsi-reversal', 'RSI Reversal Strategy

Timeframe: 4h
Indicators: RSI(14), ATR(14)

Entry Rules:
- Long: RSI crosses above oversold level (30) — previous RSI <= 30, current RSI > 30
- Short: RSI crosses below overbought level (70) — previous RSI >= 70, current RSI < 70

Exit Rules:
- Stop Loss: 2 × ATR below entry (long) / above entry (short)
- Take Profit: 3 × ATR above entry (long) / below entry (short)
- Risk:Reward = 1:1.5

Notes:
- Requires at least RSI_PERIOD + 2 candles (16 candles minimum)
- ATR is calculated over 14 periods and used for dynamic SL/TP sizing', '[]', '1.0.0', NOW(), NOW());

INSERT INTO `TradingStrategy` (`id`, `name`, `content`, `imageReference`, `version`, `createdAt`, `updatedAt`)
VALUES (UUID(), 'rsi-signal-crossover', 'RSI Signal-Line Crossover Strategy

Timeframe: 4h
Indicators: RSI(14), EMA(9) applied on RSI series (signal line), ATR(14)

Entry Rules:
- Long: RSI crosses above its EMA-9 signal line AND (RSI < 30 OR RSI > 50)
- Short: RSI crosses below its EMA-9 signal line AND RSI < 50

Exit Rules:
- Stop Loss: 2 × ATR below entry (long) / above entry (short)
- Take Profit: 3 × ATR above entry (long) / below entry (short)
- Risk:Reward = 1:1.5

Notes:
- Minimum candles required: RSI_PERIOD(14) + SIGNAL_PERIOD(9) + 1 = 24 candles
- RSI series is built from index RSI_PERIOD onward, then EMA-9 is applied to that series
- The dual condition (RSI + zone filter) reduces false signals in ranging markets', '[]', '1.0.0', NOW(), NOW());

INSERT INTO `TradingStrategy` (`id`, `name`, `content`, `imageReference`, `version`, `createdAt`, `updatedAt`)
VALUES (UUID(), 'supertrend-engulfing', 'Supertrend + Engulfing Candle Strategy

Timeframe: M30 (30-minute, forced)
Indicators: Supertrend(period=10, multiplier=3.0) using Wilder RMA for ATR, Engulfing candle patterns

Entry Rules:
- Long: Supertrend direction is BULLISH AND current candle is a Bullish Engulfing pattern
- Short: Supertrend direction is BEARISH AND current candle is a Bearish Engulfing pattern

Engulfing Pattern Requirements:
- Bullish: previous candle bearish, current candle bullish, current body fully engulfs previous body, current body > 1.1× previous body size
- Bearish: previous candle bullish, current candle bearish, current body fully engulfs previous body, current body > 1.1× previous body size

Exit Rules:
- Stop Loss: 500 price steps from entry
- Take Profit: 600 price steps from entry (1:1.2 Risk:Reward)

Filters:
- Time filter: No new entries from 15:00 UTC onward (trades only 00:00–14:59 UTC)

Notes:
- Supertrend uses Wilder smoothing (RMA) for ATR calculation, not simple EMA
- Direction flips when price closes above upper band (bearish→bullish) or below lower band (bullish→bearish)', '[]', '1.0.0', NOW(), NOW());

INSERT INTO `TradingStrategy` (`id`, `name`, `content`, `imageReference`, `version`, `createdAt`, `updatedAt`)
VALUES (UUID(), 'fomo-short', 'FOMO Short Strategy (Time-Based)

Timeframe: 1h (forced)
Type: Time-based short — no technical indicators

Entry Rules:
- Short every day at 03:00 UTC (configurable via params.entryHourUtc)
- Entry price = close of the 03:00 UTC candle

Exit Rules:
- Take Profit: 1000 price steps below entry (configurable via params.tpSteps)
- Stop Loss: 999,999 price steps above entry — effectively no price-based SL
- Force Close: 16:00 UTC on the same day if TP not reached (configurable via params.exitHourUtc)

Configurable Parameters:
- entryHourUtc (default: 3) — hour to enter the short
- exitHourUtc (default: 16) — hour to force-close if TP not hit
- tpSteps (default: 1000) — take-profit distance in price steps

Notes:
- Exploits the observation that early morning UTC pumps tend to fade by NY open
- Time is the only risk control — no traditional stop loss
- Best suited for high-volatility assets like BTC/ETH', '[]', '1.0.0', NOW(), NOW());

INSERT INTO `TradingStrategy` (`id`, `name`, `content`, `imageReference`, `version`, `createdAt`, `updatedAt`)
VALUES (UUID(), 'price-action', 'Multi-Timeframe Price Action Strategy

Timeframe: 15m
Indicators: ATR(14), EMA-21 on H4, Swing S/R on H1

Entry Setups:
1. Bullish Pin Bar at Support (trend = bullish)
   - H4 EMA-21 trend is bullish (price > EMA-21 by >0.1%)
   - Current candle is a high/medium quality bullish pin bar (lower shadow >= 60% of range, body <= 35% of range)
   - Pin bar low is within 0.5% of a H1 swing support level
   - SL: low − 0.5×ATR, TP: entry + 2×ATR

2. Bearish Pin Bar at Resistance (trend = bearish)
   - H4 EMA-21 trend is bearish (price < EMA-21 by >0.1%)
   - Current candle is a high/medium quality bearish pin bar (upper shadow >= 60% of range, body <= 35% of range)
   - Pin bar high is within 0.5% of a H1 swing resistance level
   - SL: high + 0.5×ATR, TP: entry − 2×ATR

3. False Breakout at Support (trend = bullish)
   - Price briefly breaks below support but closes back above it
   - SL: low − 0.3×ATR, TP: entry + 2×ATR

4. False Breakout at Resistance (trend = bearish)
   - Price briefly breaks above resistance but closes back below it
   - SL: high + 0.3×ATR, TP: entry − 2×ATR

S/R Detection:
- Swing highs/lows over last 100 H1 candles (SR_LOOKBACK = 100)
- Cluster tolerance: 0.3% — nearby swing points merged into one level
- Proximity: price must be within 0.5% of level to qualify
- Minimum 1 touch required

Session Filter:
- London open: 07:00–11:59 UTC
- NY session: 13:00–20:59 UTC
- Trades skipped outside these windows

H4 Trend Fallback (when < 26 H4 candles):
- Uses Higher Highs/Higher Lows over last 6 candles', '[]', '1.0.0', NOW(), NOW());

INSERT INTO `TradingStrategy` (`id`, `name`, `content`, `imageReference`, `version`, `createdAt`, `updatedAt`)
VALUES (UUID(), 'ema-crossover', 'Triple EMA Crossover Strategy (Multi-Filter)

Timeframe: 5m
Indicators: EMA(8), EMA(13), EMA(21), EMA(200), ADX(14), RSI(14), H1 EMA(50), ATR(14)

Entry Trigger:
- EMA8 crosses EMA13 with all three EMAs (8/13/21) aligned in the same direction

Long Entry Conditions (ALL must be true):
1. EMA8 crosses above EMA13 (crossedAbove)
2. EMA8 > EMA13 > EMA21 (full bullish alignment)
3. Price > EMA200 (macro uptrend)
4. ADX > 20 (trending market, not ranging)
5. RSI < 65 (not overbought)
6. H1 price > H1 EMA50 (higher timeframe bullish)

Short Entry Conditions (ALL must be true):
1. EMA8 crosses below EMA13 (crossedBelow)
2. EMA8 < EMA13 < EMA21 (full bearish alignment)
3. Price < EMA200 (macro downtrend)
4. ADX > 20 (trending market)
5. RSI > 35 (not oversold)
6. H1 price < H1 EMA50 (higher timeframe bearish)

Exit Rules:
- Stop Loss: 1 × ATR(14) from entry
- Take Profit: 2 × ATR(14) from entry
- Risk:Reward = 1:2

Notes:
- Minimum candles required: EMA_TREND(200) + ATR_PERIOD(14) + 2 = 216 candles
- ADX uses Wilder smoothing; values < 20 indicate ranging — skip all entries
- H1 EMA50 filter is skipped if fewer than 51 H1 candles are available', '[]', '1.0.0', NOW(), NOW());
