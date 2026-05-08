import type { Candle } from '@app/core';

import type { KeyLevel, ProcessedMarketData, SwingPoint } from './swing-signal-preprocessor';

// ─── System Prompt ────────────────────────────────────────────────────────────

export const SWING_SIGNAL_SYSTEM_PROMPT = `You are a senior crypto trader specialized in price action and breakout patterns. You analyze ONE coin per request and provide structured spot-trading BUY signals.

## STRICT PATTERN DEFINITIONS

You may ONLY identify these patterns. Do NOT invent new patterns or combine them creatively.

### Continuation Patterns (require existing uptrend)

**1. Ascending Triangle**
- Horizontal resistance tested >= 2 times at similar price
- Higher lows trendline tested >= 2 times
- Pattern duration: >= 15 candles (Daily) or >= 30 candles (4H)
- Volume should decline through pattern formation

**2. Bull Flag**
- Strong upward move (flagpole) >= 5 candles, >= 10% gain
- Followed by parallel downward channel (flag) of 5-15 candles
- Volume in flag < volume in flagpole

**3. Bull Pennant**
- Like Bull Flag but consolidation is symmetrical triangle
- Same volume profile (declining in pennant)

### Reversal Patterns (at downtrend bottom or after correction)

**4. Double Bottom**
- Two lows at approximately same level (within 2% of each other)
- Separated by >= 10 candles
- Neckline = the high between the two lows
- Confirmed when price closes above neckline

**5. Inverse Head and Shoulders**
- Three lows: middle (head) is lowest
- Two shoulders at approximately similar level (within 5%)
- Neckline connects the two highs between lows
- Confirmed when price closes above neckline

**6. Falling Wedge**
- Both highs and lows declining
- Lines converging (highs falling steeper than lows)
- Volume should decline through pattern
- Bullish reversal when broken upward

### Range Patterns

**7. Rectangle / Trading Range**
- Clear horizontal support and resistance
- Both levels tested >= 2 times each
- Pattern duration >= 20 candles
- Direction of break determined by trend context

## BREAKOUT QUALITY ASSESSMENT

A high-quality breakout requires ALL of:

1. **Volume confirmation:** Breakout candle volume >= 1.5x volume MA20. Higher quality if >= 2.0x.
2. **Candle quality:** Body >= 60% of candle range (not doji or long-wick). Close near the high of the range.
3. **Close confirmation:** Close >= 1% beyond the broken level (not just wick). Higher quality if 2 consecutive closes confirmed.
4. **Multi-timeframe alignment:** At minimum, daily and 4H trends should agree. Best: Weekly trend also aligned.
5. **No major resistance overhead:** No untested major resistance within next 5% upside.

## BUY SETUP TYPES

Generate 1-3 setups based on context. Each setup should have a distinct entry strategy.

**Type 1: Aggressive Breakout Entry**
- Entry: Right after breakout confirmation
- SL: Just below the broken level (1-2% buffer)
- Use when: Strong volume + clear pattern + aligned MTF
- R:R: typically 1:2 to 1:3

**Type 2: Conservative Retest Entry**
- Entry: When price retests the broken level (now support)
- SL: Below the broken level + ATR buffer
- R:R: typically 1:2.5 to 1:4

**Type 3: Patient Pullback Entry**
- Entry: At deeper pullback to support/Fib zone
- SL: Below the support zone
- R:R: typically 1:3 to 1:5

## OUTPUT RULES (CRITICAL)

1. **Be SKEPTICAL.** Most setups deserve confidence 5-7, not 8-10. Confidence 9-10 reserved for textbook setups with multiple confluences.
2. **TP1 MUST be > current_price** for BUY signals. Non-negotiable.
3. **R:R MUST be >= 2.0** minimum. Calculate: R:R = (TP1 - Entry) / (Entry - SL).
4. **Stop Loss MUST be at structurally meaningful level:** Below recent swing low, below pattern support, below broken-then-retested level. NEVER use arbitrary % below entry.
5. **Multi-TF conflict reduces confidence:** Daily UPTREND but Weekly DOWNTREND → reduce by 2-3 points. Only 4H supports setup → reduce by 3-4 points.
6. **Prefer SKIP over forcing.** Most days, most coins should get "SKIP" or "WAIT".
7. **No pattern detected != no signal.** Valid setup can be based on key levels alone.
8. **Output VALID JSON only.** No markdown fences, no preamble, no commentary outside the JSON.

## CONFIDENCE SCORING RUBRIC

10/10: Textbook pattern + volume confirmation + MTF aligned + clean structure + good R:R + no overhead resistance
8-9/10: Strong setup, 1 minor concern
6-7/10: Decent setup, some warnings (use as default for valid setups)
4-5/10: Weak setup, multiple concerns → recommend SKIP
1-3/10: Poor setup → DO NOT generate signal

Be conservative. The market doesn't owe you a setup every day.`;

