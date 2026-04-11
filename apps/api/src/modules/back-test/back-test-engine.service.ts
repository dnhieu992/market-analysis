import { Injectable } from '@nestjs/common';
import type { Candle } from '@app/core';

import type { IBackTestStrategy } from './strategies/strategy.interface';
import type { BackTestSummary, BackTestTrade, StrategyContext } from './types/back-test.types';

@Injectable()
export class BackTestEngineService {
  run(strategy: IBackTestStrategy, candles: Candle[], symbol: string): BackTestSummary {
    const trades: BackTestTrade[] = [];
    let openTrade: {
      entryIndex: number;
      entryPrice: number;
      direction: 'long' | 'short';
      stopLoss: number;
      takeProfit: number;
    } | null = null;

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i]!;
      const ctx: StrategyContext = {
        candles: candles.slice(0, i + 1),
        current,
        index: i,
        symbol
      };

      if (openTrade) {
        const exitResult = this.checkExit(current, openTrade);
        if (exitResult !== null) {
          const pnl = this.calcPnl(openTrade.direction, openTrade.entryPrice, exitResult.exitPrice);
          trades.push({
            entryIndex: openTrade.entryIndex,
            exitIndex: i,
            entryPrice: openTrade.entryPrice,
            exitPrice: exitResult.exitPrice,
            direction: openTrade.direction,
            pnl,
            pnlPercent: pnl / openTrade.entryPrice,
            outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven'
          });
          openTrade = null;
        }
      }

      if (!openTrade) {
        const signal = strategy.evaluate(ctx);
        if (signal) {
          openTrade = {
            entryIndex: i,
            entryPrice: signal.entryPrice,
            direction: signal.direction,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit
          };
        }
      }
    }

    if (openTrade) {
      const lastCandle = candles[candles.length - 1]!;
      const pnl = this.calcPnl(openTrade.direction, openTrade.entryPrice, lastCandle.close);
      trades.push({
        entryIndex: openTrade.entryIndex,
        exitIndex: candles.length - 1,
        entryPrice: openTrade.entryPrice,
        exitPrice: lastCandle.close,
        direction: openTrade.direction,
        pnl,
        pnlPercent: pnl / openTrade.entryPrice,
        outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven'
      });
    }

    return this.summarize(trades);
  }

  private checkExit(
    candle: Candle,
    trade: { direction: 'long' | 'short'; stopLoss: number; takeProfit: number }
  ): { exitPrice: number } | null {
    if (trade.direction === 'long') {
      if (candle.low <= trade.stopLoss) return { exitPrice: trade.stopLoss };
      if (candle.high >= trade.takeProfit) return { exitPrice: trade.takeProfit };
    } else {
      if (candle.high >= trade.stopLoss) return { exitPrice: trade.stopLoss };
      if (candle.low <= trade.takeProfit) return { exitPrice: trade.takeProfit };
    }
    return null;
  }

  private calcPnl(direction: 'long' | 'short', entry: number, exit: number): number {
    return direction === 'long' ? exit - entry : entry - exit;
  }

  private summarize(trades: BackTestTrade[]): BackTestSummary {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalPnl: 0,
        maxDrawdown: 0,
        sharpeRatio: null,
        trades: []
      };
    }

    const wins = trades.filter((t) => t.outcome === 'win').length;
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

    return {
      totalTrades: trades.length,
      wins,
      losses: trades.length - wins,
      winRate: wins / trades.length,
      totalPnl,
      maxDrawdown: this.calcMaxDrawdown(trades),
      sharpeRatio: this.calcSharpe(trades),
      trades
    };
  }

  private calcMaxDrawdown(trades: BackTestTrade[]): number {
    let peak = 0;
    let equity = 0;
    let maxDD = 0;

    for (const trade of trades) {
      equity += trade.pnl;
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? (peak - equity) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }

    return maxDD;
  }

  private calcSharpe(trades: BackTestTrade[]): number | null {
    if (trades.length < 2) return null;
    const returns = trades.map((t) => t.pnlPercent);
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    return stdDev === 0 ? null : Number((mean / stdDev).toFixed(4));
  }
}
