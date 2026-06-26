import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { computeSmallCapSignal, computeTimeframeTrend, computeLongShortScore, computeEntryScore, computeDcaScore, dcaZone, calculateEma, calculateRsi, calculateVolumeRatio, calcUtBotResult, calculateAtr, computeSwingLimitOrder } from '@app/core';
import type { PaTrend, OrderSigSnapshot, LimitOrderResult, DcaZone } from '@app/core';
import { createTrackingCoinsRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

const CANDLE_LIMIT = 220;

type CoinSetup = {
  swingMaxLoss: number | null;
  swingMinRR: number | null;
  daytradeMaxLoss: number | null;
  daytradeMinRR: number | null;
  dcaMaxLayers: number | null;
};

const DEFAULT_DCA_MAX_LAYERS = 5;

type DcaBuyRow = { id: string; price: number; usd: number; boughtAt: Date };

// Aggregate a coin's DCA buy log into the position summary the dashboard shows.
function aggregateDca(buys: DcaBuyRow[]): { layers: number; avgEntry: number; capitalDeployed: number } | null {
  if (!buys || buys.length === 0) return null;
  let coins = 0;
  let cost = 0;
  for (const b of buys) {
    if (b.price > 0) coins += b.usd / b.price;
    cost += b.usd;
  }
  return {
    layers: buys.length,
    avgEntry: coins > 0 ? cost / coins : 0,
    capitalDeployed: cost,
  };
}

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
  swing: SavedOrderSuggestion | null;
  generatedAt: string;
};

