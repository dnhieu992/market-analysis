import { Injectable } from '@nestjs/common';
import type { Candle } from '@app/core';

import type { IBackTestStrategy } from './strategies/strategy.interface';
import type { BackTestSummary, BackTestTrade, StrategyContext } from './types/back-test.types';

@Injectable()
export class BackTestEngineService {
  run(strategy: IBackTestStrategy, candles: Candle[], symbol: string, htfCandles: Record<string, Candle[]> = {}, params: Record<string, unknown> = {}): BackTestSummary {
    const trades: BackTestTrade[] = [];
    let openTrade: {
      entryIndex: number;
      entryTime: Date | null;
      entryPrice: number;
      direction: 'long' | 'short';
      stopLoss: number;
      takeProfit: number;
      originalStopLoss: number;
      breakevenTriggered: boolean;
      breakevenTriggerPrice: number;
      forceCloseTime: Date | null;
    } | null = null;

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i]!;
      const ctx: StrategyContext = {
        candles: candles.slice(0, i + 1),
        current,
        index: i,
        symbol,
        htfCandles,
        params
      };

      if (openTrade) {
        // Time-based exit takes priority over price exits
        const timeExit =
          openTrade.forceCloseTime &&
          current.openTime &&
          current.openTime >= openTrade.forceCloseTime;

        const exitResult = timeExit
          ? { exitPrice: current.open ?? current.close }
          : this.checkExit(current, openTrade);

        if (exitResult !== null) {
          const pnl = this.calcPnl(openTrade.direction, openTrade.entryPrice, exitResult.exitPrice);
          const size = this.calcSize(openTrade.entryPrice);
          trades.push({
            entryIndex: openTrade.entryIndex,
            exitIndex: i,
            entryTime: openTrade.entryTime,
            exitTime: current.openTime ?? null,
            entryPrice: openTrade.entryPrice,
            exitPrice: exitResult.exitPrice,
            stopLoss: openTrade.originalStopLoss,
            takeProfit: openTrade.takeProfit,
            direction: openTrade.direction,
            size,
            pnl,
            pnlPercent: pnl / openTrade.entryPrice,
            outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven'
          });
          openTrade = null;
        } else if (!openTrade.breakevenTriggered && !strategy.disableBreakeven) {
          // No exit this candle — check if price traveled 1R so we can move SL to entry
          const hit =
            openTrade.direction === 'long'
              ? current.high >= openTrade.breakevenTriggerPrice
              : current.low <= openTrade.breakevenTriggerPrice;
          if (hit) {
            openTrade.stopLoss = openTrade.entryPrice;
            openTrade.breakevenTriggered = true;
          }
        }
      }

      if (!openTrade) {
        const signal = strategy.evaluate(ctx);
        if (signal) {
          const risk = Math.abs(signal.entryPrice - signal.stopLoss);
          const breakevenTriggerPrice =
            signal.direction === 'long'
              ? signal.entryPrice + risk
              : signal.entryPrice - risk;
          openTrade = {
            entryIndex: i,
            entryTime: current.openTime ?? null,
            entryPrice: signal.entryPrice,
            direction: signal.direction,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            originalStopLoss: signal.stopLoss,
            breakevenTriggered: false,
            breakevenTriggerPrice,
            forceCloseTime: signal.forceCloseTime ?? null
          };
        }
      }
    }

    if (openTrade) {
      const lastCandle = candles[candles.length - 1]!;
      const pnl = this.calcPnl(openTrade.direction, openTrade.entryPrice, lastCandle.close);
      const size = this.calcSize(openTrade.entryPrice);
      trades.push({
        entryIndex: openTrade.entryIndex,
        exitIndex: candles.length - 1,
        entryTime: openTrade.entryTime,
        exitTime: lastCandle.openTime ?? null,
        entryPrice: openTrade.entryPrice,
        exitPrice: lastCandle.close,
        stopLoss: openTrade.originalStopLoss,
        takeProfit: openTrade.takeProfit,
        direction: openTrade.direction,
        size,
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

  private readonly tradeNotional = 1000; // fixed $1000 per trade

  private calcSize(entry: number): number {
    if (entry === 0) return 0;
    return Number((this.tradeNotional / entry).toFixed(6));
  }

  private calcPnl(
    direction: 'long' | 'short',
    entry: number,
    exit: number
  ): number {
    const size = this.calcSize(entry);
    const priceDiff = direction === 'long' ? exit - entry : entry - exit;
    return Number((size * priceDiff).toFixed(2));
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
