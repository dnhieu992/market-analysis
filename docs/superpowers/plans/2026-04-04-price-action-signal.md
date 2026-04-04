# Price Action Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a price action signal to Telegram on startup alongside Sonic R, checking 4h trend structure, M30 key levels, candlestick patterns, and BOS+retest — all four must align for a BUY/SELL signal, otherwise a "no signal" analysis is sent.

**Architecture:** A new `PriceActionSignalService` fetches 4h candles (trend bias) and M30 candles (key level, pattern, BOS), runs all four checks, and returns a `PriceActionSignal`. A pure `formatPriceActionMessage` function formats the Telegram output. Both are registered in `AnalysisModule` and called from `main.ts`.

**Tech Stack:** NestJS (worker app), TypeScript, `@app/core` (`calculateAtr`), Binance public REST API

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `apps/worker/src/modules/analysis/price-action-signal.service.ts` | Signal calculation: 4 checks, result type |
| Create | `apps/worker/src/modules/analysis/price-action-signal.formatter.ts` | Pure message formatter |
| Create | `apps/worker/test/price-action-signal.service.spec.ts` | Unit tests for signal logic |
| Create | `apps/worker/test/price-action-signal.formatter.spec.ts` | Unit tests for formatter |
| Modify | `apps/worker/src/modules/analysis/analysis.module.ts` | Add `PriceActionSignalService` to providers/exports |
| Modify | `apps/worker/src/main.ts` | Call service on startup, send message |

---

## Task 1: Create PriceActionSignalService with tests (TDD)

**Files:**
- Create: `apps/worker/test/price-action-signal.service.spec.ts`
- Create: `apps/worker/src/modules/analysis/price-action-signal.service.ts`

### Helper knowledge

The service needs these internal helpers (all pure logic, defined inside the service file):

- `detectTrend(candles: Candle[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL'` — finds swing highs/lows, compares last 2 of each
- `findActiveKeyLevel(candles: Candle[], close: number, atr: number, trend: 'BULLISH' | 'BEARISH'): number | null` — scans last 50 candles for swing high/low within 1×ATR of close
- `detectPattern(candles: Candle[]): { name: string; direction: 'bullish' | 'bearish' } | null` — checks last 2 candles for pin bar or engulfing
- `detectBos(candles: Candle[], atr: number, trend: 'BULLISH' | 'BEARISH'): number | null` — checks last 5 candles for BOS + retest within 0.5×ATR

**Swing point detection (used by trend + key level + BOS):**
A swing high at index `i` means `candles[i].high > candles[i-1].high && candles[i].high > candles[i+1].high`.
A swing low at index `i` means `candles[i].low < candles[i-1].low && candles[i].low < candles[i+1].low`.

**Pin bar detection:**
```
bodySize = Math.abs(close - open)
range = high - low
lowerWick = Math.min(open, close) - low
upperWick = high - Math.max(open, close)
bullish pin bar: lowerWick >= 2 * bodySize && Math.min(open, close) >= low + 0.7 * range
bearish pin bar: upperWick >= 2 * bodySize && Math.max(open, close) <= low + 0.3 * range
```

**Engulfing detection (last 2 candles, index -1 = current, index -2 = previous):**
```
bullish: current.close > current.open && prev.close < prev.open
         && current.open <= prev.close && current.close >= prev.open
bearish: current.close < current.open && prev.close > prev.open
         && current.open >= prev.close && current.close <= prev.open
```

---

- [ ] **Step 1: Write failing tests**

Create `apps/worker/test/price-action-signal.service.spec.ts`:

