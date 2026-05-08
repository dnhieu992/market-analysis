# AI Breakout Analysis — Rule & Flow Specification

## Mục tiêu

Build một flow đơn giản: **scan watchlist → phân tích → bắn signal Telegram**.

Tập trung vào **chất lượng rule phân tích**, không cần DB, không cần tracking.

---

## Flow tổng quan

```
[CRON 00:30 UTC — @Cron('30 0 * * *')]
       |
[Load watchlist: User.symbolsTracking từ DB]
       |
[Loop từng coin trong watchlist]
       |-- Fetch W(150) + D(365) + 4H(360) candles (Promise.all)
       |-- Pre-process: tính metrics bằng code
       |-- Build prompt với data đã pre-process
       |-- Call Claude API (plain text JSON response)
       |-- Parse JSON response
       |-- Validate output (hard rules + soft rules)
       |-- Nếu có signal → Send Telegram
       |
[Done]
```

**Nguyên tắc cốt lõi:**
- **Code làm số học** (swing, volume, ATR, fib, S/R) — chính xác, deterministic
- **AI làm phân tích định tính** (pattern recognition, breakout assessment, reasoning)
- **Validator filter output** trước khi gửi (fix các bug số học AI có thể tạo ra)

---

## Phần 1: Pre-Processing Rules (Code thực hiện)

Đây là phần code phải tự tính trước khi đưa cho AI. AI **KHÔNG được tự tính** các con số này.

### 1.1 Swing Detection

**Input:** Mảng candles
**Output:** Danh sách swing high/low

**Rule:**
```
Swing High tại index i nếu:
  candles[i].high > max(candles[i-3..i-1].high)  AND
  candles[i].high > max(candles[i+1..i+3].high)

Swing Low tại index i nếu:
  candles[i].low < min(candles[i-3..i-1].low)   AND
  candles[i].low < min(candles[i+1..i+3].low)
```

**Áp dụng:** Daily và 4H. Lấy 8-10 swing gần nhất.

### 1.2 Trend Detection

**Input:** Danh sách swing đã sort theo thời gian
**Output:** Trend status

**Rule:**
```
UPTREND nếu:
  - 2+ swing high gần nhất là Higher Highs (HH)
  - VÀ 2+ swing low gần nhất là Higher Lows (HL)

DOWNTREND nếu:
  - 2+ swing high gần nhất là Lower Highs (LH)
  - VÀ 2+ swing low gần nhất là Lower Lows (LL)

SIDEWAYS nếu:
  - Mixed pattern (không đủ điều kiện trên)

Strength:
  - STRONG: 4+ swing liên tiếp đúng pattern
  - MODERATE: 2-3 swing
  - WEAK: vừa đủ 2
```

### 1.3 Volume Analysis

**Rule:**
```
volume_ma20 = avg(volume[last 20 candles, excluding current])
volume_ratio = current_volume / volume_ma20

volume_trend:
  recent_5_avg = avg(volume[last 5])
  prev_15_avg = avg(volume[6 to 20])

  if recent_5_avg > prev_15_avg x 1.15: INCREASING
  if recent_5_avg < prev_15_avg x 0.85: DECREASING
  else: STABLE

volume_spike = volume_ratio >= 1.5
```

### 1.4 ATR (14)

**Rule:**
```
TR[i] = max(
  high[i] - low[i],
  |high[i] - close[i-1]|,
  |low[i] - close[i-1]|
)
ATR = average of last 14 TRs
```

Dùng để tính khoảng cách stop loss tối thiểu.

### 1.5 Key Level Detection (S/R)

