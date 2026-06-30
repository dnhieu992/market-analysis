import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { computeSmallCapSignal, computeTimeframeTrend, computeLongShortScore, computeEntryScore, computeDcaScore, computeAccumulationSignal, dcaZone, dcaQualityBucket, calculateEma, calculateRsi, calculateVolumeRatio, calcUtBotResult, calculateAtr, computeSwingLimitOrder } from '@app/core';
import type { PaTrend, OrderSigSnapshot, LimitOrderResult, DcaZone, AccZone } from '@app/core';
import { createTrackingCoinsRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { HoldingsService } from '../holdings/holdings.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TransactionService } from '../transaction/transaction.service';

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
    utBotM30Bullish: boolean | null;
    wRsi: number | null;
    wVolMultiplier: number | null;
    h4Rsi: number | null;
    h4VolMultiplier: number | null;
    m30Ema34Above: boolean | null;
    m30Ema89Above: boolean | null;
    m30Ema200Above: boolean | null;
    m30Rsi: number | null;
    m30VolMultiplier: number | null;
    longScore: number | null;
    shortScore: number | null;
    signalScore: number;
    entryScore: number;
    dcaScore: number;
    dcaZone: DcaZone;
    accZone: AccZone | null;
    accDrawdownPct: number | null;
    accBaseWidthPct: number | null;
    accInBase: boolean | null;
    accGatePassed: boolean | null;
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

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly portfolioService: PortfolioService,
    private readonly transactionService: TransactionService,
    private readonly holdingsService: HoldingsService,
  ) {}

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
              utBotM30Bullish: sig.utBotM30Bullish,
              wRsi: sig.wRsi,
              wVolMultiplier: sig.wVolMultiplier,
              h4Rsi: sig.h4Rsi,
              h4VolMultiplier: sig.h4VolMultiplier,
              m30Ema34Above: sig.m30Ema34Above,
              m30Ema89Above: sig.m30Ema89Above,
              m30Ema200Above: sig.m30Ema200Above,
              m30Rsi: sig.m30Rsi,
              m30VolMultiplier: sig.m30VolMultiplier,
              longScore: sig.longScore,
              shortScore: sig.shortScore,
              signalScore: sig.signalScore,
              entryScore: sig.entryScore,
              dcaScore: sig.dcaScore,
              dcaZone: dcaZone({ ema34Above: sig.ema34Above, rsi: sig.rsi ?? 50, low20Pct: sig.low20Pct }),
              accZone: (sig.accZone as AccZone | null) ?? null,
              accDrawdownPct: sig.accDrawdownPct,
              accBaseWidthPct: sig.accBaseWidthPct,
              accInBase: sig.accInBase,
              accGatePassed: sig.accGatePassed,
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

  async getSignalHistory(symbol: string, limit = 100) {
    const coin = await this.repo.findCoinBySymbol(symbol.toUpperCase());
    if (!coin) throw new NotFoundException(`Coin ${symbol.toUpperCase()} not found`);
    const rows = await this.repo.findSignalHistory(coin.id, limit);
    return rows.map((r) => ({
      id: r.id,
      dcaScore: r.dcaScore,
      dcaZone: r.dcaZone as 'GOM' | 'CHO' | 'CHOT' | null,
      dcaBucket: r.dcaBucket as 'safe' | 'ok' | 'risky' | 'avoid',
      trend: r.trend,
      weekTrend: r.weekTrend,
      h4Trend: r.h4Trend,
      rsi: r.rsi,
      extPct: r.extPct,
      price: r.price,
      entryMode: (r.entryMode as 'SIGNAL' | 'FOMO' | 'MIXED' | null) ?? null,
      avgEntry: r.avgEntry,
      pnlPct: r.pnlPct,
      llmVerdict: (r.llmVerdict as 'GIU' | 'GOM_THEM' | 'CHOT_BOT' | 'THOAT' | null) ?? null,
      llmReview: r.llmReview,
      llmModel: r.llmModel,
      scannedAt: r.scannedAt.toISOString(),
    }));
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
        portfolioId: b.portfolioId ?? null,
      })),
    };
  }

  /**
   * Add a DCA layer. When `portfolioId` is given, also mirror it as a BUY
   * transaction in that portfolio (two-way sync) and link the two records.
   */
  async addDcaBuy(
    symbol: string,
    data: { price: number; usd: number; boughtAt?: string; portfolioId?: string },
    userId?: string,
  ) {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.findCoinBySymbol(upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);

    let portfolioId: string | null = null;
    let transactionId: string | null = null;
    if (data.portfolioId && data.price > 0 && data.usd > 0) {
      if (userId) await this.portfolioService.getPortfolio(data.portfolioId, userId); // ownership guard
      const tx = await this.transactionService.createTransaction(data.portfolioId, {
        coinId: upper,
        type: 'buy',
        price: data.price,
        amount: data.usd / data.price,
        fee: 0,
        note: 'DCA gom (tracking-coins)',
        ...(data.boughtAt ? { transactedAt: data.boughtAt } : {}),
      });
      portfolioId = data.portfolioId;
      transactionId = (tx as { id: string }).id;
    }

    // Tag the layer by how it was entered: bought while the signal says GOM = "SIGNAL",
    // any other zone (or no signal) = "FOMO". Drives the holding-review history feed.
    const latestSig = await this.repo.findLatestSignal(coin.id);
    const zone = latestSig
      ? dcaZone({ ema34Above: latestSig.ema34Above, rsi: latestSig.rsi ?? 50, low20Pct: latestSig.low20Pct })
      : null;
    const entryMode = zone === 'GOM' ? 'SIGNAL' : 'FOMO';

    await this.repo.addDcaBuy(coin.id, {
      price: data.price,
      usd: data.usd,
      entryMode,
      boughtAt: data.boughtAt ? new Date(data.boughtAt) : undefined,
      portfolioId,
      transactionId,
    });
    return this.getDcaPosition(upper);
  }

  async deleteDcaBuy(symbol: string, buyId: string, userId?: string) {
    const buy = await this.repo.findDcaBuyById(buyId);
    if (buy?.transactionId && buy.portfolioId) {
      // Removing the linked transaction cascades back to this DCA layer (reverse sync).
      if (userId) await this.portfolioService.getPortfolio(buy.portfolioId, userId);
      await this.transactionService.removeTransaction(buy.transactionId, buy.portfolioId);
    } else {
      await this.repo.deleteDcaBuy(buyId);
    }
    return this.getDcaPosition(symbol);
  }

  /**
   * Close the position ("đã chốt"): sell exactly the DCA-accumulated amount per
   * portfolio at `sellPrice` (defaults to the live price) — realising P&L without
   * touching any non-DCA holdings of the same coin — then clear the buy log.
   */
  async closeDcaPosition(symbol: string, sellPrice?: number, userId?: string) {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.findCoinBySymbol(upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);

    const buys = await this.repo.findDcaBuysByCoin(coin.id);
    const price = sellPrice && sellPrice > 0
      ? sellPrice
      : await this.binance.fetchCurrentPrice(`${upper}USDT`).catch(() => 0);

    // accumulate the synced amount per portfolio
    const amountByPortfolio = new Map<string, number>();
    for (const b of buys) {
      if (b.portfolioId && b.transactionId && b.price > 0) {
        amountByPortfolio.set(b.portfolioId, (amountByPortfolio.get(b.portfolioId) ?? 0) + b.usd / b.price);
      }
    }

    if (price > 0) {
      for (const [pid, rawAmount] of amountByPortfolio) {
        try {
          if (userId) await this.portfolioService.getPortfolio(pid, userId);
          // clamp to the held amount so float drift can't trip the "only X available" guard
          const held = await this.holdingsService.getHoldingAmount(pid, upper);
          const amount = Math.min(rawAmount, held);
          if (amount <= 0) continue;
          await this.transactionService.createTransaction(pid, {
            coinId: upper,
            type: 'sell',
            price,
            amount,
            fee: 0,
            note: 'DCA chốt toàn bộ (tracking-coins)',
          });
        } catch (e) {
          this.logger.warn(`DCA close: sell failed for portfolio ${pid}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }

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
    const utBotD1 = calcUtBotResult(d1Candles, 10, 3);
    const utBotD1Bullish = utBotD1?.uptrend ?? null;

    // UT Bot H4
    const h4Candles = h4Closes.length >= 2
      ? h4Closes.map((c, i) => ({ open: c, high: h4Highs[i]!, low: h4Lows[i]!, close: c }))
      : [];
    const utBotH4 = h4Candles.length >= 2 ? calcUtBotResult(h4Candles, 10, 3) : null;
    const utBotH4Bullish = utBotH4?.uptrend ?? null;

    // M30 — display-only signal (not fed into any scoring/order logic)
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

    // DCA signal history — append only when zone/bucket changes vs last row.
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
