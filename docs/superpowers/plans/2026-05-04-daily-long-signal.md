# Daily Long Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At 00:00 UTC daily, check each symbol in the user's "Daily Signal Watchlist" and send one Telegram message listing which coins can be longed today based on the M30 UT Bot uptrend filter.

**Architecture:** Add `dailySignalWatchlist` JSON field to the `User` model (same pattern as `symbolsTracking`). Extract the UT Bot indicator from `fomo-long.strategy.ts` into `@app/core` so both the backtest strategy and the new worker service share it. A new `DailySignalService` in the worker fetches M30 candles, runs the UT Bot check per symbol, and sends one summary Telegram message. The existing `sendDailySignals` cron at 00:00 UTC calls it.

**Tech Stack:** NestJS worker (cron), Prisma/MySQL, `@app/core` (UT Bot indicator), Binance public API (M30 candles via `MarketDataService`), Telegram Bot API.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/core/src/indicators/ut-bot.ts` | Wilder RMA ATR + UT Bot trailing stop + `isUtBotUptrend()` |
| Modify | `packages/core/src/index.ts` | Export `isUtBotUptrend` |
| Modify | `packages/db/prisma/schema.prisma` | Add `dailySignalWatchlist Json @default("[]")` to User |
| Create | `packages/db/prisma/migrations/20260504130000_add_daily_signal_watchlist/migration.sql` | SQL ALTER TABLE |
| Modify | `packages/db/src/repositories/user.repository.ts` | `findFirst()` now also returns `dailySignalWatchlist` (already via `Prisma.UserUpdateInput`) |
| Modify | `apps/api/src/modules/user/dto/update-profile.dto.ts` | Add `dailySignalWatchlist?: string[]` |
| Modify | `apps/api/src/modules/user/user.service.ts` | Include `dailySignalWatchlist` in `getProfile` + `updateProfile` |
| Modify | `apps/api/src/modules/back-test/strategies/fomo-long.strategy.ts` | Replace inline UT Bot with `isUtBotUptrend` from `@app/core` |
| Modify | `apps/web/src/shared/api/types.ts` | Add `dailySignalWatchlist: string[]` to `UserProfile` |
| Modify | `apps/web/src/shared/api/client.ts` | Pass `dailySignalWatchlist` in `updateUserProfile` |
| Modify | `apps/web/src/_pages/profile-page/profile-page.tsx` | Add Daily Signal Watchlist UI section |
| Create | `apps/worker/src/modules/daily-signal/daily-signal.service.ts` | Fetch M30, run UT Bot, send Telegram |
| Create | `apps/worker/src/modules/daily-signal/daily-signal.module.ts` | NestJS module |
| Modify | `apps/worker/src/modules/scheduler/scheduler.service.ts` | Inject `DailySignalService`, call in `sendDailySignals` |
| Modify | `apps/worker/src/modules/scheduler/scheduler.module.ts` | Import `DailySignalModule` |
| Create | `docs/features/daily-long-signal/daily-long-signal.md` | Feature doc |

---

## Task 1: Extract UT Bot indicator to `@app/core`

**Files:**
- Create: `packages/core/src/indicators/ut-bot.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `ut-bot.ts`**

