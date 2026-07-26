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
  dcaPortfolioId: string | null;
};

/** The DCA position of a coin — derived entirely from its configured portfolio. */
export type DcaPositionDto = {
  symbol: string;
  currentPrice: number;
  /** Portfolio the position lives in; `null` = not configured yet (⚙ dialog). */
  portfolioId: string | null;
  /** Coin units currently held. */
  amount: number;
  /** Holding cost basis — the real break-even and the base for the x2 target. */
  avgEntry: number | null;
  capitalDeployed: number;
  realizedPnl: number;
  buyCount: number;
  sellCount: number;
  /** Advisory next-add level (last buy −15%); nothing is blocked on it. */
  nextAddPrice: number | null;
  pnlPct: number | null;
  targetX2: number | null;
  transactions: Array<{
    id: string;
    type: 'buy' | 'sell';
    price: number;
    amount: number;
    usd: number;
    at: string;
  }>;
};

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
  /** Position held in the coin's configured portfolio; `null` when flat or unconfigured. */
  dcaPosition: { amount: number; avgEntry: number; capitalDeployed: number } | null;
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

    // The at-a-glance position on each row comes from the coin's configured portfolio
    // holding — same source as the DCA tab, fetched for every coin in one query.
    const pairs = rows
      .filter((c) => c.dcaPortfolioId)
      .map((c) => ({ portfolioId: c.dcaPortfolioId as string, coinId: c.symbol }));
    const holdings = await this.repo.findHoldingsForPairs(pairs);
    const holdingByKey = new Map(holdings.map((h) => [`${h.portfolioId}:${h.coinId}`, h]));

    return rows.map((coin) => {
      const sig = coin.signals[0] ?? null;
      const holding = coin.dcaPortfolioId
        ? holdingByKey.get(`${coin.dcaPortfolioId}:${coin.symbol}`)
        : undefined;
      const amount = holding ? Number(holding.totalAmount) : 0;
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
        dcaPosition:
          holding && amount > 0
            ? {
                amount,
                avgEntry: Number(holding.avgCost),
                capitalDeployed: Number(holding.totalCost),
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
    const pos = await this.getDcaPosition(symbol).catch(() => null);
    if (!pos) return null;
    return {
      ...(pos.currentPrice > 0 ? { price: pos.currentPrice } : {}),
      ...(pos.avgEntry != null ? { avgEntry: pos.avgEntry } : {}),
      ...(pos.pnlPct != null ? { pnlPct: pos.pnlPct } : {}),
      layers: pos.buyCount,
      capitalDeployed: pos.capitalDeployed,
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

  // ── DCA position (a view over the configured portfolio) ──────────────────
  //
  // There is no separate DCA store. The position IS the portfolio's Holding +
  // CoinTransaction rows for this symbol, so buying here writes a real BUY, selling
  // writes a real SELL, and the /portfolio page can never disagree with this tab.

  /** Resolve the coin and the portfolio its DCA position lives in. */
  private async dcaContext(symbol: string, userId?: string) {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.findCoinBySymbol(upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);
    const portfolioId = coin.dcaPortfolioId ?? null;
    if (portfolioId && userId) await this.portfolioService.getPortfolio(portfolioId, userId); // ownership guard
    return { upper, coin, portfolioId };
  }

  async getDcaPosition(symbol: string, userId?: string): Promise<DcaPositionDto> {
    const { upper, portfolioId } = await this.dcaContext(symbol, userId);
    const currentPrice = await this.binance.fetchCurrentPrice(`${upper}USDT`).catch(() => 0);

    // No portfolio configured → nothing to show; the UI points at the ⚙ dialog.
    if (!portfolioId) {
      return {
        symbol: upper,
        currentPrice,
        portfolioId: null,
        amount: 0,
        avgEntry: null,
        capitalDeployed: 0,
        realizedPnl: 0,
        buyCount: 0,
        sellCount: 0,
        nextAddPrice: null,
        pnlPct: null,
        targetX2: null,
        transactions: [],
      };
    }

    const [holding, txs] = await Promise.all([
      this.holdingsService.getHolding(portfolioId, upper),
      this.repo.findCoinTransactions(portfolioId, upper),
    ]);

    const amount = holding ? Number(holding.totalAmount) : 0;
    const avgEntry = holding && Number(holding.avgCost) > 0 ? Number(holding.avgCost) : null;
    const buys = txs.filter((t) => t.type === 'buy');
    const lastBuy = buys.length > 0 ? Number(buys[buys.length - 1]!.price) : null;

    return {
      symbol: upper,
      currentPrice,
      portfolioId,
      amount,
      avgEntry,
      capitalDeployed: holding ? Number(holding.totalCost) : 0,
      realizedPnl: holding ? Number(holding.realizedPnl) : 0,
      buyCount: buys.length,
      sellCount: txs.length - buys.length,
      // Advisory only — the −15% ladder step from the bottom-DCA backtest, anchored to
      // the last buy. Nothing is capped or blocked on it.
      nextAddPrice: lastBuy != null ? Number((lastBuy * 0.85).toFixed(8)) : null,
      pnlPct:
        avgEntry != null && currentPrice > 0
          ? Number((((currentPrice - avgEntry) / avgEntry) * 100).toFixed(2))
          : null,
      targetX2: avgEntry != null ? Number((avgEntry * 2).toFixed(8)) : null,
      transactions: txs.map((t) => ({
        id: t.id,
        type: t.type === 'sell' ? ('sell' as const) : ('buy' as const),
        price: Number(t.price),
        amount: Number(t.amount),
        usd: Number(t.totalValue),
        at: t.transactedAt.toISOString(),
      })),
    };
  }

  /** Buy into the position — a real BUY transaction in the configured portfolio. */
  async addDcaBuy(
    symbol: string,
    data: { price: number; usd: number; boughtAt?: string },
    userId?: string,
  ): Promise<DcaPositionDto> {
    const { upper, coin, portfolioId } = await this.dcaContext(symbol, userId);
    if (!portfolioId) {
      throw new BadRequestException(`${upper} chưa cấu hình portfolio — chọn ở icon ⚙ cột Actions`);
    }
    if (!(data.price > 0) || !(data.usd > 0)) {
      throw new BadRequestException('Giá và số USD phải lớn hơn 0');
    }

    const tx = await this.transactionService.createTransaction(portfolioId, {
      coinId: upper,
      type: 'buy',
      price: data.price,
      amount: data.usd / data.price,
      fee: 0,
      note: 'DCA gom (tracking-coins)',
      ...(data.boughtAt ? { transactedAt: data.boughtAt } : {}),
    });

    // Freeze the decision moment: the price paid plus the signal read at that instant,
    // which the next scan would otherwise overwrite.
    const latestSig = await this.repo.findLatestSignal(coin.id);
    const zone = latestSig
      ? dcaZone({ ema34Above: latestSig.ema34Above, rsi: latestSig.rsi ?? 50, low20Pct: latestSig.low20Pct })
      : null;
    const entryMode = zone === 'GOM' ? 'SIGNAL' : 'FOMO';
    const after = await this.getDcaPosition(upper);

    await this.writeSystemLog({
      symbol: upper,
      event: 'BUY',
      refId: (tx as { id: string }).id,
      content: [
        `🟢 **Gom ${upper}** (lệnh mua thứ ${after.buyCount})`,
        `- Giá mua: ${fmtPrice(data.price)} · ${data.usd.toLocaleString('en-US')} USD`,
        ...(after.avgEntry != null
          ? [`- Vốn TB sau lệnh: ${fmtPrice(after.avgEntry)} · target x2: ${fmtPrice(after.avgEntry * 2)}`]
          : []),
        `- Đang giữ: ${after.amount} ${upper} · tổng vốn ${after.capitalDeployed.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD`,
        `- Vào lệnh: ${entryMode === 'SIGNAL' ? 'theo tín hiệu (zone GOM)' : 'FOMO (ngoài zone GOM)'}${
          latestSig?.rsi != null ? ` · RSI ${Math.round(latestSig.rsi)}` : ''
        }${latestSig?.dcaScore != null ? ` · dcaScore ${latestSig.dcaScore}` : ''}`,
      ].join('\n'),
      snapshot: {
        price: data.price,
        usd: data.usd,
        ...(after.avgEntry != null ? { avgEntry: after.avgEntry } : {}),
        layers: after.buyCount,
        capitalDeployed: after.capitalDeployed,
      },
    });

    return this.getDcaPosition(upper);
  }

  /** Remove a layer — soft-deletes the portfolio transaction and recomputes the holding. */
  async deleteDcaBuy(symbol: string, transactionId: string, userId?: string): Promise<DcaPositionDto> {
    const { upper, portfolioId } = await this.dcaContext(symbol, userId);
    if (!portfolioId) throw new BadRequestException(`${upper} chưa cấu hình portfolio`);
    await this.transactionService.removeTransaction(transactionId, portfolioId);
    return this.getDcaPosition(upper);
  }

  /**
   * Sell out of the position — partially or in full. `amount` defaults to everything
   * held; the SELL transaction deducts straight from the portfolio holding.
   */
  async sellDcaPosition(
    symbol: string,
    data: { price?: number; amount?: number },
    userId?: string,
  ): Promise<DcaPositionDto> {
    const { upper, portfolioId } = await this.dcaContext(symbol, userId);
    if (!portfolioId) throw new BadRequestException(`${upper} chưa cấu hình portfolio`);

    const price =
      data.price && data.price > 0
        ? data.price
        : await this.binance.fetchCurrentPrice(`${upper}USDT`).catch(() => 0);
    if (!(price > 0)) throw new BadRequestException('Không lấy được giá bán — nhập giá thủ công');

    const before = await this.getDcaPosition(upper);
    const held = before.amount;
    if (!(held > 0)) throw new BadRequestException(`Không còn ${upper} nào trong portfolio để bán`);

    // Clamp to the held amount so float drift can't trip the "only X available" guard.
    const amount = Math.min(data.amount && data.amount > 0 ? data.amount : held, held);
    const full = amount >= held - 1e-12;

    const tx = await this.transactionService.createTransaction(portfolioId, {
      coinId: upper,
      type: 'sell',
      price,
      amount,
      fee: 0,
      note: full ? 'DCA chốt toàn bộ (tracking-coins)' : 'DCA chốt một phần (tracking-coins)',
    });

    const avgEntry = before.avgEntry;
    const pnlPct = avgEntry && avgEntry > 0 ? ((price - avgEntry) / avgEntry) * 100 : null;
    const pnlUsd = avgEntry && avgEntry > 0 ? (price - avgEntry) * amount : null;
    const sign = (pnlPct ?? 0) >= 0 ? '+' : '−';
    const soldPct = (amount / held) * 100;
    const first = before.transactions[0]?.at;
    const heldDays = first ? Math.max(0, Math.round((Date.now() - new Date(first).getTime()) / 86_400_000)) : null;
    const after = await this.getDcaPosition(upper);

    await this.writeSystemLog({
      symbol: upper,
      event: 'SELL',
      refId: (tx as { id: string }).id,
      content: [
        full ? `🔴 **Đóng vị thế** ${upper}` : `🟡 **Chốt một phần** ${upper} (${soldPct.toFixed(0)}%)`,
        `- Giá bán: ${fmtPrice(price)} · ${amount} ${upper} (${(amount * price).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD)`,
        ...(avgEntry != null ? [`- Vốn TB: ${fmtPrice(avgEntry)}`] : []),
        ...(pnlPct != null && pnlUsd != null
          ? [`- PnL: ${sign}${Math.abs(pnlPct).toFixed(2)}% (${sign}${Math.abs(pnlUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD)`]
          : []),
        full
          ? `- Đã dùng ${before.buyCount} lệnh mua${heldDays != null ? ` · ôm ${heldDays} ngày` : ''}`
          : `- Còn lại: ${after.amount} ${upper}`,
        ...(avgEntry != null
          ? [`- Target x2 (${fmtPrice(avgEntry * 2)}): ${price >= avgEntry * 2 ? '✅ đạt' : '❌ chưa đạt'}`]
          : []),
      ].join('\n'),
      snapshot: {
        price,
        ...(avgEntry != null ? { avgEntry } : {}),
        layers: before.buyCount,
        capitalDeployed: before.capitalDeployed,
        ...(pnlPct != null ? { pnlPct: Number(pnlPct.toFixed(2)) } : {}),
      },
    });

    return after;
  }

  async getSetup(symbol: string) {
    const coin = await this.repo.findCoinBySymbol(symbol.toUpperCase());
    if (!coin) throw new NotFoundException(`Coin ${symbol.toUpperCase()} not found`);
    return {
      swingMaxLoss: coin.swingMaxLoss ?? null,
      swingMinRR: coin.swingMinRR ?? null,
      daytradeMaxLoss: coin.daytradeMaxLoss ?? null,
      daytradeMinRR: coin.daytradeMinRR ?? null,
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
