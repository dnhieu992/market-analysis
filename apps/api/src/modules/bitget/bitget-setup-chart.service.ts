import { Injectable, NotFoundException } from '@nestjs/common';

import { BitgetService } from './bitget.service';
import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { renderSetupChart, type ChartMarker, type OhlcCandle } from './setup-chart-renderer';

const bareSymbol = (s: string) => s.trim().toUpperCase().replace(/USDT$/, '');

const TF_CONFIG: Record<string, { limit: number; display: number }> = {
  'M30': { limit: 500, display: 200 },
  '1h':  { limit: 400, display: 150 },
  '4h':  { limit: 300, display: 120 },
  '1d':  { limit: 200, display: 90  },
};

/** Renders the on-demand Setup-tab chart (SonicR + S/R channels + RSI). */
@Injectable()
export class BitgetSetupChartService {
  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly bitget: BitgetService,
  ) {}

  async generateChart(symbol: string, timeframe = 'M30'): Promise<Buffer> {
    const bare = bareSymbol(symbol);
    const pair = `${bare}USDT`;
    const tf = TF_CONFIG[timeframe] ? timeframe : 'M30';
    const { limit, display } = TF_CONFIG[tf]!;

    const klines = await this.binance.fetchKlines({
      symbol: pair,
      timeframe: tf as never,
      limit,
    });
    if (klines.length === 0) {
      throw new NotFoundException(`No ${tf} candles for ${pair}`);
    }

    const candles: OhlcCandle[] = klines.map((k) => ({
      time: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    const markers = await this.buildMarkers(bare);

    return renderSetupChart({
      symbol: pair,
      timeframe: tf,
      candles,
      currentPrice: candles[candles.length - 1]!.close,
      display,
      markers,
    });
  }

  /**
   * Entry/exit annotations for this coin: every live open position (entry line +
   * uPnL) plus the most recent closed trade that closed within the last 30
   * minutes (entry + close lines with realized PnL) — once a trade has been shut
   * longer than that the markers drop off. All lookups are non-fatal — the chart
   * still renders if Bitget/DB are unavailable.
   */
  private async buildMarkers(bare: string): Promise<ChartMarker[]> {
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

    const recentlyClosedAfter = Date.now() - 30 * 60 * 1000;
    const history = await this.bitget.getClosedHistory(50, `${bare}USDT`).catch(() => null);
    const recentClosed = (history?.trades ?? [])
      .filter(
        (t) =>
          bareSymbol(t.symbol) === bare &&
          new Date(t.closedAt).getTime() >= recentlyClosedAfter &&
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
