import { Injectable, Logger } from '@nestjs/common';
import {
  computeSmallCapSignal,
  computeTimeframeTrend,
  computeLongShortScore,
  calculateEma,
  calculateRsi,
  calculateVolumeRatio,
  calcUtBotResult,
} from '@app/core';
import type { PaTrend } from '@app/core';
import { createTrackingCoinsRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

const CANDLE_LIMIT = 220;

@Injectable()
export class TrackingCoinScanService {
  private readonly logger = new Logger(TrackingCoinScanService.name);
  private readonly repo = createTrackingCoinsRepository();

  constructor(private readonly binance: BinanceMarketDataService) {}

  async scanAll(): Promise<{ scanned: number; failed: number }> {
    const coins = await this.repo.findAllCoins();
    let scanned = 0;
    let failed = 0;

    for (const coin of coins) {
      try {
        await this.scanOne(coin.id, coin.symbol);
        scanned++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`scan failed for ${coin.symbol}: ${msg}`);
      }
    }

    this.logger.log(`Tracking-coin scan done — scanned: ${scanned}, failed: ${failed}`);
    return { scanned, failed };
  }

  private async scanOne(coinId: string, symbol: string): Promise<void> {
    const binanceSymbol = `${symbol}USDT`;

    const [klines, h4Klines, m30Klines] = await Promise.all([
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1d', limit: CANDLE_LIMIT }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '4h', limit: 200 }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: 'M30', limit: 300 }),
    ]);

    if (klines.length < 210) return;

    const closes  = klines.map((k) => parseFloat(k[4]));
    const highs   = klines.map((k) => parseFloat(k[2]));
    const lows    = klines.map((k) => parseFloat(k[3]));
    const volumes = klines.map((k) => parseFloat(k[5]));

    const result = computeSmallCapSignal(closes, highs, lows, volumes);
    if (!result) return;

    const h4Closes  = h4Klines.map((k) => parseFloat(k[4]));
    const h4Highs   = h4Klines.map((k) => parseFloat(k[2]));
    const h4Lows    = h4Klines.map((k) => parseFloat(k[3]));
    const h4Volumes = h4Klines.map((k) => parseFloat(k[5]));

    const h4Trend = h4Klines.length >= 20
      ? computeTimeframeTrend(h4Closes, h4Highs, h4Lows)
      : 'Neutral';

    const m30Trend = m30Klines.length >= 20
      ? computeTimeframeTrend(
          m30Klines.map((k) => parseFloat(k[4])),
          m30Klines.map((k) => parseFloat(k[2])),
          m30Klines.map((k) => parseFloat(k[3])),
        )
      : 'Neutral';

    const h4LastClose = h4Closes[h4Closes.length - 1] ?? 0;
    const h4Ema34Above  = h4Closes.length >= 34  ? h4LastClose > calculateEma(h4Closes, 34)  : null;
    const h4Ema89Above  = h4Closes.length >= 89  ? h4LastClose > calculateEma(h4Closes, 89)  : null;
    const h4Ema200Above = h4Closes.length >= 200 ? h4LastClose > calculateEma(h4Closes, 200) : null;
    const h4Rsi           = h4Closes.length > 14  ? calculateRsi(h4Closes, 14) : null;
    const h4VolMultiplier = h4Volumes.length >= 20 ? calculateVolumeRatio(h4Volumes, 20) : null;

    const d1Candles = closes.map((c, i) => ({ open: c, high: highs[i]!, low: lows[i]!, close: c }));
    const utBotD1Bullish = calcUtBotResult(d1Candles, 1, 3)?.uptrend ?? null;

    const h4Candles = h4Closes.length >= 2
      ? h4Closes.map((c, i) => ({ open: c, high: h4Highs[i]!, low: h4Lows[i]!, close: c }))
      : [];
    const utBotH4Bullish = h4Candles.length >= 2 ? (calcUtBotResult(h4Candles, 1, 3)?.uptrend ?? null) : null;

    const { longScore, shortScore } = computeLongShortScore({
      closes,
      highs,
      lows,
      rsi: result.rsi,
      volMultiplier: result.volMultiplier,
      ema34Above: result.ema34Above,
      ema89Above: result.ema89Above,
      ema200Above: result.ema200Above,
      d1Trend: result.trend as PaTrend,
      h4Trend: h4Trend as PaTrend,
      m30Trend: m30Trend as PaTrend,
      sparkline: result.sparkline,
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await this.repo.upsertSignal(coinId, today, {
      rsi: result.rsi,
      volMultiplier: result.volMultiplier,
      ema34Above: result.ema34Above,
      ema89Above: result.ema89Above,
      ema200Above: result.ema200Above,
      stage: result.stage,
      signalScore: result.signalScore,
      sparklineJson: JSON.stringify(result.sparkline),
      trend: result.trend,
      h4Trend,
      m30Trend,
      swingStructure: result.swingStructure,
      longScore,
      shortScore,
      h4Ema34Above,
      h4Ema89Above,
      h4Ema200Above,
      utBotD1Bullish,
      utBotH4Bullish,
      h4Rsi,
      h4VolMultiplier,
    });
  }
}
