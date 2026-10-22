import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  createConversationRepository,
  createSkillTradeSetupRepository,
  createStrategyPaperTradePathRepository,
  createStrategyPaperTradeRepository,
} from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import {
  SCALP_PENDING_TTL_MS,
  SCALP_SETUP_MAX_AGE_MS,
  SCALP_SKILL_DOC,
  SCALP_SKILL_STRATEGY,
  SCALP_SKILL_STRATEGY_ID,
} from './scalp-skill-strategy';
import { buildTimeStopReport, emptyPath, extendPath, type PathTrade, type TimeStopReport } from './scalp-trade-path';
import { StrategyPaperTradesService } from './strategy-paper-trades.service';

const BASE = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';
const FEE_PCT = 0.0005; // 0.05% per side, same as the other paper engines
const MINUTE = 60_000;
const CLOSED_STATUSES = ['CLOSED_TP', 'CLOSED_SL', 'CLOSED_BE'];

type Bar = { t: number; closeT: number; open: number; high: number; low: number; close: number };
type TradeRow = NonNullable<Awaited<ReturnType<ReturnType<typeof createStrategyPaperTradeRepository>['findById']>>>;
type SetupRow = NonNullable<Awaited<ReturnType<ReturnType<typeof createSkillTradeSetupRepository>['findById']>>>;

/** Net PnL of one leg, fees on both sides. */
function legPnl(qty: number, entry: number, exit: number, dir: 1 | -1): number {
  return qty * (exit - entry) * dir - (qty * entry + qty * exit) * FEE_PCT;
}

/**
 * Turns accepted Scalping-skill setups into paper trades and manages them on 1m candles:
 * PENDING → OPEN when a LIMIT/STOP entry is touched (or EXPIRED), then TP1 (50% + stop to
 * break-even), TP2 or SL. Results show on /trading-analysis under strategy "scalping-skill".
 */