**Rule:**
```
1. Lấy tất cả swing high + swing low từ 100 candles gần nhất

2. Cluster các swing có giá gần nhau (trong 1.5%):
   - Group nếu |price1 - price2| / avg < 0.015

3. Một level "valid" cần >= 2 swing trong cluster

4. Tính zone:
   - zoneCenter = mean(prices trong cluster)
   - zoneWidth = max(0.5% x zoneCenter, 0.5 x ATR)
   - zoneLow = zoneCenter - zoneWidth/2
   - zoneHigh = zoneCenter + zoneWidth/2

5. Phân loại theo CURRENT PRICE (cực kỳ quan trọng):
   - if zoneCenter > current_price: type = "resistance"
   - if zoneCenter < current_price: type = "support"

6. Strength score:
   - testCount x recency_factor
   - recency_factor = 1.0 - (candles_since_last_test / 100)
   - max strength = 10
```

**LƯU Ý:** Phải classify dựa trên giá hiện tại, không phải bản chất lịch sử.

### 1.6 Fibonacci Levels

**Rule:**
```
1. Tìm major swing gần nhất:
   - Trong UPTREND: từ swing low -> swing high lớn gần đây nhất
   - Magnitude phải >= 5% (filter swing nhỏ)

2. Tính retracements:
   range = swingHigh - swingLow
   fib_0.236 = swingHigh - range x 0.236
   fib_0.382 = swingHigh - range x 0.382
   fib_0.500 = swingHigh - range x 0.500
   fib_0.618 = swingHigh - range x 0.618
   fib_0.786 = swingHigh - range x 0.786

3. Tính extensions:
   fib_1.272 = swingHigh + range x 0.272
   fib_1.618 = swingHigh + range x 0.618
   fib_2.000 = swingHigh + range x 1.000

4. Golden Zone = [fib_0.618, fib_0.500]
```

---

## Phần 2: AI Analysis Rules

### 2.1 System Prompt (cho Claude)

```
You are a senior crypto trader specialized in price action and breakout
patterns. You analyze ONE coin per request and provide structured
spot-trading BUY signals.

## STRICT PATTERN DEFINITIONS

You may ONLY identify these patterns. Do NOT invent new patterns or
combine them creatively.

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

1. **Volume confirmation:**
   - Breakout candle volume >= 1.5x volume MA20
   - Higher quality if >= 2.0x

2. **Candle quality:**
   - Body >= 60% of candle range (not doji or long-wick)
   - Close near the high of the range

3. **Close confirmation:**
   - Close >= 1% beyond the broken level (not just wick)
   - Higher quality if 2 consecutive closes confirmed

4. **Multi-timeframe alignment:**
   - At minimum, daily and 4H trends should agree
   - Best: Weekly trend also aligned

5. **No major resistance overhead:**
   - No untested major resistance within next 5% upside

## BUY SETUP TYPES

Generate 1-3 setups based on context. Each setup should have a
distinct entry strategy.

**Type 1: Aggressive Breakout Entry**
- Entry: Right after breakout confirmation
- SL: Just below the broken level (1-2% buffer)
- Use when: Strong volume + clear pattern + aligned MTF
- Risk: Higher false breakout chance
- R:R: typically 1:2 to 1:3

**Type 2: Conservative Retest Entry**
- Entry: When price retests the broken level (now support)
- SL: Below the broken level + ATR buffer
- Use when: Already broke, now pulling back
- Risk: Price may not retest (miss opportunity)
- R:R: typically 1:2.5 to 1:4 (better risk)

**Type 3: Patient Pullback Entry**
- Entry: At deeper pullback to support/Fib zone
- SL: Below the support zone
- Use when: Price overshoot, expecting healthy pullback
- Risk: May continue without pullback
- R:R: typically 1:3 to 1:5 (best risk)

## OUTPUT RULES (CRITICAL)

1. **Be SKEPTICAL.** Most setups deserve confidence 5-7, not 8-10.
   Confidence 9-10 should be reserved for textbook setups with
   multiple confluences.

2. **TP1 MUST be > current_price** for BUY signals. This is non-negotiable.

3. **R:R MUST be >= 2.0** minimum. Calculate from raw numbers:
   R:R = (TP1 - Entry) / (Entry - SL)

4. **Stop Loss MUST be at structurally meaningful level:**
   - Below recent swing low
   - Below pattern support
   - Below broken-then-retested level
   - NEVER use arbitrary % below entry

5. **Multi-TF conflict reduces confidence:**
   - If Daily UPTREND but Weekly DOWNTREND -> reduce by 2-3 points
   - If only 4H trend supports the setup -> reduce by 3-4 points

6. **Prefer SKIP over forcing.** Most days, most coins should get
   "SKIP" or "WAIT". Forcing signals dilutes quality.

7. **No pattern detected != no signal.** A coin can have valid setup
   based on key levels alone (e.g., bouncing off major support in uptrend).

8. **Output VALID JSON only.** No markdown fences, no preamble,
   no commentary outside the JSON structure.

## CONFIDENCE SCORING RUBRIC

10/10: Textbook pattern + volume confirmation + MTF aligned + clean
       structure + good R:R + no overhead resistance
8-9/10: Strong setup, 1 minor concern
6-7/10: Decent setup, some warnings (use as default for valid setups)
4-5/10: Weak setup, multiple concerns -> recommend SKIP
1-3/10: Poor setup -> DO NOT generate signal

Be conservative. The market doesn't owe you a setup every day.
```

