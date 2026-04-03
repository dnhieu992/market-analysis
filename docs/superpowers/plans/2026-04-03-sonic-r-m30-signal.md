# Sonic R M30 Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On worker startup, fetch 100 M30 candles for BTCUSDT, compute the Sonic R Dragon (EMA34 High/Low) and ATR(14), derive a BUY/SELL/NEUTRAL signal with SL and target, and send it to Telegram.

**Architecture:** A new `SonicRSignalService` in the analysis module handles signal calculation using existing `calculateEma` and `calculateAtr` from `@app/core`. A pure `formatSonicRMessage` function formats the output. `main.ts` calls the service on startup and sends via `TelegramService`.

**Tech Stack:** NestJS (worker app), TypeScript, `@app/core` indicator utilities, Binance public REST API

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `packages/config/src/types.ts` | Add `'M30'` to `AnalysisTimeframe` |
| Modify | `packages/core/src/constants/timeframes.ts` | Add `'M30'` to `SUPPORTED_TIMEFRAMES` |
| Modify | `apps/worker/src/modules/market/utils/candle-timing.ts` | Add `M30` entry to `TIMEFRAME_TO_MS` |
| Create | `apps/worker/src/modules/analysis/sonic-r-signal.service.ts` | Signal calculation logic |
| Create | `apps/worker/src/modules/analysis/sonic-r-signal.formatter.ts` | Pure message formatter |
| Create | `apps/worker/test/sonic-r-signal.service.spec.ts` | Unit tests for signal logic |
| Create | `apps/worker/test/sonic-r-signal.formatter.spec.ts` | Unit tests for formatter |
| Modify | `apps/worker/src/modules/analysis/analysis.module.ts` | Provide/export `SonicRSignalService` |
| Modify | `apps/worker/src/main.ts` | Call signal service and send on startup |

---

## Task 1: Add M30 to timeframe types and constants

**Files:**
- Modify: `packages/config/src/types.ts`
- Modify: `packages/core/src/constants/timeframes.ts`
- Modify: `apps/worker/src/modules/market/utils/candle-timing.ts`

- [ ] **Step 1: Update `AnalysisTimeframe` in config**

In `packages/config/src/types.ts`, change line 3:
```ts
export type AnalysisTimeframe = '4h' | 'M30';
```

- [ ] **Step 2: Update `SUPPORTED_TIMEFRAMES` in core**

In `packages/core/src/constants/timeframes.ts`:
```ts
export const SUPPORTED_TIMEFRAMES = ['4h', 'M30'] as const;
```

- [ ] **Step 3: Update `TIMEFRAME_TO_MS` in candle-timing**

In `apps/worker/src/modules/market/utils/candle-timing.ts`, change the record:
```ts
const TIMEFRAME_TO_MS: Record<AnalysisTimeframe, number> = {
  '4h': 4 * 60 * 60 * 1000,
  'M30': 30 * 60 * 1000
};
```

- [ ] **Step 4: Verify typecheck passes**

```bash
pnpm --filter worker typecheck
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/types.ts packages/core/src/constants/timeframes.ts apps/worker/src/modules/market/utils/candle-timing.ts
git commit -m "feat: add M30 to AnalysisTimeframe and timeframe constants"
```

---

## Task 2: Create SonicRSignalService with tests (TDD)

