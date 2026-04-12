# Back-Test Strategy System

## Overview

A file-based strategy back-testing system built into the API app. Strategies are auto-discovered from a `strategies/` folder — adding a new strategy requires only dropping a `.ts` file, no registration needed. Results are persisted to DB for history and comparison.

---

## Architecture

- **Location:** `apps/api/src/modules/back-test/`
- **Strategy discovery:** File-based (`StrategyRegistryService` scans `strategies/` on module init)
- **Engine:** Pure candle-by-candle simulation, SL/TP exit detection on candle high/low
- **Storage:** `BackTestResult` Prisma model, results saved after each run

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/back-test/strategies` | List all auto-discovered strategies |
| `POST` | `/back-test/run` | Run a back-test |

### POST /back-test/run — Request Body
```json
{
  "strategy": "ema-crossover",
  "symbol": "BTCUSDT",
  "from": "2024-01-01T00:00:00.000Z",
  "to": "2024-12-31T00:00:00.000Z",
  "timeframe": "4h"
}
```

### POST /back-test/run — Response
```json
{
  "id": "clxyz...",
  "strategy": "ema-crossover",
  "symbol": "BTCUSDT",
  "timeframe": "4h",
  "from": "2024-01-01T00:00:00.000Z",
  "to": "2024-12-31T00:00:00.000Z",
  "totalTrades": 42,
  "wins": 26,
  "losses": 16,
  "winRate": 0.619,
  "totalPnl": 4821.5,
  "maxDrawdown": 0.12,
  "sharpeRatio": 1.34,
  "trades": [ ... ]
}
```

---

## File Structure

```
apps/api/src/modules/back-test/
  back-test.module.ts
  back-test.controller.ts
  back-test.service.ts
  back-test-engine.service.ts
  strategy-registry.service.ts
  back-test.providers.ts
  types/
    back-test.types.ts
  dto/
    run-back-test.dto.ts
  strategies/
    strategy.interface.ts
    ema-crossover.strategy.ts
    rsi-reversal.strategy.ts
    price-action.strategy.ts

apps/api/src/modules/market/
  market.module.ts
  market-data.service.ts            (+ getCandlesInRange)
  binance-market-data.service.ts    (+ fetchKlinesInRange)
  dto/
    binance-kline.dto.ts

packages/db/prisma/schema.prisma    (+ BackTestResult model)
packages/db/src/repositories/
  back-test-result.repository.ts

apps/api/src/app.module.ts          (+ BackTestModule)
```

---

## Core Types

```ts
// Strategy interface — every strategy file must implement this
interface IBackTestStrategy {
  name: string;               // must be kebab-case, matches file name
  description: string;
  defaultTimeframe: string;
  evaluate(ctx: StrategyContext): TradeSignal | null;
}

// Called per candle during simulation
type StrategyContext = {
  candles: Candle[];    // all candles up to current index
  current: Candle;
  index: number;
  symbol: string;
};

// Returned by strategy when a trade should be opened
type TradeSignal = {
  direction: 'long' | 'short';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
};

// One completed simulated trade
type BackTestTrade = {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  direction: 'long' | 'short';
  pnl: number;
  pnlPercent: number;
  outcome: 'win' | 'loss' | 'breakeven';
};
```

---

## Database Schema

```prisma
model BackTestResult {
  id             String   @id @default(cuid())
  strategy       String
  symbol         String
  timeframe      String
  fromDate       DateTime
  toDate         DateTime
  totalTrades    Int
  winRate        Float
  totalPnl       Float
  maxDrawdown    Float
  sharpeRatio    Float?
  tradesJson     String   @db.LongText
  parametersJson String   @db.Text
  status         String   // 'completed' | 'failed'
  errorMessage   String?  @db.Text
  createdAt      DateTime @default(now())

  @@index([strategy, symbol, createdAt])
}
```

---

## Engine Behavior

- Iterates candle by candle (index `1` to `n`)
- Calls `strategy.evaluate()` when no trade is open
- On each candle, checks if open trade SL/TP was hit using candle `high`/`low`
- If both SL and TP fall within candle range, **SL is prioritized** (conservative)
- Open trade at end of data is force-closed at last candle's close price
- Metrics computed: win rate, total PnL, max drawdown (peak-to-trough equity), Sharpe ratio

---

## Strategy Registry

`StrategyRegistryService` scans `strategies/` on `onModuleInit`:

1. Reads all `.ts` / `.js` files in the directory
2. Dynamically `require()`s each file
3. Instantiates the default export
4. Validates it implements `IBackTestStrategy` (has `name` and `evaluate`)
5. Registers it in an in-memory `Map<name, instance>`

**To add a new strategy:** create a file in `strategies/`, export a class as default. No other changes needed.

---

## Example Strategy

```ts
// strategies/ema-crossover.strategy.ts
export class EmaCrossoverStrategy implements IBackTestStrategy {
  readonly name = 'ema-crossover';
  readonly description = 'Enter long when EMA20 crosses above EMA50, short when it crosses below';
  readonly defaultTimeframe = '4h';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < 52) return null;

    const closes = ctx.candles.map((c) => c.close);
    const ema20Now = calculateEma(closes, 20);
    const ema50Now = calculateEma(closes, 50);
    const ema20Prev = calculateEma(closes.slice(0, -1), 20);
    const ema50Prev = calculateEma(closes.slice(0, -1), 50);

    const entry = ctx.current.close;
    const atr = ctx.current.high - ctx.current.low;

    if (ema20Prev <= ema50Prev && ema20Now > ema50Now) {
      return { direction: 'long', entryPrice: entry, stopLoss: entry - 2 * atr, takeProfit: entry + 3 * atr };
    }
    if (ema20Prev >= ema50Prev && ema20Now < ema50Now) {
      return { direction: 'short', entryPrice: entry, stopLoss: entry + 2 * atr, takeProfit: entry - 3 * atr };
    }

    return null;
  }
}

