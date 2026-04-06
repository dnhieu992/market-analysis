import { Injectable, Logger } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { calculateEma } from './ema.util';

type Kline = [number, string, string, string, string, string, number, ...unknown[]];

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

@Injectable()
export class EmaSignalService {
  private readonly logger = new Logger(EmaSignalService.name);

  constructor(private readonly binance: BinanceMarketDataService) {}

  async getSignal(symbol: string): Promise<string> {
    try {
      return await this.analyze(symbol);
    } catch (error) {
      this.logger.error(`Signal failed for ${symbol}: ${error instanceof Error ? error.message : 'unknown'}`);
      return `Failed to fetch data for ${symbol}, please try again`;
    }
  }

  private async analyze(symbol: string): Promise<string> {
    // Step 1: H1 trend
    const h1Klines = await this.binance.fetchKlines({ symbol, timeframe: '1h', limit: 100 });
    const h1Closes = h1Klines.map((k: Kline) => parseFloat(k[4]));
    const h1Ema20 = calculateEma(h1Closes, 20);
    const h1Ema50 = calculateEma(h1Closes, 50);

    if (h1Ema20.length === 0 || h1Ema50.length === 0) {
      return `No clear H1 trend for ${symbol}`;
    }

    const h1LastClose = h1Closes[h1Closes.length - 1] as number;
    const h1LastEma20 = h1Ema20[h1Ema20.length - 1] as number;
    const h1LastEma50 = h1Ema50[h1Ema50.length - 1] as number;

    const isLong = h1LastClose > h1LastEma20 && h1LastEma20 > h1LastEma50;
    const isShort = h1LastClose < h1LastEma20 && h1LastEma20 < h1LastEma50;

    if (!isLong && !isShort) {
      return `No clear H1 trend for ${symbol}`;
    }

    const direction = isLong ? 'LONG' : 'SHORT';

    // Step 2: M15 entry
    const m15Klines = await this.binance.fetchKlines({ symbol, timeframe: '15m', limit: 50 });
    const m15Closes = m15Klines.map((k: Kline) => parseFloat(k[4]));
    const m15Ema20 = calculateEma(m15Closes, 20);

    if (m15Ema20.length === 0) {
      return `No M15 entry signal for ${symbol}`;
    }

    // Align EMA index: m15Ema20[i] corresponds to m15Klines[i + 19]
    const emaOffset = m15Closes.length - m15Ema20.length;

    // Scan last 10 candles for pullback entry
    const scanStart = Math.max(0, m15Ema20.length - 10);
    let entryIndex: number | null = null;

    for (let i = m15Ema20.length - 1; i >= scanStart; i--) {
      const kline = m15Klines[i + emaOffset] as Kline;
      const high = parseFloat(kline[2]);
      const low = parseFloat(kline[3]);
      const close = parseFloat(kline[4]);
      const ema = m15Ema20[i] as number;

      if (isLong && low <= ema && close > ema) {
        entryIndex = i + emaOffset;
        break;
      }
      if (isShort && high >= ema && close < ema) {
        entryIndex = i + emaOffset;
        break;
      }
    }

    if (entryIndex === null) {
      return `No M15 entry signal for ${symbol}`;
    }

    // Step 3: Calculate levels
    const entry = parseFloat((m15Klines[entryIndex] as Kline)[4]);
    const swingCandles = m15Klines.slice(Math.max(0, entryIndex - 5), entryIndex);

    let sl: number;
    if (isLong) {
      sl = Math.min(...swingCandles.map((k: Kline) => parseFloat(k[3])));
    } else {
      sl = Math.max(...swingCandles.map((k: Kline) => parseFloat(k[2])));
    }

    const risk = Math.abs(entry - sl);
    const tp = isLong ? entry + 2 * risk : entry - 2 * risk;

    const lines = [
      `Strategy: EMA20-50`,
      `${symbol}-M15: ${direction}`,
      `Open:  ${formatNumber(entry)}`,
      `TP:    ${formatNumber(tp)}`,
      `SL:    ${formatNumber(sl)}`
    ].join('\n');

    return `<pre>${lines}</pre>`;
  }
}