**Files:**
- Create: `apps/worker/test/sonic-r-signal.service.spec.ts`
- Create: `apps/worker/src/modules/analysis/sonic-r-signal.service.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/test/sonic-r-signal.service.spec.ts`:
```ts
import type { Candle } from '@app/core';

import { SonicRSignalService } from '../src/modules/analysis/sonic-r-signal.service';

// Build 100 candles with controllable close/high/low values
function makeCandles(count: number, base: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    open: base + i,
    high: base + i + 100,
    low: base + i - 100,
    close: base + i,
    openTime: new Date(Date.UTC(2026, 0, 1, i * 0.5)),
    closeTime: new Date(Date.UTC(2026, 0, 1, i * 0.5 + 0.4))
  }));
}

describe('SonicRSignalService', () => {
  it('returns BUY when close is above dragonHigh', async () => {
    // candles trending up: last close far above EMAs
    const candles = makeCandles(100, 80000);
    // override last candle to have a close well above all highs
    candles[99] = { ...candles[99], close: 200000, high: 200100, low: 199900 };

    const marketDataService = {
      getCandles: jest.fn().mockResolvedValue(candles)
    };
    const service = new SonicRSignalService(marketDataService as never);

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('BUY');
    expect(signal.symbol).toBe('BTCUSDT');
    expect(signal.timeframe).toBe('M30');
    expect(signal.stopLoss).toBeDefined();
    expect(signal.target).toBeDefined();
    expect(signal.stopLoss!).toBeLessThan(signal.close);
    expect(signal.target!).toBeGreaterThan(signal.close);
  });

  it('returns SELL when close is below dragonLow', async () => {
    const candles = makeCandles(100, 80000);
    // override last candle to have a close well below all lows
    candles[99] = { ...candles[99], close: 1000, high: 1100, low: 900 };

    const marketDataService = {
      getCandles: jest.fn().mockResolvedValue(candles)
    };
    const service = new SonicRSignalService(marketDataService as never);

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('SELL');
    expect(signal.stopLoss!).toBeGreaterThan(signal.close);
    expect(signal.target!).toBeLessThan(signal.close);
  });

  it('returns NEUTRAL when close is inside the Dragon', async () => {
    // uniform candles: EMAs will equal the values, close equals high of candle = inside
    const candles = makeCandles(100, 80000);

    const marketDataService = {
      getCandles: jest.fn().mockResolvedValue(candles)
    };
    const service = new SonicRSignalService(marketDataService as never);

    const signal = await service.getSignal('BTCUSDT');

    expect(signal.direction).toBe('NEUTRAL');
    expect(signal.stopLoss).toBeUndefined();
    expect(signal.target).toBeUndefined();
  });

  it('fetches M30 candles with limit 100', async () => {
    const candles = makeCandles(100, 80000);
    const getCandles = jest.fn().mockResolvedValue(candles);
    const service = new SonicRSignalService({ getCandles } as never);

    await service.getSignal('BTCUSDT');

    expect(getCandles).toHaveBeenCalledWith('BTCUSDT', 'M30', 100);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm --filter worker test -- --testPathPatterns sonic-r-signal.service
```
Expected: FAIL — `Cannot find module '../src/modules/analysis/sonic-r-signal.service'`

- [ ] **Step 3: Implement SonicRSignalService**

Create `apps/worker/src/modules/analysis/sonic-r-signal.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { calculateAtr, calculateEma } from '@app/core';

import { MarketDataService } from '../market/market-data.service';

export type SonicRSignal = {
  symbol: string;
  timeframe: 'M30';
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  close: number;
  dragonHigh: number;
  dragonLow: number;
  atr: number;
  stopLoss?: number;
  target?: number;
};

@Injectable()
export class SonicRSignalService {
  constructor(private readonly marketDataService: MarketDataService) {}

  async getSignal(symbol: string): Promise<SonicRSignal> {
    const candles = await this.marketDataService.getCandles(symbol, 'M30', 100);

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    const dragonHigh = calculateEma(highs, 34);
    const dragonLow = calculateEma(lows, 34);
    const atr = calculateAtr(highs, lows, closes, 14);

    const close = closes[closes.length - 1] ?? 0;

    let direction: 'BUY' | 'SELL' | 'NEUTRAL';
    let stopLoss: number | undefined;
    let target: number | undefined;

    if (close > dragonHigh) {
      direction = 'BUY';
      stopLoss = Number((close - atr).toFixed(2));
      target = Number((close + 2 * atr).toFixed(2));
    } else if (close < dragonLow) {
      direction = 'SELL';
      stopLoss = Number((close + atr).toFixed(2));
      target = Number((close - 2 * atr).toFixed(2));
    } else {
      direction = 'NEUTRAL';
    }

    return { symbol, timeframe: 'M30', direction, close, dragonHigh, dragonLow, atr, stopLoss, target };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter worker test -- --testPathPatterns sonic-r-signal.service
```
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/worker/test/sonic-r-signal.service.spec.ts apps/worker/src/modules/analysis/sonic-r-signal.service.ts
git commit -m "feat: add SonicRSignalService with EMA34 Dragon and ATR-based SL/target"
```

---

## Task 3: Create message formatter with tests (TDD)

**Files:**
- Create: `apps/worker/test/sonic-r-signal.formatter.spec.ts`
- Create: `apps/worker/src/modules/analysis/sonic-r-signal.formatter.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/test/sonic-r-signal.formatter.spec.ts`:
```ts
import { formatSonicRMessage } from '../src/modules/analysis/sonic-r-signal.formatter';
import type { SonicRSignal } from '../src/modules/analysis/sonic-r-signal.service';

