import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { dcaGomPlan, dcaZone } from '@app/core';
import type { DcaZone, AccZone, DcaGomPlan } from '@app/core';
import { createTrackingCoinsRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { HoldingsService } from '../holdings/holdings.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TransactionService } from '../transaction/transaction.service';

type CoinSetup = {
  swingMaxLoss: number | null;
  swingMinRR: number | null;
  daytradeMaxLoss: number | null;
  daytradeMinRR: number | null;
  dcaMaxLayers: number | null;
};

const DEFAULT_DCA_MAX_LAYERS = 3; // bottom-DCA ladder: 3 tiers × −15% (2026-07-12 backtest)

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
    /** Suggested gom price plan (entry band + −15% ×3 ladder + x2 target) from the base low. */
    gomZone: DcaGomPlan | null;
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
              gomZone: dcaGomPlan(sig.accBaseLow ?? null),
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
      // Next layer triggers 15% below the last add (bottom-DCA ladder, 3 tiers × −15% —
      // claude-backtest/runs/2026-07-12-bottom-dca-x2x3-merged).
      nextAddPrice: lastAdd != null ? Number((lastAdd * 0.85).toFixed(8)) : null,
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

  private parseSparkline(json: string): number[] {
    try {
      return JSON.parse(json) as number[];
    } catch {
      return [];
    }
  }
}