```ts
// packages/core/src/indicators/ut-bot.ts
import type { Candle } from '../types/candle';

// Wilder's RMA-based ATR (same algorithm used by TradingView's UT Bot)
function calcRmaAtr(candles: Candle[], period: number): number[] {
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1]!;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
  });

  const atr: number[] = new Array(candles.length).fill(0);
  if (candles.length < period) return atr;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;

  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  }

  return atr;
}

function calcUtBotTrailingStop(candles: Candle[], period: number, multiplier: number): number[] {
  const atr = calcRmaAtr(candles, period);
  const stop: number[] = new Array(candles.length).fill(0);

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i]!.close;
    const nLoss = atr[i]! * multiplier;

    if (i === 0) {
      stop[i] = close - nLoss;
      continue;
    }

    const prevClose = candles[i - 1]!.close;
    const prevStop = stop[i - 1]!;

    if (close > prevStop && prevClose > prevStop) {
      stop[i] = Math.max(prevStop, close - nLoss);
    } else if (close < prevStop && prevClose < prevStop) {
      stop[i] = Math.min(prevStop, close + nLoss);
    } else if (close > prevStop) {
      stop[i] = close - nLoss;
    } else {
      stop[i] = close + nLoss;
    }
  }

  return stop;
}

/**
 * Returns true when the last candle's close is above the UT Bot trailing stop,
 * indicating an uptrend. Requires at least `period + 1` candles.
 */
export function isUtBotUptrend(
  candles: Candle[],
  period = 10,
  multiplier = 1
): boolean {
  if (candles.length < period + 1) return false;
  const stop = calcUtBotTrailingStop(candles, period, multiplier);
  const last = candles.length - 1;
  return candles[last]!.close > stop[last]!;
}
```

- [ ] **Step 2: Export from `packages/core/src/index.ts`**

Add this line after the `calculateVolumeRatio` export:
```ts
export { isUtBotUptrend } from './indicators/ut-bot';
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/indicators/ut-bot.ts packages/core/src/index.ts
git commit -m "feat(core): extract UT Bot uptrend indicator into @app/core"
```

---

## Task 2: Update `fomo-long.strategy.ts` to use shared UT Bot

**Files:**
- Modify: `apps/api/src/modules/back-test/strategies/fomo-long.strategy.ts`

- [ ] **Step 1: Replace inline implementation with import from `@app/core`**

Replace the entire file contents:

```ts
import { isUtBotUptrend } from '@app/core';
import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const DEFAULT_ENTRY_HOUR_UTC = 0;
const DEFAULT_EXIT_HOUR_UTC = 16;
const DEFAULT_TP_PCT = 0.01; // 1%
const DEFAULT_UT_BOT_PERIOD = 10;
const DEFAULT_UT_BOT_MULTIPLIER = 1;

export class FomoLongStrategy implements IBackTestStrategy {
  readonly name = 'fomo-long';
  readonly description =
    'Long at 00:00 UTC every day when M30 UT Bot is uptrend. TP = entry × (1 + tpPct). Force close at 16:00 UTC if TP not reached. No price-based stop loss.';
  readonly defaultTimeframe = '1h';
  readonly forcedTimeframe = '1h';
  readonly htfTimeframes = ['M30'];

  evaluate(ctx: StrategyContext): TradeSignal | null {
    const { current, params, htfCandles } = ctx;

    const entryHour   = typeof params.entryHourUtc    === 'number' ? params.entryHourUtc    : DEFAULT_ENTRY_HOUR_UTC;
    const exitHour    = typeof params.exitHourUtc     === 'number' ? params.exitHourUtc     : DEFAULT_EXIT_HOUR_UTC;
    const tpPct       = typeof params.tpPct           === 'number' ? params.tpPct           : DEFAULT_TP_PCT;
    const utBotPeriod = typeof params.utBotPeriod     === 'number' ? params.utBotPeriod     : DEFAULT_UT_BOT_PERIOD;
    const utBotMult   = typeof params.utBotMultiplier === 'number' ? params.utBotMultiplier : DEFAULT_UT_BOT_MULTIPLIER;

    if (!current.openTime) return null;
    if (current.openTime.getUTCHours() !== entryHour) return null;

    const m30Candles = (htfCandles['M30'] ?? []).filter(
      (c) => c.openTime != null && c.openTime <= current.openTime!
    );

    if (!isUtBotUptrend(m30Candles, utBotPeriod, utBotMult)) return null;

    const entry = current.close;
    const forceCloseTime = new Date(current.openTime);
    forceCloseTime.setUTCHours(exitHour, 0, 0, 0);

    return {
      direction: 'long',
      entryPrice: entry,
      stopLoss: entry - 999_999,
      takeProfit: entry * (1 + tpPct),
      forceCloseTime
    };
  }
}

export default FomoLongStrategy;
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/back-test/strategies/fomo-long.strategy.ts
git commit -m "refactor(backtest): fomo-long imports isUtBotUptrend from @app/core"
```