```ts
import type { Candle } from '@app/core';

import { PriceActionSignalService } from '../src/modules/analysis/price-action-signal.service';

// Build candles with alternating swing highs/lows to produce a BULLISH trend
// Each pair: a swing low followed by a higher swing high
function makeBullishCandles(count: number, base: number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const trend = i * 10;
    return {
      open: base + trend,
      high: base + trend + (i % 3 === 1 ? 200 : 50),
      low: base + trend - (i % 3 === 0 ? 200 : 20),
      close: base + trend + 5,
      openTime: new Date(Date.UTC(2026, 0, 1, i)),
      closeTime: new Date(Date.UTC(2026, 0, 1, i, 0, 59))
    };
  });
}

function makeBearishCandles(count: number, base: number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const trend = i * 10;
    return {
      open: base - trend,
      high: base - trend + (i % 3 === 0 ? 20 : 50),
      low: base - trend - (i % 3 === 1 ? 200 : 50),
      close: base - trend - 5,
      openTime: new Date(Date.UTC(2026, 0, 1, i)),
      closeTime: new Date(Date.UTC(2026, 0, 1, i, 0, 59))
    };
  });
}

function makeNeutralCandles(count: number, base: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    open: base,
    high: base + 100,
    low: base - 100,
    close: base,
    openTime: new Date(Date.UTC(2026, 0, 1, i)),
    closeTime: new Date(Date.UTC(2026, 0, 1, i, 0, 59))
  }));
}

describe('PriceActionSignalService', () => {
  function makeService(h4Candles: Candle[], m30Candles: Candle[]) {
    let callCount = 0;
    const getCandles = jest.fn().mockImplementation(() => {
      callCount += 1;
      return Promise.resolve(callCount === 1 ? h4Candles : m30Candles);
    });
    return new PriceActionSignalService({ getCandles } as never);
  }

  it('fetches 4h candles with limit 20 and M30 candles with limit 100', async () => {
    const getCandles = jest.fn().mockResolvedValue(makeNeutralCandles(20, 80000));
    const service = new PriceActionSignalService({ getCandles } as never);

    await service.getSignal('BTCUSDT');

    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', '4h', 20);
    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', 'M30', 100);
  });

  it('returns NO_SIGNAL when trend is NEUTRAL', async () => {
    const service = makeService(
      makeNeutralCandles(20, 80000),
      makeNeutralCandles(100, 80000)
    );

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('NO_SIGNAL');
    expect(signal.trend).toBe('NEUTRAL');
    expect(signal.stopLoss).toBeUndefined();
    expect(signal.target).toBeUndefined();
  });

  it('returns NO_SIGNAL when trend is bullish but no key level active', async () => {
    // M30 close is far from any swing level (ATR won't bridge the gap)
    const m30 = makeNeutralCandles(100, 80000);
    // push close far from swing points
    m30[99] = { ...m30[99]!, close: 90000, open: 89900, high: 90100, low: 89800 };

    const service = makeService(makeBullishCandles(20, 80000), m30);
    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('NO_SIGNAL');
    expect(signal.keyLevel).toBeNull();
  });

  it('has correct symbol and timeframe on all results', async () => {
    const service = makeService(
      makeNeutralCandles(20, 80000),
      makeNeutralCandles(100, 80000)
    );

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.symbol).toBe('BTCUSDT');
    expect(signal.timeframe).toBe('M30');
  });

  it('returns NO_SIGNAL with trend populated when trend is BEARISH but no confluence', async () => {
    const service = makeService(
      makeBearishCandles(20, 80000),
      makeNeutralCandles(100, 80000)
    );

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('NO_SIGNAL');
    expect(signal.trend).toBe('BEARISH');
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm --filter worker test -- --testPathPatterns price-action-signal.service
```
Expected: FAIL — `Cannot find module '../src/modules/analysis/price-action-signal.service'`

- [ ] **Step 3: Implement PriceActionSignalService**