### 2.2 User Prompt Template

```
Analyze ${symbol} for SPOT BUY swing trading opportunity.

=== CURRENT STATE ===
Symbol: ${symbol}
Current price: $${currentPrice}
24h change: ${change24h}%
7d change: ${change7d}%
Analysis time: ${timestamp}

=== WEEKLY ANALYSIS ===
Trend: ${weekly.trend.direction} (${weekly.trend.strength})
Consecutive: ${weekly.trend.consecutiveHH}HH / ${weekly.trend.consecutiveHL}HL

52W high: $${weekly.high52w}
52W low: $${weekly.low52w}
Position in 52W range: ${weekly.positionInRange}%

Recent 20 weekly candles:
${formatCandles(weekly.recentCandles)}

Weekly key levels (sorted by relevance):
Resistance:
${formatLevels(weekly.resistance)}
Support:
${formatLevels(weekly.support)}

=== DAILY ANALYSIS ===
Trend: ${daily.trend.direction} (${daily.trend.strength})
Consecutive: ${daily.trend.consecutiveHH}HH / ${daily.trend.consecutiveHL}HL

Recent swing points (last 8):
${formatSwings(daily.swings)}

Recent 60 daily candles:
${formatCandles(daily.recentCandles)}

Volume metrics:
- Volume MA20: ${daily.volume.ma20}
- Current volume: ${daily.volume.current}
- Ratio: ${daily.volume.ratio}x
- Trend: ${daily.volume.trend}
- Recent spike: ${daily.volume.spike}

ATR(14): $${daily.atr} (${daily.atrPct}% of price)

Daily key levels:
Resistance:
${formatLevels(daily.resistance)}
Support:
${formatLevels(daily.support)}

Fibonacci (from major swing $${daily.fib.swingLow} -> $${daily.fib.swingHigh}):
- 0.236: $${daily.fib.r236}
- 0.382: $${daily.fib.r382}
- 0.500: $${daily.fib.r500}
- 0.618: $${daily.fib.r618}
- 0.786: $${daily.fib.r786}
- Golden Zone: $${daily.fib.goldenZoneLow} - $${daily.fib.goldenZoneHigh}
- 1.272 ext: $${daily.fib.e1272}
- 1.618 ext: $${daily.fib.e1618}

=== 4H ANALYSIS ===
Trend: ${fourHour.trend.direction}

Recent 50 4H candles:
${formatCandles(fourHour.recentCandles)}

Volume metrics:
- Ratio: ${fourHour.volume.ratio}x
- Trend: ${fourHour.volume.trend}

=== TASK ===

Step 1: Pattern Detection
Identify any patterns from the strict list. For each pattern:
- Specify timeframe (Daily or 4H)
- Specify duration in candles
- Quality score (1-10)
- Breakout status: none / imminent / confirmed / failed

Step 2: Setup Generation
Generate 1-3 BUY setups (or none if quality is insufficient).
Each setup should be DISTINCT in approach (don't generate 3 similar
setups with slightly different entries).

Step 3: Risk Assessment
List specific risks for this opportunity.

Step 4: Recommendation
One of: BUY_NOW / WAIT_FOR_PULLBACK / WAIT_FOR_BREAKOUT / SKIP

Output the JSON schema below. NO other text.

{
  "symbol": "${symbol}",
  "current_price": ${currentPrice},
  "overall_assessment": "BULLISH | NEUTRAL | BEARISH | UNCLEAR",
  "trend_alignment": {
    "weekly": "...",
    "daily": "...",
    "fourHour": "...",
    "aligned": boolean
  },
  "patterns_detected": [
    {
      "name": "string",
      "timeframe": "Daily | 4H",
      "duration_candles": number,
      "quality_score": number,
      "breakout_status": "none | imminent | confirmed | failed",
      "key_level": number,
      "volume_confirmation": boolean,
      "notes": "Vietnamese, 1-2 sentences"
    }
  ],
  "buy_setups": [
    {
      "type": "Aggressive Breakout | Conservative Retest | Patient Pullback",
      "entry_zone": [number, number],
      "entry_target": number,
      "stop_loss": number,
      "stop_loss_reason": "why this SL level",
      "take_profit": [
        {"price": number, "size_pct": number, "reason": "why this TP"},
        {"price": number, "size_pct": number, "reason": "why this TP"}
      ],
      "risk_reward": number,
      "confidence": number,
      "confluence_factors": ["factor 1", "factor 2"],
      "reasoning": "Vietnamese, 2-3 sentences explaining the setup"
    }
  ],
  "risk_factors": [
    "specific risk 1 in Vietnamese",
    "specific risk 2 in Vietnamese"
  ],
  "recommendation": "BUY_NOW | WAIT_FOR_PULLBACK | WAIT_FOR_BREAKOUT | SKIP",
  "summary": "Vietnamese, 2-3 sentences final assessment"
}
```