export default EmaCrossoverStrategy;
```

---

## Implementation Steps

- [x] 1. Add `BackTestResult` model to `packages/db/prisma/schema.prisma`, run migration
- [x] 2. Add `createBackTestResultRepository` to `packages/db/src/repositories/` and export from `index.ts`
- [x] 3. Copy market module into `apps/api/src/modules/market/`, add `getCandlesInRange()` with Binance pagination
- [x] 4. Create `types/back-test.types.ts`
- [x] 5. Create `strategies/strategy.interface.ts`
- [x] 6. Build `back-test-engine.service.ts`
- [x] 7. Build `strategy-registry.service.ts`
- [x] 8. Write `strategies/ema-crossover.strategy.ts`
- [x] 9. Write `strategies/rsi-reversal.strategy.ts`
- [x] 9b. Write `strategies/price-action.strategy.ts`
- [x] 10. Create `back-test.providers.ts`
- [x] 11. Build `back-test.service.ts`
- [x] 12. Create `dto/run-back-test.dto.ts`
- [x] 13. Build `back-test.controller.ts`
- [x] 14. Assemble `back-test.module.ts`
- [x] 15. Register `BackTestModule` in `apps/api/src/app.module.ts`
- [x] 16. Update `apps/api/package.json` (add `axios`, `@app/core` if not present)

---

## UI Implementation — `/strategy` Page

### Overview

A Next.js page at `/strategy` (Strategy Lab) integrated with the back-test API. Built as a server component that pre-loads strategies and history, with a client-side widget for running tests and displaying results.

### Architecture

- **Route:** `apps/web/src/app/strategy/page.tsx` — server component, fetches strategies + history in parallel
- **Widget:** `apps/web/src/widgets/back-test-feed/back-test-feed.tsx` — client component, handles form state and rendering
- **API client:** extended `apps/web/src/shared/api/client.ts` with 3 new methods
- **Types:** extended `apps/web/src/shared/api/types.ts` with back-test types
- **Nav:** added "Strategy Lab" entry to sidebar

### Scope — Files Changed / Created

```
apps/web/src/app/strategy/
  page.tsx                                        (new) server page

apps/web/src/widgets/back-test-feed/
  back-test-feed.tsx                              (new) client widget

apps/web/src/shared/api/
  types.ts                                        (modified) + BackTestStrategy, BackTestResult,
                                                             BackTestResultRecord, RunBackTestInput
  client.ts                                       (modified) + fetchBackTestStrategies(),
                                                               runBackTest(), fetchBackTestResults()

apps/web/src/widgets/app-shell/
  sidebar-nav.tsx                                 (modified) + Strategy Lab nav item

apps/web/src/app/
  globals.css                                     (modified) + back-test CSS styles

apps/web/src/app/settings/
  page.spec.tsx                                   (modified) updated mock to include new API methods
```

### UI Sections

| Section | Description |
|---------|-------------|
| **Run form** | Strategy picker, symbol, timeframe, date range, Run button |
| **Result summary** | 6 metric cards: total trades, win rate, wins/losses, total PnL, max drawdown, Sharpe ratio |
| **Trade table** | Per-trade breakdown: direction, entry, exit, PnL, PnL%, outcome |
| **History table** | All past runs: strategy, symbol, timeframe, trades, win rate, PnL, drawdown, status |

### Implementation Steps

- [x] 1. Add `BackTestStrategy`, `BackTestResult`, `BackTestResultRecord`, `RunBackTestInput` types to `shared/api/types.ts`
- [x] 2. Add `fetchBackTestStrategies()`, `runBackTest()`, `fetchBackTestResults()` to `shared/api/client.ts`
- [x] 3. Create `widgets/back-test-feed/back-test-feed.tsx` client widget
- [x] 4. Create `app/strategy/page.tsx` server page
- [x] 5. Add "Strategy Lab" nav item to `sidebar-nav.tsx`
- [x] 6. Add back-test CSS to `globals.css`
- [x] 7. Update `settings/page.spec.tsx` mock with new API methods