// ─── Format Helpers ───────────────────────────────────────────────────────────

function formatCandles(candles: Candle[]): string {
  return candles
    .map((c) => {
      const date = c.openTime ? c.openTime.toISOString().slice(0, 10) : 'unknown';
      return `${date} | ${c.open.toFixed(4)} | ${c.high.toFixed(4)} | ${c.low.toFixed(4)} | ${c.close.toFixed(4)} | ${(c.volume ?? 0).toFixed(2)}`;
    })
    .join('\n');
}

function formatLevels(levels: KeyLevel[]): string {
  if (levels.length === 0) return '  (none detected)';
  return levels
    .slice(0, 5)
    .map(
      (l) =>
        `  $${l.zoneCenter.toFixed(4)} | zone: $${l.zoneLow.toFixed(4)}-$${l.zoneHigh.toFixed(4)} | tests: ${l.testCount} | strength: ${l.strength}`
    )
    .join('\n');
}

function formatSwings(swings: SwingPoint[]): string {
  if (swings.length === 0) return '  (none detected)';
  return swings
    .slice(-8)
    .map((s) => {
      const date = s.time ? s.time.toISOString().slice(0, 10) : 'unknown';
      return `  ${date} | ${s.type.toUpperCase()} | $${s.price.toFixed(4)}`;
    })
    .join('\n');
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildSwingSignalPrompt(data: ProcessedMarketData): string {
  const { symbol, currentPrice, change24h, change7d, timestamp, weekly, daily, fourHour } = data;

  const fibSection = daily.fib
    ? `Fibonacci (from major swing $${daily.fib.swingLow.toFixed(4)} -> $${daily.fib.swingHigh.toFixed(4)}):
- 0.236: $${daily.fib.r236.toFixed(4)}
- 0.382: $${daily.fib.r382.toFixed(4)}
- 0.500: $${daily.fib.r500.toFixed(4)}
- 0.618: $${daily.fib.r618.toFixed(4)}
- 0.786: $${daily.fib.r786.toFixed(4)}
- Golden Zone: $${daily.fib.goldenZoneLow.toFixed(4)} - $${daily.fib.goldenZoneHigh.toFixed(4)}
- 1.272 ext: $${daily.fib.e1272.toFixed(4)}
- 1.618 ext: $${daily.fib.e1618.toFixed(4)}`
    : 'Fibonacci: (no significant swing found)';

  return `Analyze ${symbol} for SPOT BUY swing trading opportunity.

=== CURRENT STATE ===
Symbol: ${symbol}
Current price: $${currentPrice.toFixed(4)}
24h change: ${change24h}%
7d change: ${change7d}%
Analysis time: ${timestamp}

=== WEEKLY ANALYSIS ===
Trend: ${weekly.trend.direction} (${weekly.trend.strength})
Consecutive: ${weekly.trend.consecutiveHH}HH / ${weekly.trend.consecutiveHL}HL
52W high: $${(weekly.high52w ?? 0).toFixed(4)}
52W low: $${(weekly.low52w ?? 0).toFixed(4)}
Position in 52W range: ${weekly.positionInRange ?? 'N/A'}%

Recent 20 weekly candles (date | open | high | low | close | vol):
${formatCandles(weekly.recentCandles)}

Weekly key levels:
Resistance:
${formatLevels(weekly.resistance)}
Support:
${formatLevels(weekly.support)}

=== DAILY ANALYSIS ===
Trend: ${daily.trend.direction} (${daily.trend.strength})
Consecutive: ${daily.trend.consecutiveHH}HH / ${daily.trend.consecutiveHL}HL

Recent swing points (last 8):
${formatSwings(daily.swings)}

Recent 60 daily candles (date | open | high | low | close | vol):
${formatCandles(daily.recentCandles)}

Volume metrics:
- Volume MA20: ${daily.volume.ma20}
- Current volume: ${daily.volume.current}
- Ratio: ${daily.volume.ratio}x
- Trend: ${daily.volume.trend}
- Recent spike: ${daily.volume.spike}

ATR(14): $${daily.atr.toFixed(4)} (${daily.atrPct}% of price)

Daily key levels:
Resistance:
${formatLevels(daily.resistance)}
Support:
${formatLevels(daily.support)}

${fibSection}

=== 4H ANALYSIS ===
Trend: ${fourHour.trend.direction} (${fourHour.trend.strength})

Recent 50 4H candles (date | open | high | low | close | vol):
${formatCandles(fourHour.recentCandles)}

Volume metrics:
- Ratio: ${fourHour.volume.ratio}x
- Trend: ${fourHour.volume.trend}
- Spike: ${fourHour.volume.spike}

=== TASK ===

Step 1: Pattern Detection
Identify any patterns from the strict list. For each pattern specify timeframe, duration in candles, quality score (1-10), and breakout status: none / imminent / confirmed / failed.

Step 2: Setup Generation
Generate 1-3 BUY setups (or none if quality is insufficient). Each setup must be DISTINCT.

Step 3: Risk Assessment
List specific risks for this opportunity in Vietnamese.

Step 4: Recommendation
One of: BUY_NOW / WAIT_FOR_PULLBACK / WAIT_FOR_BREAKOUT / SKIP

Output ONLY the following JSON. No other text:

{
  "symbol": "${symbol}",
  "current_price": ${currentPrice},
  "overall_assessment": "BULLISH | NEUTRAL | BEARISH | UNCLEAR",
  "trend_alignment": {
    "weekly": "string",
    "daily": "string",
    "fourHour": "string",
    "aligned": true
  },
  "patterns_detected": [
    {
      "name": "string",
      "timeframe": "Daily | 4H",
      "duration_candles": 0,
      "quality_score": 0,
      "breakout_status": "none | imminent | confirmed | failed",
      "key_level": 0,
      "volume_confirmation": false,
      "notes": "Vietnamese 1-2 sentences"
    }
  ],
  "buy_setups": [
    {
      "type": "Aggressive Breakout | Conservative Retest | Patient Pullback",
      "entry_zone": [0, 0],
      "entry_target": 0,
      "stop_loss": 0,
      "stop_loss_reason": "string",
      "take_profit": [
        {"price": 0, "size_pct": 50, "reason": "string"},
        {"price": 0, "size_pct": 50, "reason": "string"}
      ],
      "risk_reward": 0,
      "confidence": 0,
      "confluence_factors": ["factor 1"],
      "reasoning": "Vietnamese 2-3 sentences"
    }
  ],
  "risk_factors": ["Vietnamese risk 1", "Vietnamese risk 2"],
  "recommendation": "BUY_NOW | WAIT_FOR_PULLBACK | WAIT_FOR_BREAKOUT | SKIP",
  "summary": "Vietnamese 2-3 sentences"
}`;
}