### 2.3 Claude API Call

```typescript
// Pattern: axios trực tiếp (giống SwingPaReviewService)
const response = await client.post('/messages', {
  model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
  max_tokens: 4000,
  temperature: 0.2,
  system: [
    {
      type: 'text',
      text: SWING_SIGNAL_SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' }  // prompt caching — giảm cost ~70%
    }
  ],
  messages: [
    { role: 'user', content: userPrompt }
  ]
});
// Extract: response.data.content[0].text -> JSON.parse
```

**Model:** `process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'` (follow env convention của project)

**Timeout:** 90s (vì phải xử lý 30+ coin liên tiếp)

---

## Phần 3: Validation Rules

Sau khi nhận JSON từ AI, code phải validate lại trước khi gửi Telegram.

### 3.1 Hard Rules (Reject setup nếu fail)

```
For each setup in buy_setups:

  RULE 1: TP1 > current_price
    if take_profit[0].price <= current_price:
      REJECT setup

  RULE 2: SL < entry_target
    if stop_loss >= entry_target:
      REJECT setup

  RULE 3: R:R recompute
    risk = entry_target - stop_loss
    reward = take_profit[0].price - entry_target
    actual_rr = reward / risk

    setup.risk_reward = round(actual_rr, 2)  // Override AI value

    if actual_rr < 2.0:
      REJECT setup

  RULE 4: SL distance reasonable
    sl_distance_pct = (entry_target - stop_loss) / entry_target x 100

    if sl_distance_pct < 1.5: REJECT
    if sl_distance_pct > 15: REJECT

  RULE 5: TPs in ascending order
    for i in 1..take_profit.length-1:
      if take_profit[i].price <= take_profit[i-1].price:
        REJECT setup

  RULE 6: TP percentages sum ~ 100
    total = sum(tp.size_pct for tp in take_profit)
    if abs(total - 100) > 2:
      AUTO-FIX: normalize to 100

  RULE 7: Entry zone validity
    if entry_zone[0] > entry_zone[1]:
      SWAP entry_zone values

    if entry_target < entry_zone[0] or entry_target > entry_zone[1]:
      REJECT setup
```

