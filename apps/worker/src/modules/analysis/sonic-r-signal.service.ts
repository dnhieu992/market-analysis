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