describe('formatSonicRMessage', () => {
  it('formats a BUY signal with SL and target', () => {
    const signal: SonicRSignal = {
      symbol: 'BTCUSDT',
      timeframe: 'M30',
      direction: 'BUY',
      close: 83450,
      dragonHigh: 83100,
      dragonLow: 82800,
      atr: 350,
      stopLoss: 83100,
      target: 84150
    };

    const message = formatSonicRMessage(signal);

    expect(message).toContain('[BTCUSDT M30]');
    expect(message).toContain('BUY');
    expect(message).toContain('83,450.00');
    expect(message).toContain('83,100.00');
    expect(message).toContain('82,800.00');
    expect(message).toContain('350.00');
    expect(message).toContain('84,150.00');
  });

  it('formats a SELL signal with SL and target', () => {
    const signal: SonicRSignal = {
      symbol: 'ETHUSDT',
      timeframe: 'M30',
      direction: 'SELL',
      close: 3000,
      dragonHigh: 3200,
      dragonLow: 3100,
      atr: 80,
      stopLoss: 3080,
      target: 2840
    };

    const message = formatSonicRMessage(signal);

    expect(message).toContain('[ETHUSDT M30]');
    expect(message).toContain('SELL');
    expect(message).toContain('3,000.00');
    expect(message).toContain('3,080.00');
    expect(message).toContain('2,840.00');
  });

  it('formats a NEUTRAL signal without SL or target', () => {
    const signal: SonicRSignal = {
      symbol: 'BTCUSDT',
      timeframe: 'M30',
      direction: 'NEUTRAL',
      close: 83200,
      dragonHigh: 83280,
      dragonLow: 83100,
      atr: 200
    };

    const message = formatSonicRMessage(signal);

    expect(message).toContain('[BTCUSDT M30]');
    expect(message).toContain('NEUTRAL');
    expect(message).toContain('inside the Dragon');
    expect(message).not.toContain('SL:');
    expect(message).not.toContain('Target:');
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm --filter worker test -- --testPathPatterns sonic-r-signal.formatter
```
Expected: FAIL — `Cannot find module '../src/modules/analysis/sonic-r-signal.formatter'`

- [ ] **Step 3: Implement formatSonicRMessage**

Create `apps/worker/src/modules/analysis/sonic-r-signal.formatter.ts`:
```ts
import type { SonicRSignal } from './sonic-r-signal.service';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatSonicRMessage(signal: SonicRSignal): string {
  const header = `[${signal.symbol} ${signal.timeframe}]`;
  const dragon = `Dragon: ${fmt(signal.dragonLow)} – ${fmt(signal.dragonHigh)}`;

  if (signal.direction === 'NEUTRAL') {
    return [
      `${header} ⚪ NEUTRAL`,
      `Close:  ${fmt(signal.close)} USDT`,
      dragon,
      `Price is inside the Dragon`
    ].join('\n');
  }

  const icon = signal.direction === 'BUY' ? '🟢' : '🔴';

  return [
    `${header} ${icon} ${signal.direction} Signal`,
    `Close:  ${fmt(signal.close)} USDT`,
    dragon,
    `ATR:    ${fmt(signal.atr)}`,
    `SL:     ${fmt(signal.stopLoss!)} USDT`,
    `Target: ${fmt(signal.target!)} USDT`
  ].join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter worker test -- --testPathPatterns sonic-r-signal.formatter
```
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add apps/worker/test/sonic-r-signal.formatter.spec.ts apps/worker/src/modules/analysis/sonic-r-signal.formatter.ts
git commit -m "feat: add Sonic R message formatter"
```

---

## Task 4: Register service in AnalysisModule and wire main.ts

**Files:**
- Modify: `apps/worker/src/modules/analysis/analysis.module.ts`
- Modify: `apps/worker/src/main.ts`

- [ ] **Step 1: Add SonicRSignalService to AnalysisModule**

In `apps/worker/src/modules/analysis/analysis.module.ts`:
```ts
import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AnalysisOrchestratorService } from './analysis-orchestrator.service';
import { SonicRSignalService } from './sonic-r-signal.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [AnalysisOrchestratorService, SonicRSignalService],
  exports: [AnalysisOrchestratorService, SonicRSignalService]
})
export class AnalysisModule {}
```

- [ ] **Step 2: Update main.ts to call signal service on startup**

In `apps/worker/src/main.ts`:
```ts
import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

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
  const signal = await sonicR.getSignal('BTCUSDT');
  await telegram.sendAnalysisMessage({
    content: formatSonicRMessage(signal),
    messageType: 'sonic-r-signal'
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
git commit -m "feat: wire SonicRSignalService into AnalysisModule and send signal on startup"
```

---

## Task 5: Start and verify end-to-end

- [ ] **Step 1: Start the worker**

```bash
pnpm --filter worker start:dev
```

- [ ] **Step 2: Verify output**

Expected logs:
```
[dotenv] injecting env (2) from .env
[NestFactory] Starting Nest application...
[SchedulerService] Worker scheduler registered
[Bootstrap] Worker started
```
No `WARN [TelegramService] Telegram delivery failed` lines.

- [ ] **Step 3: Check Telegram**

You should receive two messages:
1. `BTC current price: XX,XXX.XX USDT`
2. One of:
   - `[BTCUSDT M30] 🟢 BUY Signal ...`
   - `[BTCUSDT M30] 🔴 SELL Signal ...`
   - `[BTCUSDT M30] ⚪ NEUTRAL ...`
