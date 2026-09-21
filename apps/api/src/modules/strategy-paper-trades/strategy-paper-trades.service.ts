import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { AnalysisTimeframe } from '@app/config';
import { createStrategyPaperNoteRepository, createStrategyPaperTradeRepository, DEFAULT_STRATEGY_DOC } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { StorageService } from '../storage/storage.service';
import { renderSetupChart, SETUP_CHART_TF_CONFIG, type OhlcCandle } from '../bitget/setup-chart-renderer';

const SYMBOL = 'BTCUSDT';
const TF: AnalysisTimeframe = '1h';
const FEE_PCT = 0.0005; // 0.05% per side, same as the backtest
const KLINE_LIMIT = 260; // ~11 days of 1h — plenty for prev-day levels + ATR + open-trade management

type Candle = { t: number; closeT: number; open: number; high: number; low: number; close: number };

export type StrategyPaperTradeDto = {
  id: string;
  symbol: string;
  timeframe: string;
  tradeDate: string;
  direction: 'LONG' | 'SHORT';
  status: string;
  pdh: number;
  pdl: number;
  signalClose: number;
  entryPrice: number;
  initialStopLoss: number;
  stopLoss: number;
  takeProfit: number;
  riskUsd: number;
  quantity: number;
  rrPlanned: number;
  openedAt: string;
  closedAt: string | null;
  exitPrice: number | null;
  exitReason: string | null;
  pnlUsd: number | null;
  rMultiple: number | null;
  lastPrice: number | null;
  lastCheckedAt: string | null;
  feedbackRating: number | null;
  feedbackNote: string | null;
  feedbackAt: string | null;
  createdAt: string;
  /** Live result while OPEN — null once closed (use pnlUsd/rMultiple instead). */
  unrealizedPnlUsd: number | null;
  unrealizedR: number | null;
  /** R2 URL of the 1h setup-chart snapshot at entry — null until rendered. */
  chartUrl: string | null;
};

export type StrategyPaperTradeStats = {
  closedCount: number;
  wins: number;
  losses: number;
  eod: number;
  winRate: number | null;
  totalPnlUsd: number;
  totalR: number;
};

export type StrategyPaperConfigDto = {
  name: string;
  enabled: boolean;
  symbol: string;
  timeframe: string;
  riskUsd: number;
  rrPlanned: number;
  docMarkdown: string;
};

export type StrategyPaperNoteDto = {
  id: string;
  body: string;
  images: string[];
  createdAt: string;
};

export type StrategyPaperBoard = {
  symbol: string;
  price: number | null;
  config: StrategyPaperConfigDto;
  openTrades: StrategyPaperTradeDto[];
  history: StrategyPaperTradeDto[];
  stats: StrategyPaperTradeStats;
  /** Yesterday's levels the strategy is currently watching (for the header). */
  levels: { pdh: number; pdl: number; day: string } | null;
};

type TradeRow = Awaited<ReturnType<ReturnType<typeof createStrategyPaperTradeRepository>['list']>>[number];

const utcDayIndex = (ms: number) => Math.floor(ms / 864e5);
const utcDayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

