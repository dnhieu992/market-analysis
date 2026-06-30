import { Injectable, Logger } from '@nestjs/common';
import {
  computeSmallCapSignal,
  computeTimeframeTrend,
  computeLongShortScore,
  computeEntryScore,
  computeDcaScore,
  computeAccumulationSignal,
  dcaZone,
  dcaQualityBucket,
  calculateEma,
  calculateRsi,
  calculateVolumeRatio,
  calcUtBotResult,
  calculateAtr,
  computeSwingLimitOrder,
  evaluateLimitOrder,
} from '@app/core';
import type { PaTrend, OrderSigSnapshot, LimitOrderResult } from '@app/core';
import { createTrackingCoinsRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { TrackingCoinReviewService } from './tracking-coin-review.service';

const CANDLE_LIMIT = 220;

// P4 — order expiry windows (after which an unfilled/unresolved order is closed).
const SWING_EXPIRY_DAYS = 5;
const DAYTRADE_EXPIRY_DAYS = 1;

@Injectable()
export class TrackingCoinScanService {
  private readonly logger = new Logger(TrackingCoinScanService.name);
  private readonly repo = createTrackingCoinsRepository();

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly reviewService: TrackingCoinReviewService,
  ) {}

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

  // P3 — minRR gate: drop an otherwise-valid order whose R:R is below the coin's
  // configured minimum (null setup = no gate). Returns null = no-trade.
  private gateByMinRr(order: LimitOrderResult | null, minRr: number | null | undefined): LimitOrderResult | null {
    if (!order) return null;
    if (minRr != null && order.rrRatio < minRr) return null;
    return order;
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
    setup?: {
      marketCap?: number | null;
      swingMaxLoss?: number | null;
      daytradeMaxLoss?: number | null;
      swingMinRR?: number | null;
      daytradeMinRR?: number | null;
    } | null,
  ): Promise<void> {
    const binanceSymbol = `${symbol}USDT`;

    const [klines, h4Klines, m30Klines, h1Klines, wKlines] = await Promise.all([
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1d', limit: CANDLE_LIMIT }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '4h', limit: 200 }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: 'M30', limit: 300 }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1h', limit: 72 }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1w', limit: 300 }),
    ]);

    if (klines.length < 210) return;

    const closes  = klines.map((k) => parseFloat(k[4]));
    const highs   = klines.map((k) => parseFloat(k[2]));
    const lows    = klines.map((k) => parseFloat(k[3]));
    const volumes = klines.map((k) => parseFloat(k[5]));

    const result = computeSmallCapSignal(closes, highs, lows, volumes);
    if (!result) return;

    // % the last close sits above the rolling 20-day low (DCA dip-depth gauge).
    const lastClose = closes[closes.length - 1]!;
    const low20 = Math.min(...lows.slice(-20));
    const low20Pct = low20 > 0 ? Number((((lastClose - low20) / low20) * 100).toFixed(1)) : null;

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
    const utBotD1Bullish = calcUtBotResult(d1Candles, 10, 3)?.uptrend ?? null;

    const h4Candles = h4Closes.length >= 2
      ? h4Closes.map((c, i) => ({ open: c, high: h4Highs[i]!, low: h4Lows[i]!, close: c }))
      : [];
    const utBotH4Bullish = h4Candles.length >= 2 ? (calcUtBotResult(h4Candles, 10, 3)?.uptrend ?? null) : null;

    // ── M30 timeframe — display-only signal (not fed into any scoring/logic) ──
    const m30Closes  = m30Klines.map((k) => parseFloat(k[4]));
    const m30Highs   = m30Klines.map((k) => parseFloat(k[2]));
    const m30Lows    = m30Klines.map((k) => parseFloat(k[3]));
    const m30Volumes = m30Klines.map((k) => parseFloat(k[5]));
    const m30LastClose = m30Closes[m30Closes.length - 1] ?? 0;
    const m30Ema34Above  = m30Closes.length >= 34  ? m30LastClose > calculateEma(m30Closes, 34)  : null;
    const m30Ema89Above  = m30Closes.length >= 89  ? m30LastClose > calculateEma(m30Closes, 89)  : null;
    const m30Ema200Above = m30Closes.length >= 200 ? m30LastClose > calculateEma(m30Closes, 200) : null;
    const m30Rsi           = m30Closes.length > 14  ? calculateRsi(m30Closes, 14) : null;
    const m30VolMultiplier = m30Volumes.length >= 20 ? calculateVolumeRatio(m30Volumes, 20) : null;
    const m30Candles = m30Closes.length >= 2
      ? m30Closes.map((c, i) => ({ open: c, high: m30Highs[i]!, low: m30Lows[i]!, close: c }))
      : [];
    const utBotM30Bullish = m30Candles.length >= 2 ? (calcUtBotResult(m30Candles, 10, 3)?.uptrend ?? null) : null;

    // ── Weekly (W1) timeframe — same indicators/setup as D1/H4 ──────────
    const wCloses  = wKlines.map((k) => parseFloat(k[4]));
    const wHighs   = wKlines.map((k) => parseFloat(k[2]));
    const wLows    = wKlines.map((k) => parseFloat(k[3]));
    const wVolumes = wKlines.map((k) => parseFloat(k[5]));
    const wLastClose = wCloses[wCloses.length - 1] ?? 0;

    const weekTrend = wKlines.length >= 20 ? computeTimeframeTrend(wCloses, wHighs, wLows) : 'Neutral';
    const wEma34Above  = wCloses.length >= 34  ? wLastClose > calculateEma(wCloses, 34)  : null;
    const wEma89Above  = wCloses.length >= 89  ? wLastClose > calculateEma(wCloses, 89)  : null;
    const wEma200Above = wCloses.length >= 200 ? wLastClose > calculateEma(wCloses, 200) : null;
    const wRsi           = wCloses.length > 14  ? calculateRsi(wCloses, 14) : null;
    const wVolMultiplier = wVolumes.length >= 20 ? calculateVolumeRatio(wVolumes, 20) : null;
    const wCandles = wCloses.length >= 2
      ? wCloses.map((c, i) => ({ open: c, high: wHighs[i]!, low: wLows[i]!, close: c }))
      : [];
    const utBotW1Bullish = wCandles.length >= 2 ? (calcUtBotResult(wCandles, 10, 3)?.uptrend ?? null) : null;

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

    // Build today's swing order first so its R:R can feed the entry score.
    const currentPrice = h4Closes[h4Closes.length - 1] ?? 0;
    const sigSnap: OrderSigSnapshot = {
      trend: result.trend,
      h4Trend,
      m30Trend,
      utBotD1Bullish,
      utBotH4Bullish,
      utBotW1Bullish,
      longScore,
      shortScore,
      ema200Above: result.ema200Above,
      rsi: result.rsi,
      h4Rsi,
      swingStructure: result.swingStructure,
    };
    const h4Atr = calculateAtr(h4Highs, h4Lows, h4Closes, 14);
    const rawSwingOrder = currentPrice > 0
      ? computeSwingLimitOrder(currentPrice, h4Highs, h4Lows, sigSnap, h4Atr)
      : null;

    // Entry Score — low-risk-entry gauge (risk-management oriented).
    // Uses the raw order's R:R (pre minRR-gate) so the score reflects setup
    // quality independent of the coin's user-configured minRR.
    const { entryScore } = computeEntryScore({
      extPct: result.extPct,
      ema200Above: result.ema200Above,
      d1Trend: result.trend as PaTrend,
      weekTrend: weekTrend as PaTrend,
      rsi: result.rsi,
      volMultiplier: result.volMultiplier,
      utBotW1Bullish,
      utBotD1Bullish,
      utBotH4Bullish,
      rrRatio: rawSwingOrder?.rrRatio ?? null,
    });

    // DCA-worthiness — "how safe is it to DCA this coin?" (market-cap + weekly trend).
    const dcaScore = computeDcaScore({
      marketCap: setup?.marketCap ?? null,
      weekTrend: weekTrend as PaTrend,
      wEma89Above,
      wEma200Above,
      utBotW1Bullish,
    });

    // Accumulation-zone DCA signal (spot, no SL) — gated by dcaScore survival filter.
    const acc = computeAccumulationSignal({
      closesD1: closes,
      highsD1: highs,
      lowsD1: lows,
      weeklyHighs: wHighs,
      dcaScore,
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
      entryScore,
      dcaScore,
      extPct: result.extPct,
      low20Pct,
      sparklineJson: JSON.stringify(result.sparkline),
      weekTrend,
      trend: result.trend,
      h4Trend,
      m30Trend,
      swingStructure: result.swingStructure,
      longScore,
      shortScore,
      utBotW1Bullish,
      utBotD1Bullish,
      utBotH4Bullish,
      wEma34Above,
      wEma89Above,
      wEma200Above,
      wRsi,
      wVolMultiplier,
      h4Ema34Above,
      h4Ema89Above,
      h4Ema200Above,
      h4Rsi,
      h4VolMultiplier,
      utBotM30Bullish,
      m30Ema34Above,
      m30Ema89Above,
      m30Ema200Above,
      m30Rsi,
      m30VolMultiplier,
      accZone: acc?.zone ?? null,
      accDrawdownPct: acc?.drawdownPct ?? null,
      accBaseWidthPct: acc?.baseWidthPct ?? null,
      accInBase: acc?.inBase ?? null,
      accGatePassed: acc?.gatePassed ?? null,
    });

    // ── DCA signal history — append only when zone/bucket changes ──────
    const zone = dcaZone({ ema34Above: result.ema34Above, rsi: result.rsi ?? 50, low20Pct });
    await this.repo.logSignalHistoryIfChanged(coinId, {
      dcaScore,
      dcaZone: zone,
      dcaBucket: dcaQualityBucket(dcaScore),
      trend: result.trend,
      weekTrend,
      h4Trend,
      rsi: result.rsi,
      extPct: result.extPct,
      price: currentPrice > 0 ? currentPrice : null,
    });

    // ── Daily LLM (Haiku) review of an OPEN holding (holding > 0 only) ──
    await this.reviewHoldingIfDue(coinId, symbol, currentPrice, {
      weekTrend,
      trend: result.trend,
      h4Trend,
      dcaScore,
      dcaZone: zone,
      dcaBucket: dcaQualityBucket(dcaScore),
      rsi: result.rsi,
      extPct: result.extPct,
      utBotW1Bullish,
      utBotD1Bullish,
      utBotH4Bullish,
    });

    // ── Generate & persist today's orders ──────────────────────────────
    if (currentPrice > 0) {
      const swingOrder = this.gateByMinRr(rawSwingOrder, setup?.swingMinRR);

      // Day-trade removed from tracking-coins — only swing; clear stale day-trade order.
      await Promise.all([
        swingOrder
          ? this.repo.upsertOrder(coinId, today, 'swing', { ...swingOrder, ...this.calcVolume(swingOrder, setup?.swingMaxLoss) })
          : this.repo.deleteOrder(coinId, today, 'swing'),
        this.repo.deleteOrder(coinId, today, 'daytrade'),
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

      // P4: only score candles within the order's lifetime — a day-trade must not
      // be evaluated over many days of H1 candles (it would eventually hit SL).
      const isSwing = order.type === 'swing';
      const candlesPerDay = isSwing ? 6 : 24;        // H4 vs H1
      const expiryDays = isSwing ? SWING_EXPIRY_DAYS : DAYTRADE_EXPIRY_DAYS;
      const srcHighs = isSwing ? h4Highs : h1Highs;
      const srcLows  = isSwing ? h4Lows  : h1Lows;

      const skip = Math.max(0, srcHighs.length - daysAgo * candlesPerDay);     // ≈ order placement
      const maxCandles = expiryDays * candlesPerDay;                            // expiry window
      const candleHighs = srcHighs.slice(skip, skip + maxCandles);
      const candleLows  = srcLows.slice(skip, skip + maxCandles);

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

      // P4: if no TP/SL hit and the order has outlived its window → expired.
      const outcome = !eval_.outcome && daysAgo > expiryDays ? 'expired' : eval_.outcome;

      await this.repo.updateOrderEvaluation(order.id, eval_.activated, outcome);
    }
  }

  /**
   * Once per calendar day (UTC), ask Claude Haiku to review an OPEN holding and
   * append the verdict to the signal-history feed. No-op for coins not holding (>0)
   * and for coins already reviewed today. Non-fatal — never throws into the scan.
   */
  private async reviewHoldingIfDue(
    coinId: string,
    symbol: string,
    currentPrice: number,
    signal: {
      weekTrend: string; trend: string; h4Trend: string;
      dcaScore: number; dcaZone: string | null; dcaBucket: string;
      rsi: number | null; extPct: number | null;
      utBotW1Bullish: boolean | null; utBotD1Bullish: boolean | null; utBotH4Bullish: boolean | null;
    },
  ): Promise<void> {
    try {
      if (currentPrice <= 0) return;

      const buys = await this.repo.findDcaBuysByCoin(coinId);
      let coins = 0;
      let cost = 0;
      let nSignal = 0;
      let nFomo = 0;
      for (const b of buys) {
        if (b.price > 0) coins += b.usd / b.price;
        cost += b.usd;
        if (b.entryMode === 'SIGNAL') nSignal++;
        else if (b.entryMode === 'FOMO') nFomo++;
      }
      if (coins <= 0) return; // not holding → skip LLM

      // Dedupe to once per UTC day.
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);
      if (await this.repo.hasHoldingReviewSince(coinId, startOfToday)) return;

      const avgEntry = coins > 0 ? cost / coins : 0;
      const pnlPct = avgEntry > 0 ? ((currentPrice - avgEntry) / avgEntry) * 100 : 0;
      const entryMode: 'SIGNAL' | 'FOMO' | 'MIXED' =
        nSignal > 0 && nFomo > 0 ? 'MIXED' : nFomo > 0 ? 'FOMO' : 'SIGNAL';

      const review = await this.reviewService.review({
        symbol,
        position: { layers: buys.length, avgEntry, capitalDeployed: cost, entryMode },
        currentPrice,
        pnlPct,
        signal,
      });
      if (!review) return; // LLM failure is non-fatal — no row written

      await this.repo.appendHoldingReview(coinId, {
        dcaScore: signal.dcaScore,
        dcaZone: signal.dcaZone,
        dcaBucket: signal.dcaBucket,
        trend: signal.trend,
        weekTrend: signal.weekTrend,
        h4Trend: signal.h4Trend,
        rsi: signal.rsi,
        extPct: signal.extPct,
        price: currentPrice,
        entryMode,
        avgEntry,
        pnlPct,
        llmVerdict: review.verdict,
        llmReview: review.reason,
        llmModel: review.model,
      });
      this.logger.log(`Holding review ${symbol}: ${review.verdict} (PnL ${pnlPct.toFixed(1)}%)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Holding review ${symbol} skipped: ${msg}`);
    }
  }
}
