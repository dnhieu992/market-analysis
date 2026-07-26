import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  dcaPortfolioId: string | null;
};

const DEFAULT_DCA_MAX_LAYERS = 3; // bottom-DCA ladder: 3 tiers × −15% (2026-07-12 backtest)

type DcaBuyRow = { id: string; price: number; usd: number; boughtAt: Date };

export type ActivityLogDto = {
  id: string;
  symbol: string;
  kind: 'manual' | 'system';
  event: 'BUY' | 'SELL' | null;
  content: string;
  images: string[];
  snapshot: Record<string, number> | null;
  createdAt: string;
  updatedAt: string;
};

type ActivityLogRow = {
  id: string;
  symbol: string;
  kind: string;
  event: string | null;
  content: string;
  images: unknown;
  snapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function toActivityLogDto(r: ActivityLogRow): ActivityLogDto {
  return {
    id: r.id,
    symbol: r.symbol,
    kind: r.kind === 'system' ? 'system' : 'manual',
    event: (r.event as 'BUY' | 'SELL' | null) ?? null,
    content: r.content,
    images: Array.isArray(r.images) ? (r.images as string[]) : [],
    snapshot: r.snapshot && typeof r.snapshot === 'object' ? (r.snapshot as Record<string, number>) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Compact price formatting for log text — mirrors the dashboard's precision tiers. */
function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

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
  /** Portfolio this coin's DCA layers sync into (configured per coin, not per buy). */
  dcaPortfolioId: string | null;
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
        dcaPortfolioId: coin.dcaPortfolioId ?? null,
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

  // ── Activity log ─────────────────────────────────────────────────────────

  async listActivityLogs(symbol: string): Promise<ActivityLogDto[]> {
    const rows = await this.repo.findActivityLogsBySymbol(symbol.toUpperCase());
    return rows.map((r) => toActivityLogDto(r));
  }

  async addActivityLog(symbol: string, data: { content: string; images?: string[] }) {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.findCoinBySymbol(upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);
    const row = await this.repo.createActivityLog({
      symbol: upper,
      kind: 'manual',
      content: data.content,
      images: data.images ?? [],
      snapshot: await this.activitySnapshot(upper),
    });
    return toActivityLogDto(row);
  }

  async updateActivityLog(id: string, data: { content?: string; images?: string[] }) {
    const existing = await this.repo.findActivityLogById(id);
    if (!existing) throw new NotFoundException(`Activity log ${id} not found`);
    // System entries mirror a buy/sell that actually happened — editing them would make
    // the timeline lie about the trade.
    if (existing.kind === 'system') throw new BadRequestException('Không sửa được log hệ thống');
    const row = await this.repo.updateActivityLog(id, data);
    return toActivityLogDto(row);
  }

  async deleteActivityLog(id: string) {
    const existing = await this.repo.findActivityLogById(id);
    if (!existing) throw new NotFoundException(`Activity log ${id} not found`);
    if (existing.kind === 'system') throw new BadRequestException('Không xoá được log hệ thống');
    await this.repo.deleteActivityLog(id);
    return { id };
  }

  /** Position state stamped on a manual note, so it reads in context months later. */
  private async activitySnapshot(symbol: string): Promise<Record<string, unknown> | null> {
    const coin = await this.repo.findCoinBySymbol(symbol);
    if (!coin) return null;
    const buys = await this.repo.findDcaBuysByCoin(coin.id);
    const agg = aggregateDca(buys);
    const price = await this.binance.fetchCurrentPrice(`${symbol}USDT`).catch(() => 0);
    return {
      ...(price > 0 ? { price } : {}),
      ...(agg
        ? {
            avgEntry: agg.avgEntry,
            layers: agg.layers,
            capitalDeployed: agg.capitalDeployed,
            ...(price > 0 && agg.avgEntry > 0
              ? { pnlPct: Number((((price - agg.avgEntry) / agg.avgEntry) * 100).toFixed(2)) }
              : {}),
          }
        : {}),
    };
  }

  /**
   * Write a read-only system entry. Never throws: a failed log must not roll back the
   * buy/sell it describes. `refId` is unique, so a retry cannot duplicate the line.
   */
  private async writeSystemLog(data: {
    symbol: string;
    event: 'BUY' | 'SELL';
    content: string;
    snapshot: Record<string, unknown>;
    refId: string;
  }): Promise<void> {
    try {
      await this.repo.createActivityLog({ ...data, kind: 'system' });
    } catch (e) {
      this.logger.warn(`Activity log (${data.event} ${data.symbol}) failed: ${e instanceof Error ? e.message : e}`);
    }
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
      // Sync target is read-only here — it is configured per coin from the Actions column.
      portfolioId: coin.dcaPortfolioId ?? null,
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

    // The sync target comes from the coin's own config; an explicit body value is only a
    // fallback for callers that predate the per-coin setting.
    const target = coin.dcaPortfolioId ?? data.portfolioId ?? null;

    let portfolioId: string | null = null;
    let transactionId: string | null = null;
    if (target && data.price > 0 && data.usd > 0) {
      if (userId) await this.portfolioService.getPortfolio(target, userId); // ownership guard
      const tx = await this.transactionService.createTransaction(target, {
        coinId: upper,
        type: 'buy',
        price: data.price,
        amount: data.usd / data.price,
        fee: 0,
        note: 'DCA gom (tracking-coins)',
        ...(data.boughtAt ? { transactedAt: data.boughtAt } : {}),
      });
      portfolioId = target;
      transactionId = (tx as { id: string }).id;
    }

    // Tag the layer by how it was entered: bought while the signal says GOM = "SIGNAL",
    // any other zone (or no signal) = "FOMO". Drives the holding-review history feed.
    const latestSig = await this.repo.findLatestSignal(coin.id);
    const zone = latestSig
      ? dcaZone({ ema34Above: latestSig.ema34Above, rsi: latestSig.rsi ?? 50, low20Pct: latestSig.low20Pct })
      : null;
    const entryMode = zone === 'GOM' ? 'SIGNAL' : 'FOMO';

    const buy = await this.repo.addDcaBuy(coin.id, {
      price: data.price,
      usd: data.usd,
      entryMode,
      boughtAt: data.boughtAt ? new Date(data.boughtAt) : undefined,
      portfolioId,
      transactionId,
    });

    // System log: freeze the decision moment — the layer, the price paid, and where the
    // average sits afterwards. The signal snapshot is the part a later scan would erase.
    const after = aggregateDca(await this.repo.findDcaBuysByCoin(coin.id));
    const maxLayers = coin.dcaMaxLayers ?? DEFAULT_DCA_MAX_LAYERS;
    await this.writeSystemLog({
      symbol: upper,
      event: 'BUY',
      refId: buy.id,
      content: [
        `🟢 **Gom lớp ${after?.layers ?? 1}/${maxLayers}** ${upper}`,
        `- Giá mua: ${fmtPrice(data.price)} · ${data.usd.toLocaleString('en-US')} USD`,
        ...(after ? [`- Vốn TB sau lệnh: ${fmtPrice(after.avgEntry)} · target x2: ${fmtPrice(after.avgEntry * 2)}`] : []),
        ...(after ? [`- Tổng vốn đã vào: ${after.capitalDeployed.toLocaleString('en-US')} USD`] : []),
        `- Vào lệnh: ${entryMode === 'SIGNAL' ? 'theo tín hiệu (zone GOM)' : 'FOMO (ngoài zone GOM)'}${
          latestSig?.rsi != null ? ` · RSI ${Math.round(latestSig.rsi)}` : ''
        }${latestSig?.dcaScore != null ? ` · dcaScore ${latestSig.dcaScore}` : ''}`,
        ...(portfolioId ? [] : ['- ⚠️ Không đồng bộ portfolio (chưa cấu hình ở ⚙)']),
      ].join('\n'),
      snapshot: {
        price: data.price,
        usd: data.usd,
        ...(after ? { avgEntry: after.avgEntry, layers: after.layers, capitalDeployed: after.capitalDeployed } : {}),
      },
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

    // System log BEFORE clearing the buy log — this is the only place the closed
    // position's numbers still exist, and the whole point is to review it later.
    const agg = aggregateDca(buys);
    if (agg && price > 0) {
      const pnlPct = agg.avgEntry > 0 ? ((price - agg.avgEntry) / agg.avgEntry) * 100 : 0;
      const pnlUsd = agg.capitalDeployed * (pnlPct / 100);
      const firstBuy = buys[0]?.boughtAt;
      const heldDays = firstBuy ? Math.max(0, Math.round((Date.now() - firstBuy.getTime()) / 86_400_000)) : null;
      const sign = pnlPct >= 0 ? '+' : '−';
      await this.writeSystemLog({
        symbol: upper,
        event: 'SELL',
        // One close per buy-log generation: the oldest layer id makes the key stable.
        refId: `close:${buys[0]?.id ?? upper}`,
        content: [
          `🔴 **Đóng vị thế** ${upper}`,
          `- Giá bán: ${fmtPrice(price)} · vốn TB: ${fmtPrice(agg.avgEntry)}`,
          `- PnL: ${sign}${Math.abs(pnlPct).toFixed(2)}% (${sign}${Math.abs(pnlUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD)`,
          `- Đã dùng ${agg.layers} lớp · tổng vốn ${agg.capitalDeployed.toLocaleString('en-US')} USD`,
          ...(heldDays != null ? [`- Thời gian ôm: ${heldDays} ngày`] : []),
          `- Target x2 (${fmtPrice(agg.avgEntry * 2)}): ${price >= agg.avgEntry * 2 ? '✅ đạt' : '❌ chưa đạt'}`,
        ].join('\n'),
        snapshot: {
          price,
          avgEntry: agg.avgEntry,
          layers: agg.layers,
          capitalDeployed: agg.capitalDeployed,
          pnlPct: Number(pnlPct.toFixed(2)),
        },
      });
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
      dcaPortfolioId: coin.dcaPortfolioId ?? null,
    };
  }

  async updateSetup(symbol: string, data: Partial<CoinSetup>) {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.findCoinBySymbol(upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);
    await this.repo.updateCoinSetup(coin.id, data);
    return { symbol: upper, ...(await this.getSetup(upper)) };
  }

  private parseSparkline(json: string): number[] {
    try {
      return JSON.parse(json) as number[];
    } catch {
      return [];
    }
  }
}