---

## Task 3: Schema — add `dailySignalWatchlist` to User

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260504130000_add_daily_signal_watchlist/migration.sql`

- [ ] **Step 1: Add field to `schema.prisma`**

In the `User` model, add after `symbolsTracking`:
```prisma
dailySignalWatchlist Json @default("[]")
```

The User model should look like:
```prisma
model User {
  id                   String         @id @default(cuid())
  email                String         @unique
  passwordHash         String
  name                 String
  symbolsTracking      Json           @default("[]")
  dailySignalWatchlist Json           @default("[]")
  createdAt            DateTime       @default(now())
  updatedAt            DateTime       @updatedAt
  sessions             Session[]
  portfolios           Portfolio[]
  conversations        Conversation[]
  @@map("users")
}
```

- [ ] **Step 2: Create migration file**

Create directory `packages/db/prisma/migrations/20260504130000_add_daily_signal_watchlist/` and file `migration.sql`:

```sql
-- AlterTable
ALTER TABLE `users` ADD COLUMN `dailySignalWatchlist` JSON NOT NULL DEFAULT ('[]');
```

- [ ] **Step 3: Regenerate Prisma client**

```bash
pnpm prisma:generate
```

Expected output: `✔ Generated Prisma Client`

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260504130000_add_daily_signal_watchlist/migration.sql
git commit -m "feat(db): add dailySignalWatchlist field to User model"
```

---

## Task 4: API — expose `dailySignalWatchlist` in user profile

**Files:**
- Modify: `apps/api/src/modules/user/dto/update-profile.dto.ts`
- Modify: `apps/api/src/modules/user/user.service.ts`

