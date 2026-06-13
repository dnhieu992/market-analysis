import { Injectable, Logger } from '@nestjs/common';
import {
  computeSmallCapSignal,
  computeTimeframeTrend,
  computeLongShortScore,
  calculateEma,
  calculateRsi,
  calculateVolumeRatio,
  calcUtBotResult,
  computeSwingLimitOrder,
  computeDayTradeLimitOrder,
  evaluateLimitOrder,
} from '@app/core';
import type { PaTrend, OrderSigSnapshot, LimitOrderResult } from '@app/core';
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
        await this.scanOne(coin.id, coin.symbol, coin);
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

  private calcVolume(order: LimitOrderResult, maxLoss: number | null | undefined): { positionSize: number; positionValue: number } | null {
    if (!maxLoss || maxLoss <= 0) return null;
    const entryMid = (order.entryLow + order.entryHigh) / 2;
    const risk = order.side === 'LONG' ? entryMid - order.sl : order.sl - entryMid;
    if (risk <= 0) return null;
    const positionSize = maxLoss / risk;
    return { positionSize, positionValue: positionSize * entryMid };
  }

  private async scanOne(
    coinId: string,
    symbol: string,
    setup?: { swingMaxLoss?: number | null; daytradeMaxLoss?: number | null } | null,
  ): Promise<void> {
    const binanceSymbol = `${symbol}USDT`;

    const [klines, h4Klines, m30Klines, h1Klines] = await Promise.all([
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1d', limit: CANDLE_LIMIT }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '4h', limit: 200 }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: 'M30', limit: 300 }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1h', limit: 72 }),
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

    // ── Generate & persist today's orders ──────────────────────────────
    const currentPrice = h4Closes[h4Closes.length - 1] ?? 0;
    if (currentPrice > 0) {
      const sigSnap: OrderSigSnapshot = {
        trend: result.trend,
        h4Trend,
        m30Trend,
        utBotD1Bullish,
        utBotH4Bullish,
        longScore,
        shortScore,
        ema200Above: result.ema200Above,
        rsi: result.rsi,
        h4Rsi,
        swingStructure: result.swingStructure,
      };

      const h1Highs = h1Klines.map((k) => parseFloat(k[2]));
      const h1Lows  = h1Klines.map((k) => parseFloat(k[3]));

      const swingOrder    = computeSwingLimitOrder(currentPrice, h4Highs, h4Lows, sigSnap);
      const dayTradeOrder = computeDayTradeLimitOrder(currentPrice, h1Highs, h1Lows, sigSnap);
      const swingVol    = this.calcVolume(swingOrder, setup?.swingMaxLoss);
      const dayTradeVol = this.calcVolume(dayTradeOrder, setup?.daytradeMaxLoss);

      await Promise.all([
        this.repo.upsertOrder(coinId, today, 'swing',    { ...swingOrder,    ...swingVol }),
        this.repo.upsertOrder(coinId, today, 'daytrade', { ...dayTradeOrder, ...dayTradeVol }),
      ]);
    }

    // ── Evaluate unresolved past orders ────────────────────────────────
    const unresolved = await this.repo.findUnresolvedOrders(coinId);
    const h1Highs = h1Klines.map((k) => parseFloat(k[2]));
    const h1Lows  = h1Klines.map((k) => parseFloat(k[3]));

    for (const order of unresolved) {
      // Skip today's freshly created orders
      if (order.date.getTime() >= today.getTime()) continue;

      const daysAgo = Math.ceil((today.getTime() - order.date.getTime()) / (1000 * 60 * 60 * 24));

      let candleHighs: number[];
      let candleLows: number[];

      if (order.type === 'swing') {
        const candlesPerDay = 6; // H4
        const skip = Math.max(0, h4Highs.length - daysAgo * candlesPerDay);
        candleHighs = h4Highs.slice(skip);
        candleLows  = h4Lows.slice(skip);
      } else {
        const candlesPerDay = 24; // H1
        const skip = Math.max(0, h1Highs.length - daysAgo * candlesPerDay);
        candleHighs = h1Highs.slice(skip);
        candleLows  = h1Lows.slice(skip);
      }

      if (candleHighs.length === 0) continue;

      const eval_ = evaluateLimitOrder(
        order.side as 'LONG' | 'SHORT',
        order.entryLow,
        order.entryHigh,
        order.tp1,
        order.tp2 ?? null,
        order.sl,
        candleHighs,
        candleLows,
      );

      await this.repo.updateOrderEvaluation(order.id, eval_.activated, eval_.outcome);
    }
  }
}