Create `apps/worker/src/modules/analysis/price-action-signal.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { calculateAtr } from '@app/core';
import type { Candle } from '@app/core';

import { MarketDataService } from '../market/market-data.service';

export type PriceActionSignal = {
  symbol: string;
  timeframe: 'M30';
  direction: 'BUY' | 'SELL' | 'NO_SIGNAL';
  close: number;
  atr: number;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  keyLevel: number | null;
  pattern: string | null;
  bosLevel: number | null;
  stopLoss?: number;
  target?: number;
};

function detectTrend(candles: Candle[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1]!;
    const curr = candles[i]!;
    const next = candles[i + 1]!;

    if (curr.high > prev.high && curr.high > next.high) swingHighs.push(curr.high);
    if (curr.low < prev.low && curr.low < next.low) swingLows.push(curr.low);
  }

  if (swingHighs.length < 2 || swingLows.length < 2) return 'NEUTRAL';

  const lastTwoHighs = swingHighs.slice(-2) as [number, number];
  const lastTwoLows = swingLows.slice(-2) as [number, number];

  const hhhl = lastTwoHighs[1] > lastTwoHighs[0] && lastTwoLows[1] > lastTwoLows[0];
  const lhll = lastTwoHighs[1] < lastTwoHighs[0] && lastTwoLows[1] < lastTwoLows[0];

  if (hhhl) return 'BULLISH';
  if (lhll) return 'BEARISH';
  return 'NEUTRAL';
}

function findActiveKeyLevel(
  candles: Candle[],
  close: number,
  atr: number,
  trend: 'BULLISH' | 'BEARISH'
): number | null {
  const slice = candles.slice(-50);
  const swingPoints: number[] = [];

  for (let i = 1; i < slice.length - 1; i++) {
    const prev = slice[i - 1]!;
    const curr = slice[i]!;
    const next = slice[i + 1]!;

    if (trend === 'BULLISH' && curr.low < prev.low && curr.low < next.low) {
      swingPoints.push(curr.low);
    }
    if (trend === 'BEARISH' && curr.high > prev.high && curr.high > next.high) {
      swingPoints.push(curr.high);
    }
  }

  // Find most recent swing point within 1×ATR
  for (let i = swingPoints.length - 1; i >= 0; i--) {
    const level = swingPoints[i]!;
    if (Math.abs(close - level) <= atr) return level;
  }

  return null;
}

function detectPattern(
  candles: Candle[]
): { name: string; direction: 'bullish' | 'bearish' } | null {
  if (candles.length < 2) return null;

  const curr = candles[candles.length - 1]!;
  const prev = candles[candles.length - 2]!;

  const bodySize = Math.abs(curr.close - curr.open);
  const range = curr.high - curr.low;
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  const upperWick = curr.high - Math.max(curr.open, curr.close);

  if (range > 0 && bodySize > 0) {
    // Bullish pin bar
    if (
      lowerWick >= 2 * bodySize &&
      Math.min(curr.open, curr.close) >= curr.low + 0.7 * range
    ) {
      return { name: 'Pin Bar', direction: 'bullish' };
    }
    // Bearish pin bar
    if (
      upperWick >= 2 * bodySize &&
      Math.max(curr.open, curr.close) <= curr.low + 0.3 * range
    ) {
      return { name: 'Pin Bar', direction: 'bearish' };
    }
  }

  // Bullish engulfing
  if (
    curr.close > curr.open &&
    prev.close < prev.open &&
    curr.open <= prev.close &&
    curr.close >= prev.open
  ) {
    return { name: 'Engulfing', direction: 'bullish' };
  }

  // Bearish engulfing
  if (
    curr.close < curr.open &&
    prev.close > prev.open &&
    curr.open >= prev.close &&
    curr.close <= prev.open
  ) {
    return { name: 'Engulfing', direction: 'bearish' };
  }

  return null;
}

function detectBos(
  candles: Candle[],
  atr: number,
  trend: 'BULLISH' | 'BEARISH'
): number | null {
  if (candles.length < 10) return null;

  // Find the last swing point before the last 5 candles
  const lookback = candles.slice(0, -5);
  const recent = candles.slice(-5);
  const close = candles[candles.length - 1]!.close;

  let bosLevel: number | null = null;

  if (trend === 'BULLISH') {
    // Find most recent swing high in lookback
    for (let i = lookback.length - 2; i >= 1; i--) {
      const prev = lookback[i - 1]!;
      const curr = lookback[i]!;
      const next = lookback[i + 1]!;
      if (curr.high > prev.high && curr.high > next.high) {
        bosLevel = curr.high;
        break;
      }
    }
    if (!bosLevel) return null;

    // Check if any recent candle broke above that level
    const broken = recent.some((c) => c.high > bosLevel!);
    if (!broken) return null;

    // Check retest: close pulled back within 0.5×ATR of broken level
    if (Math.abs(close - bosLevel) <= 0.5 * atr) return bosLevel;
  }

  if (trend === 'BEARISH') {
    // Find most recent swing low in lookback
    for (let i = lookback.length - 2; i >= 1; i--) {
      const prev = lookback[i - 1]!;
      const curr = lookback[i]!;
      const next = lookback[i + 1]!;
      if (curr.low < prev.low && curr.low < next.low) {
        bosLevel = curr.low;
        break;
      }
    }
    if (!bosLevel) return null;

    const broken = recent.some((c) => c.low < bosLevel!);
    if (!broken) return null;

    if (Math.abs(close - bosLevel) <= 0.5 * atr) return bosLevel;
  }

  return null;
}

@Injectable()
export class PriceActionSignalService {
  constructor(private readonly marketDataService: MarketDataService) {}

  async getSignal(symbol: string): Promise<PriceActionSignal> {
    const h4Candles = await this.marketDataService.getCandles(symbol, '4h', 20);
    const m30Candles = await this.marketDataService.getCandles(symbol, 'M30', 100);

    const highs = m30Candles.map((c) => c.high);
    const lows = m30Candles.map((c) => c.low);
    const closes = m30Candles.map((c) => c.close);
    const close = closes[closes.length - 1] ?? 0;
    const atr = calculateAtr(highs, lows, closes, 14);

    const trend = detectTrend(h4Candles);

    if (trend === 'NEUTRAL') {
      return {
        symbol, timeframe: 'M30', direction: 'NO_SIGNAL',
        close, atr, trend, keyLevel: null, pattern: null, bosLevel: null
      };
    }

    const keyLevel = findActiveKeyLevel(m30Candles, close, atr, trend);
    const patternResult = detectPattern(m30Candles);
    const patternMatch =
      patternResult &&
      ((trend === 'BULLISH' && patternResult.direction === 'bullish') ||
        (trend === 'BEARISH' && patternResult.direction === 'bearish'));
    const pattern = patternMatch ? patternResult.name : null;
    const bosLevel = detectBos(m30Candles, atr, trend);

    const allAligned = keyLevel !== null && pattern !== null && bosLevel !== null;

    if (!allAligned) {
      return {
        symbol, timeframe: 'M30', direction: 'NO_SIGNAL',
        close, atr, trend, keyLevel, pattern, bosLevel
      };
    }

    const direction = trend === 'BULLISH' ? 'BUY' : 'SELL';
    const stopLoss = Number(keyLevel.toFixed(2));
    const target =
      direction === 'BUY'
        ? Number((close + 2 * atr).toFixed(2))
        : Number((close - 2 * atr).toFixed(2));

    return {
      symbol, timeframe: 'M30', direction,
      close, atr, trend, keyLevel, pattern, bosLevel,
      stopLoss, target
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter worker test -- --testPathPatterns price-action-signal.service
```
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add apps/worker/test/price-action-signal.service.spec.ts apps/worker/src/modules/analysis/price-action-signal.service.ts
git commit -m "feat: add PriceActionSignalService with 4-check PA logic"
```

---

## Task 2: Create message formatter with tests (TDD)

**Files:**
- Create: `apps/worker/test/price-action-signal.formatter.spec.ts`
- Create: `apps/worker/src/modules/analysis/price-action-signal.formatter.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/test/price-action-signal.formatter.spec.ts`:

```ts
import { formatPriceActionMessage } from '../src/modules/analysis/price-action-signal.formatter';
import type { PriceActionSignal } from '../src/modules/analysis/price-action-signal.service';