### 3.2 Soft Rules (Warn but keep setup)

```
WARN 1: Entry far from current price
  if abs(entry_target - current_price) / current_price > 10%:
    add warning

WARN 2: Low confidence
  if confidence < 6:
    add warning

WARN 3: MTF not aligned
  if not trend_alignment.aligned:
    add warning
```

### 3.3 Filter Logic Cuối

```
1. Remove all REJECTED setups from buy_setups[]

2. If no valid setups remain:
   recommendation = "SKIP"

3. Sort remaining setups by confidence DESC

4. If recommendation == "SKIP":
   DO NOT send Telegram
   ELSE:
   Send Telegram notification
```

---

## Phần 4: Telegram Output

Chỉ gửi khi `recommendation` != `SKIP` VÀ có ít nhất 1 valid setup.

### 4.1 Message Template

```
${emoji} <b>${symbol}</b> — ${recommendation}

<b>Current:</b> $${current_price}
<b>Assessment:</b> ${overall_assessment}

<b>Trend Alignment:</b>
W: ${weekly} | D: ${daily} | 4H: ${fourHour}
${aligned ? 'Aligned' : 'NOT aligned'}

<b>Patterns Detected:</b>
${patterns.map(p =>
  `• ${p.name} (${p.timeframe}) — Q:${p.quality_score}/10 — ${p.breakout_status}`
).join('\n')}

${buy_setups.map((setup, i) => `
<b>Setup ${i+1}: ${setup.type}</b> (${setup.confidence}/10)
Entry: $${setup.entry_target}
Zone: $${setup.entry_zone[0]} - $${setup.entry_zone[1]}
SL: $${setup.stop_loss}
${setup.stop_loss_reason}
TP:
${setup.take_profit.map(tp =>
  `  • $${tp.price} (${tp.size_pct}%) — ${tp.reason}`
).join('\n')}
R:R: 1:${setup.risk_reward}
Confluence: ${setup.confluence_factors.join(', ')}
${setup.reasoning}
`).join('\n')}

<b>Risks:</b>
${risk_factors.map(r => `• ${r}`).join('\n')}

${summary}

<i>DYOR. Not financial advice.</i>
```

Gửi qua `TelegramService.sendAnalysisMessage()` (HTML parse mode).

### 4.2 Emoji Mapping

```
BUY_NOW           -> 🟢
WAIT_FOR_PULLBACK -> 🟡
WAIT_FOR_BREAKOUT -> 🔵
SKIP              -> (don't send)
```

---

## Phần 5: NestJS Implementation Flow

```typescript
// SwingSignalService (NestJS @Injectable)

async checkAll(): Promise<void> {
  // 1. Load watchlist từ DB (giữ nguyên logic cũ)
  const user = await this.userRepository.findFirst();
  const symbols: string[] = Array.isArray(user?.symbolsTracking)
    ? (user.symbolsTracking as string[])
    : [];

  if (symbols.length === 0) {
    this.logger.log('SwingSignal: no symbols to check');
    return;
  }

  // 2. Loop through watchlist
  for (const symbol of symbols) {
    try {
      await this.analyzeSymbol(symbol);
    } catch (error) {
      this.logger.error(`SwingSignal failed for ${symbol}: ${error.message}`);
      // Continue with next coin
    }
    await sleep(1500); // rate limit
  }
}

private async analyzeSymbol(symbol: string): Promise<void> {
  // 2a. Fetch multi-TF data
  const [weekly, daily, fourHour] = await Promise.all([
    this.marketDataService.getCandles(symbol, '1w', 150),
    this.marketDataService.getCandles(symbol, '1d', 365),
    this.marketDataService.getCandles(symbol, '4h', 360)
  ]);

  // 2b. Pre-process
  const processed = preProcess(symbol, weekly, daily, fourHour);

  // 2c. Build prompt
  const userPrompt = buildSwingSignalPrompt(processed);

  // 2d. Call Claude
  const rawText = await this.callClaude(userPrompt);

  // 2e. Parse JSON
  const analysis = parseAiResponse(rawText);
  if (!analysis) return;

  // 2f. Validate
  const validated = validateAnalysis(analysis, processed.currentPrice);

  // 2g. Send if actionable
  if (validated.recommendation !== 'SKIP' && validated.buy_setups.length > 0) {
    const message = formatSwingSignalBreakoutMessage(validated);
    await this.telegramService.sendAnalysisMessage({
      content: message,
      messageType: 'swing-signal'
    });
    this.logger.log(`SwingSignal sent for ${symbol}: ${validated.recommendation}`);
  } else {
    this.logger.log(`SwingSignal SKIP for ${symbol}`);
  }
}
```