@Injectable()
export class StrategyPaperTradesService implements OnModuleInit {
  private readonly logger = new Logger(StrategyPaperTradesService.name);
  private readonly repo = createStrategyPaperTradeRepository();
  private readonly notesRepo = createStrategyPaperNoteRepository();

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    // Populate soon after boot without blocking startup; the hourly cron takes over after.
    setTimeout(() => {
      this.runScanTick().catch((e) => this.logger.warn(`initial scan failed: ${e instanceof Error ? e.message : e}`));
    }, 15_000);
  }

  /** Runs a few minutes after each 1h close so the just-closed candle is final. */
  @Cron('2 * * * *')
  async scheduledScan(): Promise<void> {
    try {
      const r = await this.runScanTick();
      this.logger.log(`scan tick: opened=${r.opened} closed=${r.closed} price=${r.price ?? 'n/a'}`);
    } catch (e) {
      this.logger.warn(`scan tick failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ---------------- engine ----------------

  private atr14(c: Candle[]): number[] {
    const out = new Array(c.length).fill(NaN);
    const tr = new Array(c.length).fill(0);
    for (let i = 1; i < c.length; i += 1) {
      const cur = c[i]!;
      const prev = c[i - 1]!;
      tr[i] = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
    }
    const p = 14;
    if (c.length <= p) return out;
    let a = tr.slice(1, p + 1).reduce((x: number, y: number) => x + y, 0) / p;
    out[p] = a;
    for (let i = p + 1; i < c.length; i += 1) { a = (a * (p - 1) + tr[i]) / p; out[i] = a; }
    return out;
  }

  private async fetchCandles(): Promise<Candle[]> {
    const raw = await this.binance.fetchKlines({ symbol: SYMBOL, timeframe: TF, limit: KLINE_LIMIT });
    return raw.map((k) => ({
      t: Number(k[0]),
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      closeT: Number(k[6]),
    }));
  }

  /** Previous UTC day's high/low relative to a given day index, from the candles. */
  private prevDayLevels(closed: Candle[], dayIdx: number): { pdh: number; pdl: number } | null {
    let hi = -Infinity, lo = Infinity, found = false;
    for (const c of closed) {
      if (utcDayIndex(c.t) === dayIdx - 1) { found = true; if (c.high > hi) hi = c.high; if (c.low < lo) lo = c.low; }
    }
    return found ? { pdh: hi, pdl: lo } : null;
  }

  /**
   * One engine tick: manage every OPEN trade against the closed candles (SL / TP / end-of-day),
   * then, if flat, look at the most recent CLOSED 1h candle for a fresh PDH/PDL breakout.
   */
  async runScanTick(): Promise<{ opened: number; closed: number; price: number | null }> {
    const config = await this.repo.getConfig();
    const candles = await this.fetchCandles();
    if (candles.length < 60) return { opened: 0, closed: 0, price: null };

    const now = Date.now();
    const closed = candles.filter((c) => c.closeT <= now);
    const price = candles[candles.length - 1]?.close ?? null;
    const atr = this.atr14(closed);
    let openedCount = 0;
    let closedCount = 0;

    // 1) Manage open trades.
    const open = await this.repo.findOpen();
    for (const trade of open) {
      const res = this.simulateOpenTrade(trade, closed);
      if (res.exit) {
        const dirSign = trade.direction === 'SHORT' ? -1 : 1;
        const gross = trade.quantity * (res.exit.price - trade.entryPrice) * dirSign;
        const fee = (trade.quantity * trade.entryPrice + trade.quantity * res.exit.price) * FEE_PCT;
        const pnl = gross - fee;
        await this.repo.update(trade.id, {
          status: res.exit.reason === 'TP' ? 'CLOSED_TP' : res.exit.reason === 'SL' ? 'CLOSED_SL' : 'CLOSED_EOD',
          exitPrice: res.exit.price,
          exitReason: res.exit.reason,
          pnlUsd: pnl,
          rMultiple: pnl / trade.riskUsd,
          closedAt: new Date(res.exit.at),
          lastPrice: price,
          lastCheckedAt: new Date(),
        });
        closedCount += 1;
        // Re-render with the closed marker so the history chart shows the exit too.
        this.renderAndAttachEntryChart(trade.id).catch((e) =>
          this.logger.warn(`close-chart render failed for ${trade.id}: ${e instanceof Error ? e.message : e}`),
        );
      } else {
        await this.repo.update(trade.id, { lastPrice: price, lastCheckedAt: new Date() });
      }
    }

    // 2) Only look for a new entry if we are flat (one position at a time, as backtested).
    const stillOpen = await this.repo.findOpen();
    if (config.enabled && stillOpen.length === 0) {
      openedCount += await this.tryOpenFromLastClosed(closed, atr, config.riskUsd, config.rrPlanned, price);
    }

    return { opened: openedCount, closed: closedCount, price };
  }

  /** Walk closed candles after entry; SL checked before TP; a new UTC day forces an EOD close. */
  private simulateOpenTrade(trade: TradeRow, closed: Candle[]): { exit: { price: number; reason: 'TP' | 'SL' | 'EOD'; at: number } | null } {
    const dir = trade.direction === 'SHORT' ? -1 : 1;
    const entryDay = utcDayIndex(trade.openedAt.getTime());
    let lastSameDayClose: number | null = null;
    let lastSameDayCloseT = trade.openedAt.getTime();
    for (const c of closed) {
      if (c.t <= trade.openedAt.getTime()) continue;
      if (utcDayIndex(c.t) !== entryDay) {
        // First candle of a new day → the trade should have been force-closed at end of entry day.
        if (lastSameDayClose != null) return { exit: { price: lastSameDayClose, reason: 'EOD', at: lastSameDayCloseT } };
        break;
      }
      if (dir === 1) {
        if (c.low <= trade.stopLoss) return { exit: { price: trade.stopLoss, reason: 'SL', at: c.closeT } };
        if (c.high >= trade.takeProfit) return { exit: { price: trade.takeProfit, reason: 'TP', at: c.closeT } };
      } else {
        if (c.high >= trade.stopLoss) return { exit: { price: trade.stopLoss, reason: 'SL', at: c.closeT } };
        if (c.low <= trade.takeProfit) return { exit: { price: trade.takeProfit, reason: 'TP', at: c.closeT } };
      }
      lastSameDayClose = c.close;
      lastSameDayCloseT = c.closeT;
    }
    // No new-day candle in the window yet, but the entry day is already over → force EOD close.
    if (lastSameDayClose != null && utcDayIndex(Date.now()) > entryDay) {
      return { exit: { price: lastSameDayClose, reason: 'EOD', at: lastSameDayCloseT } };
    }
    return { exit: null };
  }

  private async tryOpenFromLastClosed(closed: Candle[], atr: number[], riskUsd: number, rr: number, price: number | null): Promise<number> {
    const i = closed.length - 1;
    const sig = closed[i];
    if (!sig) return 0;
    const dayIdx = utcDayIndex(sig.t);
    // Don't open in the last hour of the day — no room to run before the forced EOD close.
    const hourOfDay = Math.floor((sig.t % 864e5) / 36e5);
    if (hourOfDay >= 23) return 0;

    const lv = this.prevDayLevels(closed, dayIdx);
    if (!lv) return 0;
    const atrHere = atr[i];
    const a = atrHere != null && Number.isFinite(atrHere) ? atrHere : sig.close * 0.003;

    let direction: 'LONG' | 'SHORT' | null = null;
    let stop = 0;
    if (sig.close > lv.pdh) { direction = 'LONG'; stop = Math.min(sig.low, lv.pdl) - 0.1 * a; }
    else if (sig.close < lv.pdl) { direction = 'SHORT'; stop = Math.max(sig.high, lv.pdh) + 0.1 * a; }
    if (!direction) return 0;

    const tradeDate = utcDayStr(sig.t);
    const dup = await this.repo.findByDateDirection(tradeDate, direction);
    if (dup) return 0; // this side already taken today

    const entry = sig.close; // next-bar open ≈ signal close on 1h
    const risk = Math.abs(entry - stop);
    if (!(risk > 0)) return 0;
    const takeProfit = direction === 'LONG' ? entry + rr * risk : entry - rr * risk;
    const quantity = riskUsd / risk;

    const created = await this.repo.create({
      symbol: SYMBOL,
      timeframe: '1h',
      tradeDate,
      direction,
      pdh: lv.pdh,
      pdl: lv.pdl,
      signalClose: sig.close,
      entryPrice: entry,
      initialStopLoss: stop,
      stopLoss: stop,
      takeProfit,
      riskUsd,
      quantity,
      rrPlanned: rr,
      openedAt: new Date(sig.closeT),
      lastPrice: price,
      lastCheckedAt: new Date(),
    });
    this.logger.log(`opened ${direction} @ ${entry.toFixed(1)} SL ${stop.toFixed(1)} TP ${takeProfit.toFixed(1)} (PDH ${lv.pdh.toFixed(0)} / PDL ${lv.pdl.toFixed(0)})`);
    // Render the 1h setup chart AFTER the entry is saved — never block or fail the entry over it.
    this.renderAndAttachEntryChart(created.id).catch((e) =>
      this.logger.warn(`chart render failed for ${created.id}: ${e instanceof Error ? e.message : e}`),
    );
    return 1;
  }

  /**
   * Render the 1h setup chart at the moment the trade was opened (entry price line +
   * entry arrow), upload to R2, and store the URL on the row. Called right after entry
   * and also exposed as POST /:id/chart for manual (re)render / backfill.
   */
  async renderAndAttachEntryChart(tradeId: string): Promise<{ id: string; chartUrl: string }> {
    const trade = await this.repo.findById(tradeId);
    if (!trade) throw new NotFoundException(`Strategy paper trade ${tradeId} not found`);

    const tf = trade.timeframe in SETUP_CHART_TF_CONFIG ? trade.timeframe : '1h';
    const { limit, display } = SETUP_CHART_TF_CONFIG[tf] ?? SETUP_CHART_TF_CONFIG['1h']!;
    const raw = await this.binance.fetchKlines({ symbol: trade.symbol, timeframe: tf as AnalysisTimeframe, limit });
    if (raw.length === 0) throw new NotFoundException(`No ${tf} candles for ${trade.symbol}`);

    const candles: OhlcCandle[] = raw.map((k) => ({
      time: Number(k[0]),
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[5])),
    }));
    const side = trade.direction === 'SHORT' ? 'short' : 'long';
    const closed = trade.status !== 'OPEN' && trade.exitPrice != null;
    const buffer = await renderSetupChart({
      symbol: trade.symbol,
      timeframe: tf,
      candles,
      currentPrice: candles[candles.length - 1]!.close,
      display,
      markers: closed
        ? [{ kind: 'closed', holdSide: side, entryPrice: trade.entryPrice, closePrice: trade.exitPrice!, pnlUsd: trade.pnlUsd ?? 0 }]
        : [{ kind: 'open', holdSide: side, entryPrice: trade.entryPrice }],
      entryMarker: { price: trade.entryPrice, side },
    });

    const objectKey = `strategy-charts/${trade.id}.png`;
    const stored = await this.storage.uploadFile(
      { buffer, mimetype: 'image/png', originalname: `${trade.id}.png`, size: buffer.length },
      objectKey,
    );
    await this.repo.update(trade.id, { chartUrl: stored.url, chartObjectKey: stored.key });
    this.logger.log(`attached ${tf} setup chart to ${trade.id}: ${stored.url}`);
    return { id: trade.id, chartUrl: stored.url };
  }

  // ---------------- read / write for the UI ----------------

  async getBoard(): Promise<StrategyPaperBoard> {
    const [rows, config] = await Promise.all([this.repo.list(), this.repo.getConfig()]);
    let price: number | null = null;
    let levels: { pdh: number; pdl: number; day: string } | null = null;
    try {
      const candles = await this.fetchCandles();
      const closed = candles.filter((c) => c.closeT <= Date.now());
      price = candles[candles.length - 1]?.close ?? null;
      const today = utcDayIndex(Date.now());
      const lv = this.prevDayLevels(closed, today);
      if (lv) levels = { ...lv, day: utcDayStr(Date.now() - 864e5) };
    } catch (e) {
      this.logger.warn(`live price/levels unavailable (non-fatal): ${e instanceof Error ? e.message : e}`);
    }

    const dtos = rows.map((r) => this.toDto(r, price));
    const openTrades = dtos.filter((t) => t.status === 'OPEN');
    const history = dtos.filter((t) => t.status !== 'OPEN');
    const closed = history;
    const wins = closed.filter((t) => t.status === 'CLOSED_TP' || (t.pnlUsd ?? 0) > 0).length;
    const losses = closed.filter((t) => (t.pnlUsd ?? 0) < 0).length;
    const eod = closed.filter((t) => t.status === 'CLOSED_EOD').length;
    const totalPnlUsd = closed.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
    const totalR = closed.reduce((s, t) => s + (t.rMultiple ?? 0), 0);

    return {
      symbol: SYMBOL,
      price,
      config: {
        name: config.name,
        enabled: config.enabled,
        symbol: config.symbol,
        timeframe: config.timeframe,
        riskUsd: config.riskUsd,
        rrPlanned: config.rrPlanned,
        docMarkdown: config.docMarkdown,
      },
      openTrades,
      history,
      levels,
      stats: {
        closedCount: closed.length,
        wins,
        losses,
        eod,
        winRate: closed.length > 0 ? (wins / closed.length) * 100 : null,
        totalPnlUsd,
        totalR,
      },
    };
  }

  async saveFeedback(id: string, rating: number | null, note: string | null): Promise<StrategyPaperTradeDto> {
    const trade = await this.repo.findById(id);
    if (!trade) throw new NotFoundException(`Strategy paper trade ${id} not found`);
    const clean = rating == null ? null : Math.max(1, Math.min(5, Math.round(rating)));
    const updated = await this.repo.update(id, {
      feedbackRating: clean,
      feedbackNote: note?.trim() ? note.trim() : null,
      feedbackAt: new Date(),
    });
    return this.toDto(updated, null);
  }

  async getDoc(): Promise<StrategyPaperConfigDto> {
    const c = await this.repo.getConfig();
    return { name: c.name, enabled: c.enabled, symbol: c.symbol, timeframe: c.timeframe, riskUsd: c.riskUsd, rrPlanned: c.rrPlanned, docMarkdown: c.docMarkdown };
  }

  async updateDoc(input: { docMarkdown?: string; name?: string; enabled?: boolean; riskUsd?: number; rrPlanned?: number }): Promise<StrategyPaperConfigDto> {
    const data: Record<string, unknown> = {};
    if (typeof input.docMarkdown === 'string') data.docMarkdown = input.docMarkdown;
    if (typeof input.name === 'string' && input.name.trim()) data.name = input.name.trim();
    if (typeof input.enabled === 'boolean') data.enabled = input.enabled;
    if (typeof input.riskUsd === 'number' && input.riskUsd > 0) data.riskUsd = input.riskUsd;
    if (typeof input.rrPlanned === 'number' && input.rrPlanned > 0) data.rrPlanned = input.rrPlanned;
    const c = await this.repo.updateConfig(data);
    return { name: c.name, enabled: c.enabled, symbol: c.symbol, timeframe: c.timeframe, riskUsd: c.riskUsd, rrPlanned: c.rrPlanned, docMarkdown: c.docMarkdown };
  }

  /** Reset the editable doc back to the built-in default. */
  async resetDoc(): Promise<StrategyPaperConfigDto> {
    return this.updateDoc({ docMarkdown: DEFAULT_STRATEGY_DOC });
  }

  // ---------------- trading-log notes ----------------

  /** Newest-first free-text log for the strategy board (shown in the "Ghi chú" dialog). */
  async listNotes(): Promise<StrategyPaperNoteDto[]> {
    const rows = await this.notesRepo.list();
    return rows.map((r) => this.toNoteDto(r));
  }

  /** Save one new note (body required, images optional) and return it. */
  async createNote(input: { body?: string; images?: unknown }): Promise<StrategyPaperNoteDto> {
    const body = (input.body ?? '').trim();
    if (!body) throw new BadRequestException('Nội dung ghi chú không được để trống');
    const images = Array.isArray(input.images)
      ? input.images.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      : [];
    const row = await this.notesRepo.create({ body, images });
    return this.toNoteDto(row);
  }

  async deleteNote(id: string): Promise<{ deleted: boolean }> {
    const count = await this.notesRepo.remove(id);
    if (count === 0) throw new NotFoundException(`Strategy paper note ${id} not found`);
    return { deleted: true };
  }

  private toNoteDto(row: { id: string; body: string; images: unknown; createdAt: Date }): StrategyPaperNoteDto {
    return {
      id: row.id,
      body: row.body,
      images: Array.isArray(row.images) ? (row.images as unknown[]).filter((u): u is string => typeof u === 'string') : [],
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDto(row: TradeRow, price: number | null): StrategyPaperTradeDto {
    const direction = row.direction === 'SHORT' ? 'SHORT' : 'LONG';
    const isOpen = row.status === 'OPEN';
    const live = isOpen ? price : null;
    const dirSign = direction === 'SHORT' ? -1 : 1;
    let unrealizedPnlUsd: number | null = null;
    let unrealizedR: number | null = null;
    if (isOpen && live != null) {
      const gross = row.quantity * (live - row.entryPrice) * dirSign;
      const fee = (row.quantity * row.entryPrice + row.quantity * live) * FEE_PCT;
      unrealizedPnlUsd = gross - fee;
      unrealizedR = unrealizedPnlUsd / row.riskUsd;
    }
    return {
      id: row.id,
      symbol: row.symbol,
      timeframe: row.timeframe,
      tradeDate: row.tradeDate,
      direction,
      status: row.status,
      pdh: row.pdh,
      pdl: row.pdl,
      signalClose: row.signalClose,
      entryPrice: row.entryPrice,
      initialStopLoss: row.initialStopLoss,
      stopLoss: row.stopLoss,
      takeProfit: row.takeProfit,
      riskUsd: row.riskUsd,
      quantity: row.quantity,
      rrPlanned: row.rrPlanned,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      exitPrice: row.exitPrice,
      exitReason: row.exitReason,
      pnlUsd: row.pnlUsd,
      rMultiple: row.rMultiple,
      lastPrice: row.lastPrice,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      feedbackRating: row.feedbackRating,
      feedbackNote: row.feedbackNote,
      feedbackAt: row.feedbackAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      unrealizedPnlUsd,
      unrealizedR,
      chartUrl: row.chartUrl ?? null,
    };
  }
}