export type TrackingCoinWithSignal = {
  id: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  addedAt: Date;
  signal: {
    rsi: number | null;
    volMultiplier: number | null;
    ema34Above: boolean;
    ema89Above: boolean;
    ema200Above: boolean;
    wEma34Above: boolean | null;
    wEma89Above: boolean | null;
    wEma200Above: boolean | null;
    h4Ema34Above: boolean | null;
    h4Ema89Above: boolean | null;
    h4Ema200Above: boolean | null;
    utBotW1Bullish: boolean | null;
    utBotD1Bullish: boolean | null;
    utBotH4Bullish: boolean | null;
    wRsi: number | null;
    wVolMultiplier: number | null;
    h4Rsi: number | null;
    h4VolMultiplier: number | null;
    longScore: number | null;
    shortScore: number | null;
    signalScore: number;
    entryScore: number;
    dcaScore: number;
    dcaZone: DcaZone;
    extPct: number | null;
    low20Pct: number | null;
    sparkline: number[];
    weekTrend: string;
    trend: string;
    h4Trend: string;
    m30Trend: string;
    swingStructure: string;
    scannedAt: Date;
  } | null;
  dcaPosition: { layers: number; avgEntry: number; capitalDeployed: number } | null;
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
        marketCap: coin.marketCap,
        addedAt: coin.addedAt,
        signal: sig
          ? {
              rsi: sig.rsi,
              volMultiplier: sig.volMultiplier,
              ema34Above: sig.ema34Above,
              ema89Above: sig.ema89Above,
              ema200Above: sig.ema200Above,
              wEma34Above: sig.wEma34Above,
              wEma89Above: sig.wEma89Above,
              wEma200Above: sig.wEma200Above,
              h4Ema34Above: sig.h4Ema34Above,
              h4Ema89Above: sig.h4Ema89Above,
              h4Ema200Above: sig.h4Ema200Above,
              utBotW1Bullish: sig.utBotW1Bullish,
              utBotD1Bullish: sig.utBotD1Bullish,
              utBotH4Bullish: sig.utBotH4Bullish,
              wRsi: sig.wRsi,
              wVolMultiplier: sig.wVolMultiplier,
              h4Rsi: sig.h4Rsi,
              h4VolMultiplier: sig.h4VolMultiplier,
              longScore: sig.longScore,
              shortScore: sig.shortScore,
              signalScore: sig.signalScore,
              entryScore: sig.entryScore,
              dcaScore: sig.dcaScore,
              dcaZone: dcaZone({ ema34Above: sig.ema34Above, rsi: sig.rsi ?? 50, low20Pct: sig.low20Pct }),
              extPct: sig.extPct,
              low20Pct: sig.low20Pct,
              sparkline: this.parseSparkline(sig.sparklineJson),
              weekTrend: sig.weekTrend,
              trend: sig.trend,
              h4Trend: sig.h4Trend,
              m30Trend: sig.m30Trend,
              swingStructure: sig.swingStructure,
              scannedAt: sig.scannedAt,
            }
          : null,
        dcaPosition: aggregateDca(coin.dcaBuys),
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

    const [h4Klines, currentPrice] = await Promise.all([
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '4h', limit: 60 }),
      this.binance.fetchCurrentPrice(binanceSymbol).catch(() => 0),
    ]);

    const h4Highs  = h4Klines.map((k) => parseFloat(k[2]));
    const h4Lows   = h4Klines.map((k) => parseFloat(k[3]));
    const h4Closes = h4Klines.map((k) => parseFloat(k[4]));

    const price = currentPrice || (h4Klines.length > 0 ? parseFloat(h4Klines[h4Klines.length - 1]![4]) : 0);

    const sigSnap: OrderSigSnapshot | null = sig ? {
      trend: sig.trend,
      h4Trend: sig.h4Trend,
      m30Trend: sig.m30Trend,
      utBotD1Bullish: sig.utBotD1Bullish,
      utBotH4Bullish: sig.utBotH4Bullish,
      utBotW1Bullish: sig.utBotW1Bullish,
      longScore: sig.longScore,
      shortScore: sig.shortScore,
      ema200Above: sig.ema200Above,
      rsi: sig.rsi,
      h4Rsi: sig.h4Rsi,
      swingStructure: sig.swingStructure,
    } : null;

    const h4Atr = calculateAtr(h4Highs, h4Lows, h4Closes, 14);
    const swing = computeSwingLimitOrder(price, h4Highs, h4Lows, sigSnap, h4Atr);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const setup = await this.repo.findCoinBySymbol(upper);

    // Day-trade removed from tracking-coins — only swing orders are generated;
    // clear any stale day-trade order from earlier scans.
    const [swingSaved] = await Promise.all([
      this.persistSuggestion(coin.id, today, 'swing', swing, setup?.swingMaxLoss ?? null, setup?.swingMinRR ?? null),
      this.repo.deleteOrder(coin.id, today, 'daytrade'),
    ]);

    return {
      symbol: upper,
      currentPrice: price,
      swing: swingSaved,
      generatedAt: new Date().toISOString(),
    };
  }

  // Upsert a suggested order (or delete the day's stale one when regime = no-trade),
  // returning the shape the UI expects (or null for no-trade).
  private async persistSuggestion(
    coinId: string,
    date: Date,
    type: 'swing' | 'daytrade',
    order: LimitOrderResult | null,
    maxLoss: number | null,
    minRR: number | null,
  ): Promise<SavedOrderSuggestion | null> {
    // P3 — minRR gate: treat a below-threshold R:R order as no-trade.
    const gated = order && (minRR == null || order.rrRatio >= minRR) ? order : null;
    if (!gated) {
      await this.repo.deleteOrder(coinId, date, type);
      return null;
    }
    const vol = calcVolume(gated, maxLoss);
    const record = await this.repo.upsertOrder(coinId, date, type, { ...gated, ...vol });
    return { ...gated, id: record.id, notes: record.notes ?? null };
  }

  async updateOrderNotes(orderId: string, notes: string | null): Promise<void> {
    await this.repo.updateOrderNotes(orderId, notes);
  }

  // ── DCA position (manual buy log) ────────────────────────────────────────

  async getDcaPosition(symbol: string) {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.findCoinBySymbol(upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);
    const buys = await this.repo.findDcaBuysByCoin(coin.id);
    const agg = aggregateDca(buys);
    const currentPrice = await this.binance.fetchCurrentPrice(`${upper}USDT`).catch(() => 0);
    const lastAdd = buys.length > 0 ? buys[buys.length - 1]!.price : null;

    return {
      symbol: upper,
      currentPrice,
      maxLayers: coin.dcaMaxLayers ?? DEFAULT_DCA_MAX_LAYERS,
      layers: agg?.layers ?? 0,
      avgEntry: agg?.avgEntry ?? null,
      capitalDeployed: agg?.capitalDeployed ?? 0,
      // Next layer triggers 8% below the last add (matches the backtested -8% step).
      nextAddPrice: lastAdd != null ? Number((lastAdd * 0.92).toFixed(8)) : null,
      pnlPct: agg && agg.avgEntry > 0 && currentPrice > 0
        ? Number((((currentPrice - agg.avgEntry) / agg.avgEntry) * 100).toFixed(2))
        : null,
      buys: buys.map((b) => ({
        id: b.id,
        price: b.price,
        usd: b.usd,
        boughtAt: b.boughtAt.toISOString(),
      })),
    };
  }

  async addDcaBuy(symbol: string, data: { price: number; usd: number; boughtAt?: string }) {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.findCoinBySymbol(upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);
    await this.repo.addDcaBuy(coin.id, {
      price: data.price,
      usd: data.usd,
      boughtAt: data.boughtAt ? new Date(data.boughtAt) : undefined,
    });
    return this.getDcaPosition(upper);
  }

  async deleteDcaBuy(symbol: string, buyId: string) {
    await this.repo.deleteDcaBuy(buyId);
    return this.getDcaPosition(symbol);
  }

  async closeDcaPosition(symbol: string) {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.findCoinBySymbol(upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);
    await this.repo.deleteAllDcaBuys(coin.id);
    return this.getDcaPosition(upper);
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
      dcaMaxLayers: coin.dcaMaxLayers ?? null,
    };
  }

  async updateSetup(symbol: string, data: CoinSetup) {
    const coin = await this.repo.findCoinBySymbol(symbol.toUpperCase());
    if (!coin) throw new NotFoundException(`Coin ${symbol.toUpperCase()} not found`);
    await this.repo.updateCoinSetup(coin.id, data);
    return { symbol: symbol.toUpperCase(), ...data };
  }

  private async scanOneCoin(coinId: string, symbol: string, setup?: (CoinSetup & { marketCap?: number | null }) | null): Promise<void> {
    const binanceSymbol = `${symbol}USDT`;

    const [klines, h4Klines, m30Klines, wKlines] = await Promise.all([
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1d', limit: CANDLE_LIMIT }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '4h', limit: 200 }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: 'M30', limit: 300 }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1w', limit: 300 }),
    ]);

    if (klines.length < 210) return;

    const closes = klines.map((k) => parseFloat(k[4]));
    const highs = klines.map((k) => parseFloat(k[2]));
    const lows = klines.map((k) => parseFloat(k[3]));
    const volumes = klines.map((k) => parseFloat(k[5]));

    const result = computeSmallCapSignal(closes, highs, lows, volumes);
    if (!result) return;

    // % the last close sits above the rolling 20-day low (DCA dip-depth gauge).
    const lastClose = closes[closes.length - 1]!;
    const low20 = Math.min(...lows.slice(-20));
    const low20Pct = low20 > 0 ? Number((((lastClose - low20) / low20) * 100).toFixed(1)) : null;

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
    const utBotD1 = calcUtBotResult(d1Candles, 10, 2);
    const utBotD1Bullish = utBotD1?.uptrend ?? null;

    // UT Bot H4
    const h4Candles = h4Closes.length >= 2
      ? h4Closes.map((c, i) => ({ open: c, high: h4Highs[i]!, low: h4Lows[i]!, close: c }))
      : [];
    const utBotH4 = h4Candles.length >= 2 ? calcUtBotResult(h4Candles, 10, 2) : null;
    const utBotH4Bullish = utBotH4?.uptrend ?? null;

    // Weekly (W1) — same indicators/setup as D1/H4
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
    const utBotW1Bullish = wCandles.length >= 2 ? (calcUtBotResult(wCandles, 10, 2)?.uptrend ?? null) : null;

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
    const swingOrder = currentPrice > 0
      ? computeSwingLimitOrder(currentPrice, h4Highs, h4Lows, sigSnap, h4Atr)
      : null;

    // Entry Score — low-risk-entry gauge; uses the raw order's R:R (pre minRR-gate).
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
      rrRatio: swingOrder?.rrRatio ?? null,
    });

    // DCA-worthiness — "how safe is it to DCA this coin?" (market-cap + weekly trend).
    const dcaScore = computeDcaScore({
      marketCap: setup?.marketCap ?? null,
      weekTrend: weekTrend as PaTrend,
      wEma89Above,
      wEma200Above,
      utBotW1Bullish,
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
    });

    // Regenerate today's orders so re-analyze keeps limit levels fresh
    if (currentPrice > 0) {
      await Promise.all([
        this.persistSuggestion(coinId, today, 'swing', swingOrder, setup?.swingMaxLoss ?? null, setup?.swingMinRR ?? null),
        this.repo.deleteOrder(coinId, today, 'daytrade'),  // day-trade removed
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