- [ ] **Step 1: Update `update-profile.dto.ts`**

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: ['BTCUSDT', 'ETHUSDT'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symbolsTracking?: string[];

  @ApiPropertyOptional({ example: ['BTCUSDT', 'SUIUSDT'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dailySignalWatchlist?: string[];
}
```

- [ ] **Step 2: Update `user.service.ts`**

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createUserRepository } from '@app/db';

import { USER_REPOSITORY } from '../database/database.providers';
import type { UpdateProfileDto } from './dto/update-profile.dto';

type UserRepository = ReturnType<typeof createUserRepository>;

@Injectable()
export class UserService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository
  ) {}

  async getProfile(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      symbolsTracking: Array.isArray(user.symbolsTracking) ? (user.symbolsTracking as string[]) : [],
      dailySignalWatchlist: Array.isArray(user.dailySignalWatchlist) ? (user.dailySignalWatchlist as string[]) : [],
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = dto.name.trim();
    if (dto.symbolsTracking !== undefined) data['symbolsTracking'] = dto.symbolsTracking;
    if (dto.dailySignalWatchlist !== undefined) data['dailySignalWatchlist'] = dto.dailySignalWatchlist;

    if (Object.keys(data).length > 0) {
      await this.userRepository.updateProfile(userId, data);
    }

    return this.getProfile(userId);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/user/dto/update-profile.dto.ts apps/api/src/modules/user/user.service.ts
git commit -m "feat(api): expose dailySignalWatchlist in user profile endpoints"
```

---

## Task 5: Web — types, client, profile page UI

**Files:**
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/client.ts`
- Modify: `apps/web/src/_pages/profile-page/profile-page.tsx`

- [ ] **Step 1: Add `dailySignalWatchlist` to `UserProfile` in `types.ts`**

Find the `UserProfile` type and add the field:
```ts
export type UserProfile = {
  id: string;
  email: string;
  name: string;
  symbolsTracking: string[];
  dailySignalWatchlist: string[];
};
```

- [ ] **Step 2: Update `updateUserProfile` in `client.ts`**

Find `updateUserProfile` and ensure it accepts `dailySignalWatchlist`:
```ts
async updateUserProfile(data: { name?: string; symbolsTracking?: string[]; dailySignalWatchlist?: string[] }): Promise<UserProfile> {
  // (body stays the same — just accepts the wider type now)
```

The body of the function does `JSON.stringify(data)` so no logic changes are needed — just the type signature.

- [ ] **Step 3: Add Daily Signal Watchlist section to `profile-page.tsx`**

Add `dailySignalWatchlist` state and a new UI section. Full updated file:

```tsx
'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { UserProfile } from '@web/shared/api/types';

const apiClient = createApiClient();

type ProfilePageProps = Readonly<{
  initial: UserProfile | null;
}>;

export function ProfilePage({ initial }: ProfilePageProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [symbols, setSymbols] = useState<string[]>(initial?.symbolsTracking ?? []);
  const [symbolInput, setSymbolInput] = useState('');
  const [dailySymbols, setDailySymbols] = useState<string[]>(initial?.dailySignalWatchlist ?? []);
  const [dailySymbolInput, setDailySymbolInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const initials = (initial?.name ?? '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  function handleAddSymbol() {
    const trimmed = symbolInput.trim().toUpperCase();
    if (!trimmed || symbols.includes(trimmed)) return;
    setSymbols([...symbols, trimmed]);
    setSymbolInput('');
  }

  function handleRemoveSymbol(index: number) {
    setSymbols(symbols.filter((_, i) => i !== index));
  }

  function handleAddDailySymbol() {
    const trimmed = dailySymbolInput.trim().toUpperCase();
    if (!trimmed || dailySymbols.includes(trimmed)) return;
    setDailySymbols([...dailySymbols, trimmed]);
    setDailySymbolInput('');
  }

  function handleRemoveDailySymbol(index: number) {
    setDailySymbols(dailySymbols.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setStatus('saving');
    try {
      await apiClient.updateUserProfile({ name, symbolsTracking: symbols, dailySignalWatchlist: dailySymbols });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <main className="dashboard-shell settings-shell">
      <section className="hero-card settings-hero">
        <div className="hero-copy">
          <p className="eyebrow">Account</p>
          <h1>Profile</h1>
          <p className="lead">Manage your account info and watchlists.</p>
        </div>
      </section>

      <section className="settings-card">
        <p className="settings-card-title">Account Info</p>

        <div className="settings-fields">
          <div className="profile-avatar">{initials}</div>

          <div className="settings-field">
            <label className="settings-label">Email</label>
            <p className="settings-value">{initial?.email ?? '—'}</p>
          </div>

          <div className="settings-field">
            <label htmlFor="profile-name" className="settings-label">Display Name</label>
            <input
              id="profile-name"
              className="settings-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <hr className="settings-divider" />

          <div className="settings-field">
            <label htmlFor="profile-symbol-input" className="settings-label">Swing Signal Watchlist</label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Worker will alert you on Telegram when RSI(14) H4 ≤ 30 for these symbols.
            </p>
            <div className="settings-symbol-list">
              {symbols.length === 0
                ? <span className="settings-symbol-list-empty">No symbols yet — add one below</span>
                : symbols.map((sym, i) => (
                    <span key={sym} className="settings-symbol-tag">
                      {sym}
                      <button
                        className="settings-symbol-remove"
                        onClick={() => handleRemoveSymbol(i)}
                        aria-label={`Remove ${sym}`}
                      >×</button>
                    </span>
                  ))
              }
            </div>
            <div className="settings-symbol-add">
              <input
                id="profile-symbol-input"
                className="settings-input"
                type="text"
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddSymbol(); }}
                placeholder="e.g. BTCUSDT"
              />
              <button className="btn btn--secondary" onClick={handleAddSymbol}>Add</button>
            </div>
          </div>

          <hr className="settings-divider" />

          <div className="settings-field">
            <label htmlFor="profile-daily-symbol-input" className="settings-label">Daily Signal Watchlist</label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              At 00:00 UTC, worker checks M30 UT Bot uptrend and sends a Telegram list of coins that can be longed today.
            </p>
            <div className="settings-symbol-list">
              {dailySymbols.length === 0
                ? <span className="settings-symbol-list-empty">No symbols yet — add one below</span>
                : dailySymbols.map((sym, i) => (
                    <span key={sym} className="settings-symbol-tag">
                      {sym}
                      <button
                        className="settings-symbol-remove"
                        onClick={() => handleRemoveDailySymbol(i)}
                        aria-label={`Remove ${sym}`}
                      >×</button>
                    </span>
                  ))
              }
            </div>
            <div className="settings-symbol-add">
              <input
                id="profile-daily-symbol-input"
                className="settings-input"
                type="text"
                value={dailySymbolInput}
                onChange={(e) => setDailySymbolInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddDailySymbol(); }}
                placeholder="e.g. BTCUSDT"
              />
              <button className="btn btn--secondary" onClick={handleAddDailySymbol}>Add</button>
            </div>
          </div>

          <hr className="settings-divider" />

          <div className="settings-actions">
            <button
              className="btn btn--primary"
              onClick={() => { void handleSave(); }}
              disabled={status === 'saving'}
            >
              {status === 'saving' ? 'Saving…' : 'Save profile'}
            </button>
            {status === 'saved' && <span className="settings-status settings-status--success">✓ Saved</span>}
            {status === 'error' && <span className="settings-status settings-status--error">Failed to save</span>}
          </div>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/shared/api/types.ts apps/web/src/shared/api/client.ts apps/web/src/_pages/profile-page/profile-page.tsx
git commit -m "feat(web): add Daily Signal Watchlist section to profile page"
```

---

## Task 6: Worker — `DailySignalService`

**Files:**
- Create: `apps/worker/src/modules/daily-signal/daily-signal.service.ts`
- Create: `apps/worker/src/modules/daily-signal/daily-signal.module.ts`

- [ ] **Step 1: Create `daily-signal.service.ts`**

```ts
// apps/worker/src/modules/daily-signal/daily-signal.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { isUtBotUptrend } from '@app/core';
import { createUserRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';

const M30_CANDLE_LIMIT = 60; // enough candles for UT Bot (period=10) with margin
const UT_BOT_PERIOD = 10;
const UT_BOT_MULTIPLIER = 1;

@Injectable()
export class DailySignalService {
  private readonly logger = new Logger(DailySignalService.name);
  private readonly userRepository = createUserRepository();

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly telegramService: TelegramService
  ) {}

  async checkAndSend(): Promise<void> {
    const user = await this.userRepository.findFirst();
    const symbols: string[] = Array.isArray(user?.dailySignalWatchlist)
      ? (user.dailySignalWatchlist as string[])
      : [];

    if (symbols.length === 0) {
      this.logger.log('DailySignal: dailySignalWatchlist is empty, skipping');
      return;
    }

    this.logger.log(`DailySignal: checking ${symbols.length} symbol(s): ${symbols.join(', ')}`);

    const longable: string[] = [];

    for (const symbol of symbols) {
      try {
        const candles = await this.marketDataService.getCandles(symbol, 'M30', M30_CANDLE_LIMIT);
        if (isUtBotUptrend(candles, UT_BOT_PERIOD, UT_BOT_MULTIPLIER)) {
          longable.push(symbol);
          this.logger.log(`DailySignal: ${symbol} — UT Bot uptrend ✓`);
        } else {
          this.logger.log(`DailySignal: ${symbol} — UT Bot downtrend, skip`);
        }
      } catch (error) {
        this.logger.error(
          `DailySignal failed for ${symbol}: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }

    const message = longable.length > 0
      ? `📈 Coins can long today (UT Bot M30 uptrend):\n${longable.join(', ')}`
      : `📊 Daily Long Signal — No coins qualify today.\n\nChecked: ${symbols.join(', ')}\nNone are in UT Bot M30 uptrend.`;

    await this.telegramService.sendAnalysisMessage({
      content: message,
      messageType: 'daily-long-signal'
    });

    this.logger.log(`DailySignal: sent. Longable: [${longable.join(', ')}]`);
  }
}
```

- [ ] **Step 2: Create `daily-signal.module.ts`**

```ts
// apps/worker/src/modules/daily-signal/daily-signal.module.ts
import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { DailySignalService } from './daily-signal.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [DailySignalService],
  exports: [DailySignalService],
})
export class DailySignalModule {}
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/modules/daily-signal/
git commit -m "feat(worker): add DailySignalService — checks M30 UT Bot uptrend at 00:00 UTC"
```

---

## Task 7: Scheduler — wire `DailySignalService` into the 00:00 UTC cron

**Files:**
- Modify: `apps/worker/src/modules/scheduler/scheduler.service.ts`
- Modify: `apps/worker/src/modules/scheduler/scheduler.module.ts`

- [ ] **Step 1: Update `scheduler.service.ts`**

Add `DailySignalService` to the constructor and call it in `sendDailySignals`:

```ts
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { resolveTrackedSymbols } from '../../config/tracked-symbols';
import { AnalysisOrchestratorService } from '../analysis/analysis-orchestrator.service';
import { DailySignalService } from '../daily-signal/daily-signal.service';
import { SwingSignalService } from '../swing-signal/swing-signal.service';
import { TelegramService } from '../telegram/telegram.service';
import { VisualAnalysisService } from '../visual-analysis/visual-analysis.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly trackedSymbols: string[];

  constructor(
    private readonly analysisOrchestratorService: AnalysisOrchestratorService,
    private readonly visualAnalysisService: VisualAnalysisService,
    private readonly telegramService: TelegramService,
    private readonly swingSignalService: SwingSignalService,
    private readonly dailySignalService: DailySignalService,
    @Optional() config?: { trackedSymbols: string[] }
  ) {
    this.trackedSymbols = config?.trackedSymbols ?? resolveTrackedSymbols();
  }

  register() {
    this.logger.log('Worker scheduler registered');
  }

  runOnce(symbols = this.trackedSymbols) {
    return this.analysisOrchestratorService.runBatch(symbols);
  }

  // Runs every day at 00:00 UTC (07:00 local time UTC+7)
  @Cron('0 0 * * *', { timeZone: 'UTC' })
  async sendDailySignals() {
    this.logger.log('Running daily signal job');
    await this.runDailyAnalysisForSymbols(this.trackedSymbols);
    await this.dailySignalService.checkAndSend();
  }

  // Runs after every H4 candle close: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
  @Cron('0 0,4,8,12,16,20 * * *', { timeZone: 'UTC' })
  async checkSwingSignals() {
    this.logger.log('Running H4 swing signal check');
    await this.swingSignalService.checkAll();
  }

  async runDailyAnalysisForSymbols(symbols: string[]) {
    for (const symbol of symbols) {
      try {
        const { chartBuffer, analysisText } = await this.visualAnalysisService.analyze(symbol);

        const photoResult = await this.telegramService.sendPhoto(chartBuffer, `${symbol} H4`);
        this.logger.log(`sendPhoto result for ${symbol}: ${JSON.stringify(photoResult)}`);

        const msgResult = await this.telegramService.sendAnalysisMessage({
          content: analysisText,
          messageType: 'daily-plan'
        });
        this.logger.log(`sendAnalysisMessage result for ${symbol}: ${JSON.stringify(msgResult)}`);

        this.logger.log(`Daily analysis sent for ${symbol}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown error';
        const status = (error as { response?: { status?: number; data?: unknown } }).response?.status;
        const data = (error as { response?: { status?: number; data?: unknown } }).response?.data;
        this.logger.error(`Daily analysis failed for ${symbol}: ${msg}`);
        if (status !== undefined) this.logger.error(`HTTP ${status} — response: ${JSON.stringify(data)}`);
      }
    }
  }
}
```

- [ ] **Step 2: Update `scheduler.module.ts`**

Import `DailySignalModule`. Read the existing file first, then add the import:

```ts
// add to the imports array:
DailySignalModule,
// add to the import statements:
import { DailySignalModule } from '../daily-signal/daily-signal.module';
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/modules/scheduler/scheduler.service.ts apps/worker/src/modules/scheduler/scheduler.module.ts
git commit -m "feat(worker): call DailySignalService in 00:00 UTC cron"
```

---

## Task 8: Feature doc

**Files:**
- Create: `docs/features/daily-long-signal/daily-long-signal.md`

- [ ] **Step 1: Write doc**

```markdown
## Description
At 00:00 UTC every day, the worker checks each symbol in the user's "Daily Signal Watchlist" and sends one Telegram message listing which coins are in a UT Bot M30 uptrend — i.e. coins that can be longed today using the fomo-long strategy logic.

## Main Flow
1. `SchedulerService.sendDailySignals` cron fires at 00:00 UTC.
2. `DailySignalService.checkAndSend()` is called.
3. Reads `user.dailySignalWatchlist` via `userRepository.findFirst()`.
4. For each symbol: fetches last 60 M30 candles via `MarketDataService.getCandles(symbol, 'M30', 60)`.
5. Calls `isUtBotUptrend(candles, 10, 1)` from `@app/core`.
6. Collects symbols where result is `true`.
7. Sends one Telegram message:
   - If any qualify: `"📈 Coins can long today (UT Bot M30 uptrend): BTCUSDT, SUIUSDT"`
   - If none qualify: `"📊 Daily Long Signal — No coins qualify today."`

## Edge Cases
- `dailySignalWatchlist` is empty → service logs and returns, no Telegram message sent.
- Candle fetch fails for a symbol → logged as error, symbol skipped, others continue.
- Fewer than `period + 1` (11) M30 candles returned → `isUtBotUptrend` returns `false`, symbol skipped.

## Related Files (FE / BE / Worker)
- `packages/core/src/indicators/ut-bot.ts` — UT Bot indicator (Wilder RMA ATR + trailing stop + uptrend check)
- `packages/db/prisma/schema.prisma` — `User.dailySignalWatchlist` field
- `packages/db/prisma/migrations/20260504130000_add_daily_signal_watchlist/migration.sql` — DB migration
- `apps/api/src/modules/user/dto/update-profile.dto.ts` — `dailySignalWatchlist` in update DTO
- `apps/api/src/modules/user/user.service.ts` — reads/writes `dailySignalWatchlist`
- `apps/web/src/_pages/profile-page/profile-page.tsx` — Daily Signal Watchlist UI section
- `apps/web/src/shared/api/types.ts` — `UserProfile.dailySignalWatchlist`
- `apps/worker/src/modules/daily-signal/daily-signal.service.ts` — core logic
- `apps/worker/src/modules/daily-signal/daily-signal.module.ts` — NestJS module
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — wires into 00:00 UTC cron
```

- [ ] **Step 2: Commit**

```bash
git add docs/features/daily-long-signal/daily-long-signal.md
git commit -m "docs: add daily-long-signal feature documentation"
```

---

## Self-Review

**Spec coverage:**
- ✅ Re-use UT Bot from fomo-long → extracted to `@app/core`, imported in both strategy and service
- ✅ Add "Daily Signal Watchlist" to user profile (UI + API + schema)
- ✅ Check at 00:00 UTC (wired into existing `sendDailySignals` cron)
- ✅ Send Telegram: "coins can long today: BTCUSDT, SUIUSDT…"
- ✅ Plan + docs written before implementation

**Type consistency:**
- `isUtBotUptrend(candles: Candle[], period = 10, multiplier = 1): boolean` — consistent in `ut-bot.ts`, `fomo-long.strategy.ts`, and `daily-signal.service.ts`
- `dailySignalWatchlist: string[]` — consistent across `UserProfile` type, DTO, service, repository, and profile page state
- `DailySignalService.checkAndSend()` — called in scheduler, matches method name in service

**No placeholders found.**