**Cron (trong SchedulerService):**
```typescript
// Runs daily at 00:30 UTC
@Cron('30 0 * * *', { timeZone: 'UTC' })
async runDailySwingScan() {
  this.logger.log('Running daily swing signal scan');
  await this.swingSignalService.checkAll();
}
```

---

## Phần 6: Configuration

```typescript
// Không cần config file riêng — dùng constants trong service
const CANDLE_LIMITS = {
  weekly: 150,
  daily: 365,
  fourHour: 360
};

const TRADING_CONFIG = {
  minRiskReward: 2.0,
  minSlDistancePct: 1.5,
  maxSlDistancePct: 15,
};

const SWING_CONFIG = {
  leftBars: 3,
  rightBars: 3
};

const VOLUME_CONFIG = {
  spikeThreshold: 1.5,
  maPeriod: 20
};
```

**Watchlist:** Lấy từ `User.symbolsTracking` trong DB — không phải config file.

---

## Phần 7: Quality Checklist

Trước mỗi signal được gửi, đảm bảo:

```
[ ] TP1 > current_price?
[ ] SL < entry_target?
[ ] R:R >= 2.0 (recomputed from raw numbers)?
[ ] SL distance giữa 1.5% và 15%?
[ ] TPs in ascending order?
[ ] TP sizes sum to 100%?
[ ] Entry target trong entry zone?
[ ] Pattern matches strict definition?
[ ] Volume confirmation (nếu pattern claim breakout)?
[ ] Multi-TF check done?
[ ] Confidence >= 6 (or warning shown)?
```

---

## Performance Expectations

Với rule này, kỳ vọng:

| Metric | Expected |
|---|---|
| Signals/day | 0-5 (avg 1-2) trên watchlist 30 coin |
| % SKIP recommendations | 60-80% (most coins, most days) |
| Win rate (hit TP1) | 45-55% |
| Avg R:R achieved | 1.8-2.5 |
| False breakout filter | ~60% giảm so với không có volume rule |

**Quan trọng:** Nếu thấy quá nhiều signal/day (>5), prompt quá lỏng. Nếu 0 signal trong 2 tuần liền, prompt quá chặt.

---

## Cost Estimate

Với 30 coin, system prompt cached:
- ~3,000 tokens output x 30 coin = 90K output tokens/day
- ~5,000 tokens input x 30 coin = 150K input tokens/day (cached)
- Cost: ~$1-2/day với Claude Sonnet
- Cost: ~$30-60/month

---

## Tuning Guide

### Nếu quá nhiều false breakout:
- Tăng volume threshold từ 1.5x lên 1.8x
- Yêu cầu 2 nến đóng confirm thay vì 1
- Tăng min R:R từ 2.0 lên 2.5

### Nếu quá ít signal:
- Giảm min pattern duration xuống 10-12 candles
- Giảm min R:R xuống 1.8
- Cho phép signal chỉ dựa trên S/R bounce (không cần pattern)

### Nếu confidence calibration sai:
- Update rubric trong system prompt
- Thêm examples vào prompt (high/low confidence cases)

### Nếu AI hay hallucinate pattern:
- Strict hơn trong pattern definition
- Yêu cầu AI cite specific candles làm evidence