@Injectable()
export class ScalpSkillPaperService {
  private readonly logger = new Logger(ScalpSkillPaperService.name);
  private readonly repo = createStrategyPaperTradeRepository();
  private readonly setupRepo = createSkillTradeSetupRepository();
  private readonly convRepo = createConversationRepository();
  private readonly pathRepo = createStrategyPaperTradePathRepository();
  private ticking = false;

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly paperTrades: StrategyPaperTradesService,
  ) {}

  private config() {
    return this.repo.getConfig(SCALP_SKILL_STRATEGY_ID, {
      name: SCALP_SKILL_STRATEGY.name,
      timeframe: SCALP_SKILL_STRATEGY.timeframe,
      rrPlanned: SCALP_SKILL_STRATEGY.rr,
      docMarkdown: SCALP_SKILL_DOC,
    });
  }

  private async loadOwnedSetup(setupId: string, userId: string): Promise<SetupRow> {
    const setup = await this.setupRepo.findById(setupId);
    if (!setup) throw new NotFoundException(`Setup ${setupId} not found`);
    const conv = await this.convRepo.findById(setup.conversationId);
    if (!conv || conv.userId !== userId) throw new ForbiddenException('Setup không thuộc về bạn');
    return setup;
  }

  // ---------------- accept / cancel (from the chat) ----------------

  async accept(setupId: string, userId: string) {
    const setup = await this.loadOwnedSetup(setupId, userId);
    if (setup.status !== 'PROPOSED') {
      throw new BadRequestException(setup.status === 'ACCEPTED' ? 'Setup này đã được accept' : 'Setup này đã bị huỷ');
    }
    if (Date.now() - setup.createdAt.getTime() > SCALP_SETUP_MAX_AGE_MS) {
      throw new BadRequestException('Setup đã quá 60 phút, giá đã thay đổi. Hãy hỏi lại để có setup mới.');
    }

    const price = await this.binance.fetchCurrentPrice(setup.symbol);
    const long = setup.direction === 'LONG';
    const dir: 1 | -1 = long ? 1 : -1;
    // A real LIMIT below (long) / STOP above (long) the market fills right away once price is there.
    const fillNow =
      setup.orderType === 'MARKET' ||
      (setup.orderType === 'LIMIT' && (long ? price <= setup.entryPrice : price >= setup.entryPrice)) ||
      (setup.orderType === 'STOP' && (long ? price >= setup.entryPrice : price <= setup.entryPrice));
    const entry = fillNow ? price : setup.entryPrice;
    const finalTp = setup.takeProfit2 ?? setup.takeProfit1;

    const beyond = (a: number, b: number) => (a - b) * dir > 0; // a is past b in the trade's favour
    if (!beyond(entry, setup.stopLoss) || !beyond(setup.takeProfit1, entry)) {
      throw new BadRequestException(
        `Giá hiện tại ${price} đã vượt SL (${setup.stopLoss}) hoặc TP1 (${setup.takeProfit1}) của setup, không vào lệnh.`,
      );
    }

    const config = await this.config();
    const risk = Math.abs(entry - setup.stopLoss);
    const now = new Date();
    const trade = await this.repo.create({
      strategyId: SCALP_SKILL_STRATEGY_ID,
      symbol: setup.symbol,
      timeframe: SCALP_SKILL_STRATEGY.timeframe,
      tradeDate: now.toISOString().slice(0, 10),
      direction: setup.direction,
      status: fillNow ? 'OPEN' : 'PENDING',
      orderType: setup.orderType,
      expiresAt: fillNow ? null : new Date(now.getTime() + SCALP_PENDING_TTL_MS),
      pdh: null,
      pdl: null,
      signalClose: price,
      entryPrice: entry,
      initialStopLoss: setup.stopLoss,
      stopLoss: setup.stopLoss,
      takeProfit: finalTp,
      takeProfit1: setup.takeProfit2 != null ? setup.takeProfit1 : null,
      riskUsd: config.riskUsd,
      quantity: config.riskUsd / risk,
      rrPlanned: Math.abs(finalTp - entry) / risk,
      openedAt: now,
      lastPrice: price,
      lastCheckedAt: now,
    });
    const updated = await this.setupRepo.update(setup.id, { status: 'ACCEPTED', paperTradeId: trade.id, decidedAt: now });
    this.logger.log(
      `[scalping-skill ${trade.symbol}] accepted ${setup.direction} ${setup.orderType} → ${trade.status} @ ${entry} SL ${setup.stopLoss} TP ${finalTp}`,
    );
    if (fillNow) this.renderChart(trade.id);

    return { setup: { ...updated, trade: this.tradeSummary(trade) } };
  }

  async cancel(setupId: string, userId: string) {
    const setup = await this.loadOwnedSetup(setupId, userId);
    if (setup.status === 'CANCELLED') throw new BadRequestException('Setup này đã bị huỷ');

    let trade: TradeRow | null = null;
    if (setup.status === 'ACCEPTED' && setup.paperTradeId) {
      trade = await this.repo.findById(setup.paperTradeId);
      if (trade && trade.status !== 'PENDING') {
        throw new BadRequestException('Lệnh đã khớp, không huỷ được nữa. Theo dõi ở trang Trading Analysis.');
      }
      if (trade) trade = await this.repo.update(trade.id, { status: 'CANCELLED', closedAt: new Date() });
    }
    const updated = await this.setupRepo.update(setup.id, { status: 'CANCELLED', decidedAt: new Date() });
    return { setup: { ...updated, trade: trade ? this.tradeSummary(trade) : null } };
  }

  private tradeSummary(t: TradeRow) {
    return { id: t.id, status: t.status, entryPrice: t.entryPrice, stopLoss: t.stopLoss, exitPrice: t.exitPrice, pnlUsd: t.pnlUsd, rMultiple: t.rMultiple };
  }

  private renderChart(tradeId: string): void {
    this.paperTrades.renderAndAttachEntryChart(tradeId).catch((e) =>
      this.logger.warn(`chart render failed for ${tradeId}: ${e instanceof Error ? e.message : e}`),
    );
  }

  // ---------------- monitor ----------------

  /** Every minute, a little after the 1m close so the candle is final. */
  @Cron('20 * * * * *')
  async scheduledTick(): Promise<void> {
    if (this.ticking) return; // a slow Binance call must not stack ticks
    this.ticking = true;
    try {
      await this.runTick();
    } catch (e) {
      this.logger.warn(`scalp tick failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.ticking = false;
    }
  }

  async runTick(): Promise<{ opened: number; closed: number }> {
    let opened = 0;
    let closed = 0;
    for (const trade of await this.repo.findByStatuses(SCALP_SKILL_STRATEGY_ID, ['PENDING', 'OPEN'])) {
      try {
        const r = await this.manage(trade);
        opened += r.filled ? 1 : 0;
        closed += r.closed ? 1 : 0;
      } catch (e) {
        this.logger.warn(`[scalping-skill ${trade.symbol}] manage ${trade.id} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { opened, closed };
  }

  private async fetchMinuteBars(symbol: string, startTime: number): Promise<Bar[]> {
    const res = await fetch(`${BASE}/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${startTime}&limit=1000`);
    if (!res.ok) throw new Error(`Binance API error ${res.status} for ${symbol} 1m`);
    const rows = (await res.json()) as Array<[number, string, string, string, string, string, number]>;
    const now = Date.now();
    return rows
      .map((r) => ({ t: r[0], closeT: r[6], open: parseFloat(r[1]), high: parseFloat(r[2]), low: parseFloat(r[3]), close: parseFloat(r[4]) }))
      .filter((b) => b.closeT <= now);
  }

  /** Replays the 1m candles since the last check; returns what changed. */
  private async manage(trade: TradeRow): Promise<{ filled: boolean; closed: boolean }> {
    // Only whole candles that started after the last check (or after the accept moment).
    const from = Math.ceil((trade.lastCheckedAt ?? trade.createdAt).getTime() / MINUTE) * MINUTE;
    const bars = (await this.fetchMinuteBars(trade.symbol, from)).filter((b) => b.t >= from);
    if (bars.length === 0) return { filled: false, closed: false };

    const dir: 1 | -1 = trade.direction === 'SHORT' ? -1 : 1;
    const s = {
      status: trade.status,
      entryPrice: trade.entryPrice,
      openedAt: trade.openedAt,
      quantity: trade.quantity,
      stopLoss: trade.stopLoss,
      tp1HitAt: trade.tp1HitAt,
      realizedPnlUsd: trade.realizedPnlUsd ?? 0,
      exit: null as { price: number; reason: 'TP' | 'SL' | 'BE'; at: number } | null,
      expiredAt: null as Date | null,
    };
    let filled = false;
    const touchedLow = (b: Bar, p: number) => b.low <= p;
    const touchedHigh = (b: Bar, p: number) => b.high >= p;
    // "Against" = the direction that hurts the trade (down for a long), "with" = the favourable one.
    const against = (b: Bar, p: number) => (dir === 1 ? touchedLow(b, p) : touchedHigh(b, p));
    const withTrade = (b: Bar, p: number) => (dir === 1 ? touchedHigh(b, p) : touchedLow(b, p));

    for (const b of bars) {
      if (s.status === 'PENDING') {
        if (trade.expiresAt && b.t >= trade.expiresAt.getTime()) {
          s.status = 'EXPIRED';
          s.expiredAt = trade.expiresAt;
          break;
        }
        // LIMIT fills on a pullback to entry, STOP on a breakout through it; a gap fills at the open.
        const limit = trade.orderType === 'LIMIT';
        const hit = limit ? against(b, trade.entryPrice) : withTrade(b, trade.entryPrice);
        if (!hit) continue;
        const gapped = limit ? (b.open - trade.entryPrice) * dir < 0 : (b.open - trade.entryPrice) * dir > 0;
        s.entryPrice = gapped ? b.open : trade.entryPrice;
        const risk = (s.entryPrice - trade.initialStopLoss) * dir;
        s.status = 'OPEN';
        s.openedAt = new Date(b.t);
        filled = true;
        if (risk <= 0) {
          // Gapped straight through the stop — out at the open, a full loss.
          s.exit = { price: b.open, reason: 'SL', at: b.closeT };
          break;
        }
        s.quantity = trade.riskUsd / risk;
        // Same candle: only the stop counts (we can't know if the target came after the fill).
        if (against(b, s.stopLoss)) {
          s.exit = { price: s.stopLoss, reason: 'SL', at: b.closeT };
          break;
        }
        continue;
      }

      // OPEN — the stop is checked first (worst case when a candle spans both).
      if (against(b, s.stopLoss)) {
        s.exit = { price: s.stopLoss, reason: s.tp1HitAt ? 'BE' : 'SL', at: b.closeT };
        break;
      }
      if (trade.takeProfit1 != null && !s.tp1HitAt && withTrade(b, trade.takeProfit1)) {
        s.realizedPnlUsd = legPnl(s.quantity / 2, s.entryPrice, trade.takeProfit1, dir);
        s.tp1HitAt = new Date(b.closeT);
        s.stopLoss = s.entryPrice;
      }
      if (withTrade(b, trade.takeProfit)) {
        s.exit = { price: trade.takeProfit, reason: 'TP', at: b.closeT };
        break;
      }
    }

    const last = bars[bars.length - 1]!;
    const data: Record<string, unknown> = {
      status: s.status,
      entryPrice: s.entryPrice,
      openedAt: s.openedAt,
      quantity: s.quantity,
      stopLoss: s.stopLoss,
      tp1HitAt: s.tp1HitAt,
      realizedPnlUsd: s.tp1HitAt ? s.realizedPnlUsd : null,
      lastPrice: last.close,
      lastCheckedAt: new Date(last.closeT + 1),
    };
    if (s.expiredAt) data.closedAt = s.expiredAt;
    if (s.exit) {
      const restQty = s.tp1HitAt ? s.quantity / 2 : s.quantity;
      const pnl = (s.tp1HitAt ? s.realizedPnlUsd : 0) + legPnl(restQty, s.entryPrice, s.exit.price, dir);
      Object.assign(data, {
        status: s.exit.reason === 'TP' ? 'CLOSED_TP' : s.exit.reason === 'BE' ? 'CLOSED_BE' : 'CLOSED_SL',
        exitPrice: s.exit.price,
        exitReason: s.exit.reason,
        pnlUsd: pnl,
        rMultiple: pnl / trade.riskUsd,
        closedAt: new Date(s.exit.at),
      });
    }
    await this.repo.update(trade.id, data);

    if (s.status !== 'PENDING' && s.status !== 'EXPIRED') {
      await this.logPath(trade, { ...s, exitAt: s.exit ? new Date(s.exit.at) : null }, bars, filled).catch((e) =>
        this.logger.warn(`[scalping-skill ${trade.symbol}] path log failed for ${trade.id}: ${e instanceof Error ? e.message : e}`),
      );
    }

    if (filled || s.exit) {
      this.logger.log(
        `[scalping-skill ${trade.symbol}] ${trade.id} ${filled ? `filled @ ${s.entryPrice}` : ''}${s.exit ? ` closed ${s.exit.reason} @ ${s.exit.price}` : ''}`,
      );
      this.renderChart(trade.id);
    } else if (s.expiredAt) {
      this.logger.log(`[scalping-skill ${trade.symbol}] ${trade.id} expired unfilled`);
    }
    return { filled, closed: s.exit != null };
  }

  // ---------------- path log + time-stop study ----------------

  private pathTrade(
    trade: TradeRow,
    s: { entryPrice: number; openedAt: Date; tp1HitAt: Date | null; exitAt: Date | null },
  ): PathTrade {
    return {
      entryPrice: s.entryPrice,
      initialStopLoss: trade.initialStopLoss,
      direction: trade.direction,
      orderType: trade.orderType,
      openedAt: s.openedAt,
      tp1HitAt: s.tp1HitAt,
      exitAt: s.exitAt,
    };
  }

  /** 1m candles from `from` until `until` (or until the latest closed one), a page of 1000 at a time. */
  private async fetchMinuteRange(symbol: string, from: number, until: number | null): Promise<Bar[]> {
    const out: Bar[] = [];
    let start = Math.floor(from / MINUTE) * MINUTE;
    for (let page = 0; page < 12; page++) {
      const bars = await this.fetchMinuteBars(symbol, start);
      out.push(...bars);
      const last = bars[bars.length - 1];
      if (!last || bars.length < 1000 || (until != null && last.closeT >= until)) break;
      start = last.t + MINUTE;
    }
    return out;
  }

  /** Records the minute path of a filled trade; a trade without a log yet is rebuilt from its fill. */
  private async logPath(
    trade: TradeRow,
    s: { entryPrice: number; openedAt: Date; tp1HitAt: Date | null; exitAt: Date | null },
    bars: Bar[],
    filledNow: boolean,
  ): Promise<void> {
    const t = this.pathTrade(trade, s);
    let path = await this.pathRepo.find(trade.id);
    if (!path) {
      const fresh = emptyPath(t);
      if (!fresh) return;
      // Filled before this tick (or before the log existed): replay everything since the fill.
      const history = filledNow ? bars : await this.fetchMinuteRange(trade.symbol, s.openedAt.getTime(), null);
      await this.pathRepo.save(trade.id, extendPath(fresh, t, history));
      return;
    }
    await this.pathRepo.save(trade.id, extendPath(path, t, bars));
  }

  /**
   * What closed scalping-skill trades would have made with a time stop of 10m … 4h (TP1 not hit
   * by then → exit at that minute's close), next to the current no-time-stop result.
   * Closed trades without a log yet are backfilled from Binance first.
   */
  async timeStopReport(): Promise<TimeStopReport & { closedTrades: number }> {
    const closed = (await this.repo.findByStatuses(SCALP_SKILL_STRATEGY_ID, CLOSED_STATUSES)).filter((t) => t.rMultiple != null);
    const paths = new Map((await this.pathRepo.findMany(closed.map((t) => t.id))).map((p) => [p.tradeId, p]));

    for (const trade of closed) {
      const logged = paths.get(trade.id);
      if (logged?.exitMin != null || !trade.closedAt) continue;
      try {
        const t = this.pathTrade(trade, { entryPrice: trade.entryPrice, openedAt: trade.openedAt, tp1HitAt: trade.tp1HitAt, exitAt: trade.closedAt });
        const fresh = emptyPath(t);
        if (!fresh) continue;
        const bars = await this.fetchMinuteRange(trade.symbol, trade.openedAt.getTime(), trade.closedAt.getTime());
        const path = extendPath(fresh, t, bars);
        await this.pathRepo.save(trade.id, path);
        paths.set(trade.id, { tradeId: trade.id, ...path });
      } catch (e) {
        this.logger.warn(`[scalping-skill] path backfill failed for ${trade.id}: ${e instanceof Error ? e.message : e}`);
      }
    }

    const study = closed.flatMap((t) => {
      const path = paths.get(t.id);
      return path && path.exitMin != null ? [{ id: t.id, rMultiple: t.rMultiple!, feePct: FEE_PCT, path }] : [];
    });
    return { ...buildTimeStopReport(study), closedTrades: closed.length };
  }
}
