import { Injectable, NotFoundException } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { renderSetupChart, type OhlcCandle } from './setup-chart-renderer';

// Fetch enough M30 history to warm up EMA89 + fill the S/R loopback, then plot
// only the most recent window.
const CANDLE_LIMIT = 500;
const DISPLAY_CANDLES = 200;

/** Renders the on-demand Setup-tab chart (SonicR + S/R channels + RSI, M30). */
@Injectable()
export class BitgetSetupChartService {
  constructor(private readonly binance: BinanceMarketDataService) {}

  async generateChart(symbol: string): Promise<Buffer> {
    const bare = symbol.trim().toUpperCase().replace(/USDT$/, '');
    const pair = `${bare}USDT`;

    const klines = await this.binance.fetchKlines({
      symbol: pair,
      timeframe: 'M30' as never,
      limit: CANDLE_LIMIT,
    });
    if (klines.length === 0) {
      throw new NotFoundException(`No M30 candles for ${pair}`);
    }

    const candles: OhlcCandle[] = klines.map((k) => ({
      time: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));

    return renderSetupChart({
      symbol: pair,
      timeframe: 'M30',
      candles,
      currentPrice: candles[candles.length - 1]!.close,
      display: DISPLAY_CANDLES,
    });
  }
}
