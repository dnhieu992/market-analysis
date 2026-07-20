import { Injectable, NotFoundException } from '@nestjs/common';

import { BitgetService } from './bitget.service';
import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { renderSetupChart, type ChartMarker, type OhlcCandle } from './setup-chart-renderer';

// Fetch enough M30 history to warm up EMA89 + fill the S/R loopback, then plot
// only the most recent window.
const CANDLE_LIMIT = 500;
const DISPLAY_CANDLES = 200;

const bareSymbol = (s: string) => s.trim().toUpperCase().replace(/USDT$/, '');

/** Renders the on-demand Setup-tab chart (SonicR + S/R channels + RSI, M30). */
@Injectable()
export class BitgetSetupChartService {
  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly bitget: BitgetService,
  ) {}

  async generateChart(symbol: string): Promise<Buffer> {
    const bare = bareSymbol(symbol);
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

    const display = candles.slice(Math.max(0, candles.length - DISPLAY_CANDLES));
    const markers = await this.buildMarkers(bare, display[0]!.time);

    return renderSetupChart({
      symbol: pair,
      timeframe: 'M30',
      candles,
      currentPrice: candles[candles.length - 1]!.close,
      display: DISPLAY_CANDLES,
      markers,
    });
  }

  /**
   * Entry/exit annotations for this coin: every live open position (entry line +
   * uPnL) plus the most recent closed trade whose exit falls inside the visible
   * window (entry + close lines with realized PnL). All lookups are non-fatal —
   * the chart still renders if Bitget/DB are unavailable.
   */
  private async buildMarkers(bare: string, windowStart: number): Promise<ChartMarker[]> {
    const markers: ChartMarker[] = [];

    const positions = await this.bitget.getOpenPositions().catch(() => null);
    for (const p of positions?.positions ?? []) {
      if (bareSymbol(p.symbol) !== bare) continue;
      markers.push({
        kind: 'open',
        holdSide: p.holdSide,
        entryPrice: p.entryPrice,
        pnlUsd: p.unrealizedPnlUsd,
      });
    }
    const openSides = new Set(markers.map((m) => m.holdSide));

    const history = await this.bitget.getClosedHistory(50, `${bare}USDT`).catch(() => null);
    const recentClosed = (history?.trades ?? [])
      .filter(
        (t) =>
          bareSymbol(t.symbol) === bare &&
          new Date(t.closedAt).getTime() >= windowStart &&
          // Skip if that side is already shown as an open position.
          !openSides.has(t.holdSide),
      )
      .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime())[0];

    if (recentClosed) {
      markers.push({
        kind: 'closed',
        holdSide: recentClosed.holdSide,
        entryPrice: recentClosed.openAvgPrice,
        closePrice: recentClosed.closeAvgPrice,
        pnlUsd: recentClosed.netProfit,
      });
    }

    return markers;
  }
}