describe('formatPriceActionMessage', () => {
  it('formats a BUY signal with all four checks', () => {
    const signal: PriceActionSignal = {
      symbol: 'BTCUSDT',
      timeframe: 'M30',
      direction: 'BUY',
      close: 83450,
      atr: 350,
      trend: 'BULLISH',
      keyLevel: 82820,
      pattern: 'Engulfing',
      bosLevel: 83100,
      stopLoss: 82820,
      target: 84150
    };

    const msg = formatPriceActionMessage(signal);

    expect(msg).toContain('[BTCUSDT PA M30]');
    expect(msg).toContain('BUY Signal');
    expect(msg).toContain('83,450.00');
    expect(msg).toContain('82,820.00');
    expect(msg).toContain('84,150.00');
    expect(msg).toContain('✅ 4h trend: BULLISH');
    expect(msg).toContain('✅ Key level');
    expect(msg).toContain('✅ Pattern: Bullish Engulfing');
    expect(msg).toContain('✅ BOS retest');
    expect(msg).toContain('83,100.00');
  });

  it('formats a SELL signal', () => {
    const signal: PriceActionSignal = {
      symbol: 'ETHUSDT',
      timeframe: 'M30',
      direction: 'SELL',
      close: 3000,
      atr: 80,
      trend: 'BEARISH',
      keyLevel: 3200,
      pattern: 'Pin Bar',
      bosLevel: 3050,
      stopLoss: 3200,
      target: 2840
    };

    const msg = formatPriceActionMessage(signal);

    expect(msg).toContain('[ETHUSDT PA M30]');
    expect(msg).toContain('SELL Signal');
    expect(msg).toContain('✅ 4h trend: BEARISH');
    expect(msg).toContain('✅ Pattern: Bearish Pin Bar');
    expect(msg).toContain('3,200.00');
    expect(msg).toContain('2,840.00');
  });

  it('formats NO_SIGNAL with checkmarks and crosses', () => {
    const signal: PriceActionSignal = {
      symbol: 'BTCUSDT',
      timeframe: 'M30',
      direction: 'NO_SIGNAL',
      close: 83200,
      atr: 300,
      trend: 'BULLISH',
      keyLevel: 82900,
      pattern: null,
      bosLevel: null
    };

    const msg = formatPriceActionMessage(signal);

    expect(msg).toContain('[BTCUSDT PA M30]');
    expect(msg).toContain('No Signal');
    expect(msg).toContain('✅ 4h trend: BULLISH');
    expect(msg).toContain('✅ Key level');
    expect(msg).toContain('❌ Pattern: none detected');
    expect(msg).toContain('❌ BOS retest: no recent break');
    expect(msg).not.toContain('SL:');
    expect(msg).not.toContain('Target:');
  });

  it('formats NO_SIGNAL when trend is NEUTRAL', () => {
    const signal: PriceActionSignal = {
      symbol: 'BTCUSDT',
      timeframe: 'M30',
      direction: 'NO_SIGNAL',
      close: 83200,
      atr: 300,
      trend: 'NEUTRAL',
      keyLevel: null,
      pattern: null,
      bosLevel: null
    };

    const msg = formatPriceActionMessage(signal);

    expect(msg).toContain('No Signal');
    expect(msg).toContain('❌ 4h trend: NEUTRAL');
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm --filter worker test -- --testPathPatterns price-action-signal.formatter
```
Expected: FAIL — `Cannot find module '../src/modules/analysis/price-action-signal.formatter'`

- [ ] **Step 3: Implement formatPriceActionMessage**

Create `apps/worker/src/modules/analysis/price-action-signal.formatter.ts`:

```ts
import type { PriceActionSignal } from './price-action-signal.service';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function trendLabel(trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): string {
  if (trend === 'BULLISH') return 'BULLISH (HH+HL)';
  if (trend === 'BEARISH') return 'BEARISH (LH+LL)';
  return 'NEUTRAL';
}

function patternLabel(pattern: string | null, trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): string {
  if (!pattern) return '❌ Pattern: none detected';
  const side = trend === 'BULLISH' ? 'Bullish' : 'Bearish';
  return `✅ Pattern: ${side} ${pattern}`;
}

export function formatPriceActionMessage(signal: PriceActionSignal): string {
  const header = `[${signal.symbol} PA ${signal.timeframe}]`;
  const sep = '━━━━━━━━━━━━━━━━━━━';

  const trendCheck =
    signal.trend === 'NEUTRAL'
      ? `❌ 4h trend: NEUTRAL`
      : `✅ 4h trend: ${trendLabel(signal.trend)}`;

  const keyLevelCheck =
    signal.keyLevel !== null
      ? `✅ Key level: ${signal.trend === 'BULLISH' ? 'support' : 'resistance'} at ${fmt(signal.keyLevel)}`
      : `❌ Key level: none within range`;

  const patternCheck = patternLabel(signal.pattern, signal.trend);

  const bosCheck =
    signal.bosLevel !== null
      ? `✅ BOS retest: broke ${fmt(signal.bosLevel)}, retested`
      : `❌ BOS retest: no recent break`;

  if (signal.direction === 'NO_SIGNAL') {
    return [
      `${header} ⚪ No Signal`,
      sep,
      trendCheck,
      keyLevelCheck,
      patternCheck,
      bosCheck
    ].join('\n');
  }

  const icon = signal.direction === 'BUY' ? '🟢' : '🔴';

  return [
    `${header} ${icon} ${signal.direction} Signal`,
    sep,
    `Close:  ${fmt(signal.close)} USDT`,
    `SL:     ${fmt(signal.stopLoss!)} USDT  (key ${signal.trend === 'BULLISH' ? 'support' : 'resistance'})`,
    `Target: ${fmt(signal.target!)} USDT  (2×ATR)`,
    '',
    trendCheck,
    keyLevelCheck,
    patternCheck,
    bosCheck
  ].join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter worker test -- --testPathPatterns price-action-signal.formatter
```
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/worker/test/price-action-signal.formatter.spec.ts apps/worker/src/modules/analysis/price-action-signal.formatter.ts
git commit -m "feat: add price action message formatter"
```

---

## Task 3: Register in AnalysisModule and wire main.ts

**Files:**
- Modify: `apps/worker/src/modules/analysis/analysis.module.ts`
- Modify: `apps/worker/src/main.ts`

- [ ] **Step 1: Add PriceActionSignalService to AnalysisModule**

Replace the contents of `apps/worker/src/modules/analysis/analysis.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AnalysisOrchestratorService } from './analysis-orchestrator.service';
import { PriceActionSignalService } from './price-action-signal.service';
import { SonicRSignalService } from './sonic-r-signal.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [AnalysisOrchestratorService, SonicRSignalService, PriceActionSignalService],
  exports: [AnalysisOrchestratorService, SonicRSignalService, PriceActionSignalService]
})
export class AnalysisModule {}
```

- [ ] **Step 2: Update main.ts to call both signal services**

Replace the contents of `apps/worker/src/main.ts`:

```ts
import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { formatPriceActionMessage } from './modules/analysis/price-action-signal.formatter';
import { PriceActionSignalService } from './modules/analysis/price-action-signal.service';
import { formatSonicRMessage } from './modules/analysis/sonic-r-signal.formatter';
import { SonicRSignalService } from './modules/analysis/sonic-r-signal.service';
import { BinanceMarketDataService } from './modules/market/binance-market-data.service';
import { SchedulerService } from './modules/scheduler/scheduler.service';
import { TelegramService } from './modules/telegram/telegram.service';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const scheduler = app.get(SchedulerService);
  scheduler.register();

  const binance = app.get(BinanceMarketDataService);
  const price = await binance.fetchPrice('BTCUSDT');
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const telegram = app.get(TelegramService);
  await telegram.sendAnalysisMessage({ content: `BTC current price: ${fmt(price)} USDT`, messageType: 'test' });

  const sonicR = app.get(SonicRSignalService);
  const sonicRSignal = await sonicR.getSignal('BTCUSDT');
  await telegram.sendAnalysisMessage({
    content: formatSonicRMessage(sonicRSignal),
    messageType: 'sonic-r-signal'
  });

  const priceAction = app.get(PriceActionSignalService);
  const paSignal = await priceAction.getSignal('BTCUSDT');
  await telegram.sendAnalysisMessage({
    content: formatPriceActionMessage(paSignal),
    messageType: 'price-action-signal'
  });

  Logger.log('Worker started', 'Bootstrap');
}

void bootstrap();
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter worker typecheck
```
Expected: no errors

- [ ] **Step 4: Run all tests**

```bash
pnpm --filter worker test
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/modules/analysis/analysis.module.ts apps/worker/src/main.ts
git commit -m "feat: wire PriceActionSignalService into module and send signal on startup"
```

---

## Task 4: Start and verify end-to-end

- [ ] **Step 1: Start the worker**

```bash
pnpm --filter worker start:dev
```

- [ ] **Step 2: Verify clean startup logs**

Expected:
```
[NestFactory] Starting Nest application...
[SchedulerService] Worker scheduler registered
[Bootstrap] Worker started
```
No `WARN [TelegramService] Telegram delivery failed` lines.

- [ ] **Step 3: Check Telegram — three messages should arrive**

1. `BTC current price: XX,XXX.XX USDT`
2. Sonic R: `[BTCUSDT M30] 🟢/🔴/⚪ ...`
3. Price Action: `[BTCUSDT PA M30] 🟢/🔴/⚪ ...` with four ✅/❌ check lines
