import { BackTestEngineService } from '../src/modules/back-test/back-test-engine.service';
import type { IBackTestStrategy } from '../src/modules/back-test/strategies/strategy.interface';
import type { StrategyContext, TradeSignal } from '../src/modules/back-test/types/back-test.types';
import type { Candle } from '@app/core';

function makeCandle(close: number, overrides: Partial<Candle> = {}): Candle {
  return {
    open: close - 10,
    high: close + 20,
    low: close - 20,
    close,
    volume: 1000,
    openTime: new Date(),
    closeTime: new Date(),
    ...overrides
  };
}

function makeCandles(count: number, startPrice = 100): Candle[] {
  return Array.from({ length: count }, (_, i) => makeCandle(startPrice + i));
}

describe('BackTestEngineService', () => {
  let engine: BackTestEngineService;

  beforeEach(() => {
    engine = new BackTestEngineService();
  });

  describe('run — no trades', () => {
    it('returns zero summary when strategy never signals', () => {
      const strategy: IBackTestStrategy = {
        name: 'no-signal',
        description: '',
        defaultTimeframe: '4h',
        evaluate: () => null
      };

      const result = engine.run(strategy, makeCandles(10), 'BTCUSDT');

      expect(result.totalTrades).toBe(0);
      expect(result.wins).toBe(0);
      expect(result.losses).toBe(0);
      expect(result.winRate).toBe(0);
      expect(result.totalPnl).toBe(0);
      expect(result.maxDrawdown).toBe(0);
      expect(result.sharpeRatio).toBeNull();
      expect(result.trades).toHaveLength(0);
    });

    it('returns zero summary for empty candles array', () => {
      const strategy: IBackTestStrategy = {
        name: 'no-signal',
        description: '',
        defaultTimeframe: '4h',
        evaluate: () => null
      };

      const result = engine.run(strategy, [], 'BTCUSDT');
      expect(result.totalTrades).toBe(0);
    });
  });

  describe('run — TP hit', () => {
    it('records a win when take profit is reached', () => {
      // Signal on candle index 1, TP hit on candle index 2
      let signaled = false;
      const strategy: IBackTestStrategy = {
        name: 'tp-strategy',
        description: '',
        defaultTimeframe: '4h',
        evaluate: (ctx: StrategyContext): TradeSignal | null => {
          if (ctx.index === 1 && !signaled) {
            signaled = true;
            return {
              direction: 'long',
              entryPrice: 100,
              stopLoss: 80,
              takeProfit: 120
            };
          }
          return null;
        }
      };

      const candles: Candle[] = [
        makeCandle(100),
        makeCandle(100),
        makeCandle(130, { low: 90, high: 130 }) // high >= takeProfit (120)
      ];

      const result = engine.run(strategy, candles, 'BTCUSDT');

      expect(result.totalTrades).toBe(1);
      expect(result.wins).toBe(1);
      expect(result.losses).toBe(0);
      expect(result.winRate).toBe(1);
      expect(result.trades[0]?.exitPrice).toBe(120);
      expect(result.trades[0]?.outcome).toBe('win');
      expect(result.trades[0]?.pnl).toBe(20);
    });
  });

  describe('run — SL hit', () => {
    it('records a loss when stop loss is reached', () => {
      let signaled = false;
      const strategy: IBackTestStrategy = {
        name: 'sl-strategy',
        description: '',
        defaultTimeframe: '4h',
        evaluate: (ctx: StrategyContext): TradeSignal | null => {
          if (ctx.index === 1 && !signaled) {
            signaled = true;
            return {
              direction: 'long',
              entryPrice: 100,
              stopLoss: 80,
              takeProfit: 120
            };
          }
          return null;
        }
      };

      const candles: Candle[] = [
        makeCandle(100),
        makeCandle(100),
        makeCandle(70, { low: 70, high: 95 }) // low <= stopLoss (80)
      ];

      const result = engine.run(strategy, candles, 'BTCUSDT');

      expect(result.totalTrades).toBe(1);
      expect(result.losses).toBe(1);
      expect(result.wins).toBe(0);
      expect(result.winRate).toBe(0);
      expect(result.trades[0]?.exitPrice).toBe(80);
      expect(result.trades[0]?.outcome).toBe('loss');
      expect(result.trades[0]?.pnl).toBe(-20);
    });

    it('prioritizes SL over TP when both are hit on the same candle', () => {
      let signaled = false;
      const strategy: IBackTestStrategy = {
        name: 'both-hit',
        description: '',
        defaultTimeframe: '4h',
        evaluate: (ctx: StrategyContext): TradeSignal | null => {
          if (ctx.index === 1 && !signaled) {
            signaled = true;
            return { direction: 'long', entryPrice: 100, stopLoss: 80, takeProfit: 120 };
          }
          return null;
        }
      };

      const candles: Candle[] = [
        makeCandle(100),
        makeCandle(100),
        makeCandle(100, { low: 70, high: 130 }) // both SL and TP touched
      ];

      const result = engine.run(strategy, candles, 'BTCUSDT');

      expect(result.trades[0]?.exitPrice).toBe(80); // SL wins
      expect(result.trades[0]?.outcome).toBe('loss');
    });
  });

  describe('run — short direction', () => {
    it('records a win for short trade when TP is reached', () => {
      let signaled = false;
      const strategy: IBackTestStrategy = {
        name: 'short-strategy',
        description: '',
        defaultTimeframe: '4h',
        evaluate: (ctx: StrategyContext): TradeSignal | null => {
          if (ctx.index === 1 && !signaled) {
            signaled = true;
            return { direction: 'short', entryPrice: 100, stopLoss: 120, takeProfit: 80 };
          }
          return null;
        }
      };

      const candles: Candle[] = [
        makeCandle(100),
        makeCandle(100),
        makeCandle(70, { low: 70, high: 95 }) // low <= takeProfit (80)
      ];

      const result = engine.run(strategy, candles, 'BTCUSDT');

      expect(result.trades[0]?.direction).toBe('short');
      expect(result.trades[0]?.exitPrice).toBe(80);
      expect(result.trades[0]?.outcome).toBe('win');
      expect(result.trades[0]?.pnl).toBe(20); // entry(100) - exit(80)
    });

    it('records a loss for short trade when SL is reached', () => {
      let signaled = false;
      const strategy: IBackTestStrategy = {
        name: 'short-sl',
        description: '',
        defaultTimeframe: '4h',
        evaluate: (ctx: StrategyContext): TradeSignal | null => {
          if (ctx.index === 1 && !signaled) {
            signaled = true;
            return { direction: 'short', entryPrice: 100, stopLoss: 120, takeProfit: 80 };
          }
          return null;
        }
      };

      const candles: Candle[] = [
        makeCandle(100),
        makeCandle(100),
        makeCandle(130, { low: 105, high: 130 }) // high >= stopLoss (120)
      ];

      const result = engine.run(strategy, candles, 'BTCUSDT');

      expect(result.trades[0]?.exitPrice).toBe(120);
      expect(result.trades[0]?.outcome).toBe('loss');
      expect(result.trades[0]?.pnl).toBe(-20); // entry(100) - exit(120)
    });
  });

  describe('run — open trade force-closed at end', () => {
    it('closes open trade at last candle close price', () => {
      let signaled = false;
      const strategy: IBackTestStrategy = {
        name: 'never-exits',
        description: '',
        defaultTimeframe: '4h',
        evaluate: (ctx: StrategyContext): TradeSignal | null => {
          if (ctx.index === 1 && !signaled) {
            signaled = true;
            return { direction: 'long', entryPrice: 100, stopLoss: 1, takeProfit: 99999 };
          }
          return null;
        }
      };

      const candles: Candle[] = [
        makeCandle(100),
        makeCandle(100),
        makeCandle(110, { low: 95, high: 115 })
      ];

      const result = engine.run(strategy, candles, 'BTCUSDT');

      expect(result.totalTrades).toBe(1);
      expect(result.trades[0]?.exitPrice).toBe(110);
      expect(result.trades[0]?.pnl).toBe(10);
    });
  });

  describe('run — multiple trades', () => {
    it('processes multiple sequential trades correctly', () => {
      let callCount = 0;
      const strategy: IBackTestStrategy = {
        name: 'multi-trade',
        description: '',
        defaultTimeframe: '4h',
        evaluate: (ctx: StrategyContext): TradeSignal | null => {
          // Signal on index 1 and index 3
          if (ctx.index === 1 && callCount === 0) {
            callCount++;
            return { direction: 'long', entryPrice: 100, stopLoss: 80, takeProfit: 120 };
          }
          if (ctx.index === 3 && callCount === 1) {
            callCount++;
            return { direction: 'long', entryPrice: 150, stopLoss: 130, takeProfit: 170 };
          }
          return null;
        }
      };

      const candles: Candle[] = [
        makeCandle(100),
        makeCandle(100),
        makeCandle(130, { low: 90, high: 130 }), // TP hit at 120 → win
        makeCandle(150),
        makeCandle(175, { low: 140, high: 180 })  // TP hit at 170 → win
      ];

      const result = engine.run(strategy, candles, 'BTCUSDT');

      expect(result.totalTrades).toBe(2);
      expect(result.wins).toBe(2);
      expect(result.losses).toBe(0);
      expect(result.winRate).toBe(1);
    });
  });

  describe('metrics', () => {
    it('computes win rate correctly', () => {
      let callCount = 0;
      const strategy: IBackTestStrategy = {
        name: 'mixed',
        description: '',
        defaultTimeframe: '4h',
        evaluate: (ctx: StrategyContext): TradeSignal | null => {
          if (ctx.index === 1 && callCount === 0) {
            callCount++;
            return { direction: 'long', entryPrice: 100, stopLoss: 80, takeProfit: 120 };
          }
          if (ctx.index === 3 && callCount === 1) {
            callCount++;
            return { direction: 'long', entryPrice: 150, stopLoss: 130, takeProfit: 170 };
          }
          return null;
        }
      };

      const candles: Candle[] = [
        makeCandle(100),
        makeCandle(100),
        makeCandle(130, { low: 90, high: 130 }), // TP at 120 → win
        makeCandle(150),
        makeCandle(120, { low: 120, high: 145 })  // SL at 130 → loss
      ];

      const result = engine.run(strategy, candles, 'BTCUSDT');

      expect(result.totalTrades).toBe(2);
      expect(result.wins).toBe(1);
      expect(result.losses).toBe(1);
      expect(result.winRate).toBe(0.5);
    });

    it('returns null sharpe ratio when fewer than 2 trades', () => {
      let signaled = false;
      const strategy: IBackTestStrategy = {
        name: 'one-trade',
        description: '',
        defaultTimeframe: '4h',
        evaluate: (ctx: StrategyContext): TradeSignal | null => {
          if (ctx.index === 1 && !signaled) {
            signaled = true;
            return { direction: 'long', entryPrice: 100, stopLoss: 80, takeProfit: 120 };
          }
          return null;
        }
      };

      const candles: Candle[] = [
        makeCandle(100),
        makeCandle(100),
        makeCandle(130, { low: 90, high: 130 })
      ];

      const result = engine.run(strategy, candles, 'BTCUSDT');
      expect(result.sharpeRatio).toBeNull();
    });

    it('computes max drawdown as 0 when all trades are winners', () => {
      let callCount = 0;
      const strategy: IBackTestStrategy = {
        name: 'all-wins',
        description: '',
        defaultTimeframe: '4h',
        evaluate: (ctx: StrategyContext): TradeSignal | null => {
          if ((ctx.index === 1 || ctx.index === 3) && callCount < 2) {
            callCount++;
            return { direction: 'long', entryPrice: 100, stopLoss: 80, takeProfit: 120 };
          }
          return null;
        }
      };

      const candles: Candle[] = [
        makeCandle(100),
        makeCandle(100),
        makeCandle(130, { low: 90, high: 130 }),
        makeCandle(100),
        makeCandle(130, { low: 90, high: 130 })
      ];

      const result = engine.run(strategy, candles, 'BTCUSDT');
      expect(result.maxDrawdown).toBe(0);
    });
  });
});
