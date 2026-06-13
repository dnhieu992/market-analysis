import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { computeSmallCapSignal, computeTimeframeTrend, computeLongShortScore, calculateEma, calculateRsi, calculateVolumeRatio, calcUtBotResult, computeSwingLimitOrder, computeDayTradeLimitOrder } from '@app/core';
import type { PaTrend, OrderSigSnapshot, LimitOrderResult } from '@app/core';
import { createTrackingCoinsRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

const CANDLE_LIMIT = 220;

type CoinSetup = {
  swingMaxLoss: number | null;
  swingMinRR: number | null;
  daytradeMaxLoss: number | null;
  daytradeMinRR: number | null;
};

function calcVolume(order: LimitOrderResult, maxLoss: number | null): { positionSize: number; positionValue: number } | null {
  if (!maxLoss || maxLoss <= 0) return null;
  const entryMid = (order.entryLow + order.entryHigh) / 2;
  const risk = order.side === 'LONG' ? entryMid - order.sl : order.sl - entryMid;
  if (risk <= 0) return null;
  const positionSize = maxLoss / risk;
  return { positionSize, positionValue: positionSize * entryMid };
}

export type SavedOrderSuggestion = LimitOrderResult & { id: string; notes: string | null };

export type OrderSuggestionsResult = {
  symbol: string;
  currentPrice: number;
  swing: SavedOrderSuggestion;
  scalp: SavedOrderSuggestion;
  generatedAt: string;
};

export type TrackingCoinWithSignal = {
  id: string;
  symbol: string;
  name: string;
  addedAt: Date;
  signal: {
    rsi: number | null;
    volMultiplier: number | null;
    ema34Above: boolean;
    ema89Above: boolean;
    ema200Above: boolean;
    h4Ema34Above: boolean | null;
    h4Ema89Above: boolean | null;
    h4Ema200Above: boolean | null;
    utBotD1Bullish: boolean | null;
    utBotH4Bullish: boolean | null;
    h4Rsi: number | null;
    h4VolMultiplier: number | null;
    longScore: number | null;
    shortScore: number | null;
    signalScore: number;
    sparkline: number[];
    trend: string;
    h4Trend: string;
    m30Trend: string;
    swingStructure: string;
    scannedAt: Date;
  } | null;
};

@Injectable()
export class TrackingCoinsService {
  private readonly logger = new Logger(TrackingCoinsService.name);
  private readonly repo = createTrackingCoinsRepository();

  constructor(private readonly binance: BinanceMarketDataService) {}

  /**
   * Proxy raw OHLCV klines from Binance (server-side, avoids browser CORS/geo
   * restrictions). Used by the tracking-coins prompt generator to embed candles.
   */
  async fetchKlines(symbol: string, interval: string, limit: number) {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 1000);
    // Coins are stored bare (e.g. "ADA"); Binance needs the full pair ("ADAUSDT").
    // Match the scan convention in scanOneCoin so both paths hit the same market.
    const upper = symbol.toUpperCase();
    const binanceSymbol = upper.endsWith('USDT') ? upper : `${upper}USDT`;
    return this.binance.fetchKlines({
      symbol: binanceSymbol,
      timeframe: interval as never,
      limit: safeLimit,
    });
  }

  async listCoins(): Promise<TrackingCoinWithSignal[]> {
    const rows = await this.repo.findCoinsWithLatestSignal();
    return rows.map((coin) => {
      const sig = coin.signals[0] ?? null;
      return {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        addedAt: coin.addedAt,
        signal: sig
          ? {
              rsi: sig.rsi,
              volMultiplier: sig.volMultiplier,
              ema34Above: sig.ema34Above,
              ema89Above: sig.ema89Above,
              ema200Above: sig.ema200Above,
              h4Ema34Above: sig.h4Ema34Above,
              h4Ema89Above: sig.h4Ema89Above,
              h4Ema200Above: sig.h4Ema200Above,
              utBotD1Bullish: sig.utBotD1Bullish,
              utBotH4Bullish: sig.utBotH4Bullish,
              h4Rsi: sig.h4Rsi,
              h4VolMultiplier: sig.h4VolMultiplier,
              longScore: sig.longScore,
              shortScore: sig.shortScore,
              signalScore: sig.signalScore,
              sparkline: this.parseSparkline(sig.sparklineJson),
              trend: sig.trend,
              h4Trend: sig.h4Trend,
              m30Trend: sig.m30Trend,
              swingStructure: sig.swingStructure,
              scannedAt: sig.scannedAt,
            }
          : null,
      };
    });
  }

  async addCoin(symbol: string, name?: string): Promise<{ id: string; symbol: string; name: string }> {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.addCoin(upper, name ?? '');
    return { id: coin.id, symbol: coin.symbol, name: coin.name };
  }

  async removeCoin(symbol: string): Promise<void> {
    const upper = symbol.toUpperCase();
    const existing = await this.repo.findCoinBySymbol(upper);
    if (!existing) throw new NotFoundException(`Coin ${upper} not found`);
    await this.repo.removeCoin(upper);
  }

  async listJournal(symbol: string) {
    const coin = await this.repo.findCoinBySymbol(symbol.toUpperCase());
    if (!coin) throw new NotFoundException(`Coin ${symbol.toUpperCase()} not found`);
    const entries = await this.repo.findJournalByCoin(coin.id);
    return entries.map((e) => ({
      id: e.id,
      date: e.date.toISOString().slice(0, 10),
      content: e.content,
      updatedAt: e.updatedAt.toISOString(),
    }));
  }

  async upsertJournalEntry(symbol: string, date: string, content: string) {
    const coin = await this.repo.findCoinBySymbol(symbol.toUpperCase());
    if (!coin) throw new NotFoundException(`Coin ${symbol.toUpperCase()} not found`);
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    const entry = await this.repo.upsertJournalEntry(coin.id, d, content);
    return {
      id: entry.id,
      date: entry.date.toISOString().slice(0, 10),
      content: entry.content,
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  async triggerScan(): Promise<{ scanned: number; failed: number }> {
    const coins = await this.repo.findAllCoins();
    let scanned = 0;
    let failed = 0;

    for (const coin of coins) {
      try {
        await this.scanOneCoin(coin.id, coin.symbol, coin);
        scanned++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`scan failed for ${coin.symbol}: ${msg}`);
      }
    }

    return { scanned, failed };
  }

  async suggestOrders(symbol: string): Promise<OrderSuggestionsResult> {
    const upper = symbol.toUpperCase();
    const coins = await this.repo.findCoinsWithLatestSignal();
    const coin = coins.find((c) => c.symbol === upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);

    const sig = coin.signals[0] ?? null;
    const binanceSymbol = `${upper}USDT`;

    const [[h4Klines, h1Klines], currentPrice] = await Promise.all([
      Promise.all([
        this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '4h', limit: 60 }),
        this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1h', limit: 72 }),
      ]),
      this.binance.fetchCurrentPrice(binanceSymbol).catch(() => 0),
    ]);

    const h4Highs = h4Klines.map((k) => parseFloat(k[2]));
    const h4Lows  = h4Klines.map((k) => parseFloat(k[3]));
    const h1Highs = h1Klines.map((k) => parseFloat(k[2]));
    const h1Lows  = h1Klines.map((k) => parseFloat(k[3]));

    const price = currentPrice || (h4Klines.length > 0 ? parseFloat(h4Klines[h4Klines.length - 1]![4]) : 0);

    const sigSnap: OrderSigSnapshot | null = sig ? {
      trend: sig.trend,
      h4Trend: sig.h4Trend,
      m30Trend: sig.m30Trend,
      utBotD1Bullish: sig.utBotD1Bullish,
      utBotH4Bullish: sig.utBotH4Bullish,
      longScore: sig.longScore,
      shortScore: sig.shortScore,
      ema200Above: sig.ema200Above,
      rsi: sig.rsi,
      h4Rsi: sig.h4Rsi,
      swingStructure: sig.swingStructure,
    } : null;

    const swing = computeSwingLimitOrder(price, h4Highs, h4Lows, sigSnap);
    const scalp = computeDayTradeLimitOrder(price, h1Highs, h1Lows, sigSnap);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const setup = await this.repo.findCoinBySymbol(upper);
    const swingVol  = calcVolume(swing,  setup?.swingMaxLoss    ?? null);
    const scalpVol  = calcVolume(scalp,  setup?.daytradeMaxLoss ?? null);

    const [swingRecord, scalpRecord] = await Promise.all([
      this.repo.upsertOrder(coin.id, today, 'swing',    { ...swing,  ...swingVol }),
      this.repo.upsertOrder(coin.id, today, 'daytrade', { ...scalp, ...scalpVol }),
    ]);

    return {
      symbol: upper,
      currentPrice: price,
      swing:  { ...swing,  id: swingRecord.id,  notes: swingRecord.notes  ?? null },
      scalp:  { ...scalp,  id: scalpRecord.id,  notes: scalpRecord.notes  ?? null },
      generatedAt: new Date().toISOString(),
    };
  }

  async updateOrderNotes(orderId: string, notes: string | null): Promise<void> {
    await this.repo.updateOrderNotes(orderId, notes);
  }

  async listOrders(symbol: string) {
    const coin = await this.repo.findCoinBySymbol(symbol.toUpperCase());
    if (!coin) throw new NotFoundException(`Coin ${symbol.toUpperCase()} not found`);
    const orders = await this.repo.findOrdersByCoin(coin.id);
    return orders.map((o) => ({
      id: o.id,
      date: o.date.toISOString().slice(0, 10),
      type: o.type,
      side: o.side,
      entryLow: o.entryLow,
      entryHigh: o.entryHigh,
      tp1: o.tp1,
      tp2: o.tp2 ?? null,
      sl: o.sl,
      rrRatio: o.rrRatio,
      rationale: o.rationale,
      notes: o.notes ?? null,
      positionSize: o.positionSize ?? null,
      positionValue: o.positionValue ?? null,
      activated: o.activated ?? null,
      outcome: o.outcome ?? null,
      evaluatedAt: o.evaluatedAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
    }));
  }

  async getSetup(symbol: string) {
    const coin = await this.repo.findCoinBySymbol(symbol.toUpperCase());
    if (!coin) throw new NotFoundException(`Coin ${symbol.toUpperCase()} not found`);
    return {
      swingMaxLoss: coin.swingMaxLoss ?? null,
      swingMinRR: coin.swingMinRR ?? null,
      daytradeMaxLoss: coin.daytradeMaxLoss ?? null,
      daytradeMinRR: coin.daytradeMinRR ?? null,
    };
  }

  async updateSetup(symbol: string, data: CoinSetup) {
    const coin = await this.repo.findCoinBySymbol(symbol.toUpperCase());
    if (!coin) throw new NotFoundException(`Coin ${symbol.toUpperCase()} not found`);
    await this.repo.updateCoinSetup(coin.id, data);
    return { symbol: symbol.toUpperCase(), ...data };
  }

  private async scanOneCoin(coinId: string, symbol: string, setup?: CoinSetup | null): Promise<void> {
    const binanceSymbol = `${symbol}USDT`;

    const [klines, h4Klines, m30Klines, h1Klines] = await Promise.all([
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1d', limit: CANDLE_LIMIT }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '4h', limit: 200 }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: 'M30', limit: 300 }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1h', limit: 72 }),
    ]);

    if (klines.length < 210) return;

    const closes = klines.map((k) => parseFloat(k[4]));
    const highs = klines.map((k) => parseFloat(k[2]));
    const lows = klines.map((k) => parseFloat(k[3]));
    const volumes = klines.map((k) => parseFloat(k[5]));

    const result = computeSmallCapSignal(closes, highs, lows, volumes);
    if (!result) return;

    const h4Trend = h4Klines.length >= 20
      ? computeTimeframeTrend(
          h4Klines.map((k) => parseFloat(k[4])),
          h4Klines.map((k) => parseFloat(k[2])),
          h4Klines.map((k) => parseFloat(k[3])),
        )
      : 'Neutral';

    const m30Trend = m30Klines.length >= 20
      ? computeTimeframeTrend(
          m30Klines.map((k) => parseFloat(k[4])),
          m30Klines.map((k) => parseFloat(k[2])),
          m30Klines.map((k) => parseFloat(k[3])),
        )
      : 'Neutral';

    // H4 indicators
    const h4Closes = h4Klines.map((k) => parseFloat(k[4]));
    const h4Highs  = h4Klines.map((k) => parseFloat(k[2]));
    const h4Lows   = h4Klines.map((k) => parseFloat(k[3]));
    const h4LastClose = h4Closes[h4Closes.length - 1] ?? 0;

    const h4Ema34Above  = h4Closes.length >= 34  ? h4LastClose > calculateEma(h4Closes, 34)  : null;
    const h4Ema89Above  = h4Closes.length >= 89  ? h4LastClose > calculateEma(h4Closes, 89)  : null;
    const h4Ema200Above = h4Closes.length >= 200 ? h4LastClose > calculateEma(h4Closes, 200) : null;
    const h4Volumes = h4Klines.map((k) => parseFloat(k[5]));
    const h4Rsi           = h4Closes.length > 14 ? calculateRsi(h4Closes, 14) : null;
    const h4VolMultiplier = h4Volumes.length >= 20 ? calculateVolumeRatio(h4Volumes, 20) : null;

    // UT Bot D1
    const d1Candles = closes.map((c, i) => ({ open: c, high: highs[i]!, low: lows[i]!, close: c }));
    const utBotD1 = calcUtBotResult(d1Candles, 1, 3);
    const utBotD1Bullish = utBotD1?.uptrend ?? null;

    // UT Bot H4
    const h4Candles = h4Closes.length >= 2
      ? h4Closes.map((c, i) => ({ open: c, high: h4Highs[i]!, low: h4Lows[i]!, close: c }))
      : [];
    const utBotH4 = h4Candles.length >= 2 ? calcUtBotResult(h4Candles, 1, 3) : null;
    const utBotH4Bullish = utBotH4?.uptrend ?? null;

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

    // Regenerate today's orders so re-analyze keeps limit levels fresh
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
      const swingVol    = calcVolume(swingOrder, setup?.swingMaxLoss ?? null);
      const dayTradeVol = calcVolume(dayTradeOrder, setup?.daytradeMaxLoss ?? null);
      await Promise.all([
        this.repo.upsertOrder(coinId, today, 'swing',    { ...swingOrder,    ...swingVol }),
        this.repo.upsertOrder(coinId, today, 'daytrade', { ...dayTradeOrder, ...dayTradeVol }),
      ]);
    }
  }

  private parseSparkline(json: string): number[] {
    try {
      return JSON.parse(json) as number[];
    } catch {
      return [];
    }
  }
}
