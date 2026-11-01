import { Injectable, Logger } from '@nestjs/common';
import {
  ENTRY_STRATEGIES,
  evaluateEntryStrategies,
  fetchEntryFeatures,
  findEntryStrategy,
  type EntryFeatures,
  type EntryKlineFetcher,
} from '@app/core';
import {
  prisma,
  createTradeEntryRepository,
  type TradeEntryDeclared,
  type TradeEntryExchange,
  type TradeEntrySource,
} from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

/** What a caller (Setup tab, AI card, auto-trade) says about an order it places. */
export type EntryIntent = TradeEntryDeclared & { source?: TradeEntrySource };

export type RecordOrderInput = {
  exchange: TradeEntryExchange;
  symbol: string;
  holdSide: 'long' | 'short';
  orderType: 'MARKET' | 'LIMIT';
  /** The side was already open → this order adds to it (DCA). */
  isAdd: boolean;
  /** Trade key of the position the order belongs to, when known. */
  tradeKey: string | null;
  orderId?: string | null;
  price: number;
  size: number;
  marginUsd: number;
  leverage: number;
  takeProfitPrice?: number | null;
  intent?: EntryIntent | null;
};

const FEATURE_TTL_MS = 60_000;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const r2 = (n: number | null) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

/**
 * Records WHY an order was placed (declared strategy / grade / reason / tags)
 * into `trade_entries`, and answers the AI tools that read it back:
 * `entry_check` (which strategies a coin matches right now) and
 * `strategy_review` (how real trades of each strategy have done). Market
 * features + the journal note are added by the worker (TradeEntryRecorderService).
 */
@Injectable()
export class TradeEntryService {
  private readonly logger = new Logger(TradeEntryService.name);
  private readonly repo = createTradeEntryRepository();
  private readonly featureCache = new Map<string, { at: number; value: EntryFeatures | null }>();

  constructor(private readonly binance: BinanceMarketDataService) {}

  private readonly fetcher: EntryKlineFetcher = async ({ symbol, interval, limit }) =>
    (await this.binance.fetchKlines({ symbol, timeframe: interval as never, limit })) as unknown as ReadonlyArray<
      ReadonlyArray<string | number>
    >;

  /** Best-effort: never throws — a logging failure must not fail the order that was just placed. */
  async recordOrder(o: RecordOrderInput): Promise<void> {
    try {
      const declared = this.normalizeIntent(o.intent);
      const source: TradeEntrySource = o.intent?.source ?? 'SETUP_TAB';
      const plan = { ...(declared.plan ?? {}), ...(o.takeProfitPrice ? { takeProfitPrice: o.takeProfitPrice } : {}) };
      const base = {
        exchange: o.exchange,
        symbol: o.symbol,
        holdSide: o.holdSide,
        source,
        orderType: o.orderType,
        orderId: o.orderId ?? null,
        enteredAt: new Date(),
        price: o.price,
        size: o.size,
        marginUsd: o.marginUsd,
        leverage: o.leverage,
        ...declared,
        plan: Object.keys(plan).length ? plan : null,
      };
      if (o.isAdd) {
        await this.repo.create({
          ...base,
          tradeKey: o.tradeKey,
          event: 'DCA',
          status: o.orderType === 'LIMIT' ? 'pending' : 'recorded',
        });
      } else if (o.orderType === 'MARKET' && o.tradeKey) {
        await this.repo.upsertOpen({ ...base, tradeKey: o.tradeKey, event: 'OPEN' });
      } else {
        // LIMIT (or a market open whose position we could not read back): the
        // worker claims this intent when it sees the position open.
        await this.repo.create({ ...base, tradeKey: null, event: 'OPEN', status: 'pending' });
      }
    } catch (err) {
      this.logger.warn(`Failed to record ${o.exchange} entry ${o.holdSide} ${o.symbol}: ${(err as Error).message}`);
    }
  }

  private normalizeIntent(intent: EntryIntent | null | undefined): TradeEntryDeclared {
    if (!intent) return {};
    const strategy = findEntryStrategy(intent.strategyKey?.trim() || null, intent.strategyVersion ?? null);
    const key = intent.strategyKey?.trim() || null;
    const tags = (intent.tags ?? []).map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean).slice(0, 10);
    return {
      strategyKey: key,
      strategyVersion: strategy?.version ?? intent.strategyVersion ?? null,
      grade: intent.grade?.trim() || null,
      mode: intent.mode ?? strategy?.mode ?? null,
      reason: intent.reason?.trim() || null,
      tags: tags.length ? tags : null,
      plan: intent.plan ?? null,
    };
  }

  listStrategies() {
    return this.repo.listStrategies().then((rows) => {
      const latest = new Map<string, (typeof ENTRY_STRATEGIES)[number]>();
      for (const s of ENTRY_STRATEGIES) if ((latest.get(s.key)?.version ?? 0) < s.version) latest.set(s.key, s);
      return [...latest.values()].map((s) => ({
        key: s.key,
        version: s.version,
        name: s.name,
        mode: s.mode,
        summary: s.summary,
        matchable: s.matchable,
        status: rows.find((r) => r.key === s.key && r.version === s.version)?.status ?? 'ACTIVE',
      }));
    });
  }

  private async liveFeatures(symbol: string): Promise<EntryFeatures | null> {
    const hit = this.featureCache.get(symbol);
    if (hit && Date.now() - hit.at < FEATURE_TTL_MS) return hit.value;
    const value = await fetchEntryFeatures(this.fetcher, symbol, new Date(), null).catch((err) => {
      this.logger.debug(`entry features ${symbol}: ${(err as Error).message}`);
      return null;
    });
    this.featureCache.set(symbol, { at: Date.now(), value });
    return value;
  }

  /** Live snapshot of one coin + every strategy's checklist (matched or not). */
  async entryCheck(input: { symbol: string; side: 'long' | 'short'; exchange: TradeEntryExchange; size?: number | null }) {
    const symbol = pairOf(input.symbol);
    const features = await this.liveFeatures(symbol);
    const oppositeSide = input.side === 'short' ? 'long' : 'short';
    const where = { symbol, holdSide: oppositeSide, status: 'open' };
    const opp =
      input.exchange === 'mexc'
        ? await prisma.mexcTrade.findFirst({ where, orderBy: { openedAt: 'desc' } })
        : await prisma.bitgetTrade.findFirst({ where, orderBy: { openedAt: 'desc' } });
    const strategies = evaluateEntryStrategies(features, {
      symbol,
      side: input.side,
      opposite: opp ? { size: Number(opp.openTotalPos) } : null,
      size: input.size ?? null,
    });
    return {
      symbol,
      side: input.side,
      exchange: input.exchange,
      features,
      matched: strategies.filter((s) => s.grade).map((s) => ({ key: s.key, version: s.version, grade: s.grade, mode: s.mode })),
      strategies,
    };
  }

  /**
   * Real-trade results per strategy over the last `days`: grouped by what was
   * DECLARED on the entry and, separately, by which rules the entry MATCHED at
   * the time (so undeclared / old trades are still scored).
   */
  async strategyReview(input: { days?: number; exchange?: TradeEntryExchange }) {
    const days = Math.min(400, Math.max(1, Math.round(input.days ?? 90)));
    const since = new Date(Date.now() - days * 86_400_000);
    const entries = await this.repo.listSince(since, { event: 'OPEN', exchange: input.exchange });
    const keysBy = { bitget: [] as string[], mexc: [] as string[] };
    for (const e of entries) if (e.tradeKey) keysBy[e.exchange as TradeEntryExchange]?.push(e.tradeKey);
    const [bg, mx] = await Promise.all([
      keysBy.bitget.length ? prisma.bitgetTrade.findMany({ where: { tradeKey: { in: keysBy.bitget } } }) : [],
      keysBy.mexc.length ? prisma.mexcTrade.findMany({ where: { tradeKey: { in: keysBy.mexc } } }) : [],
    ]);
    type T = { status: string; netProfit: number | null; openedAt: Date; closedAt: Date | null; troughRoePct: number | null };
    const trades = new Map<string, T>();
    for (const t of bg) trades.set(`bitget|${t.tradeKey}`, t as unknown as T);
    for (const t of mx) trades.set(`mexc|${t.tradeKey}`, t as unknown as T);

    const groups = { declared: new Map<string, T[]>(), matched: new Map<string, T[]>() };
    const push = (m: Map<string, T[]>, k: string, t: T) => m.set(k, [...(m.get(k) ?? []), t]);
    const all: T[] = [];
    for (const e of entries) {
      const t = e.tradeKey ? trades.get(`${e.exchange}|${e.tradeKey}`) : undefined;
      if (!t) continue;
      all.push(t);
      push(groups.declared, e.strategyKey ? `${e.strategyKey}${e.grade ? ` ${e.grade}` : ''}` : 'chưa khai báo', t);
      const matched = Array.isArray(e.matched) ? (e.matched as Array<{ key: string; grade: string }>) : null;
      if (matched == null || e.features == null) push(groups.matched, 'chưa có dữ liệu', t);
      else if (!matched.length) push(groups.matched, 'không khớp quy tắc nào', t);
      else for (const m of matched) push(groups.matched, `${m.key} ${m.grade}`, t);
    }
    const now = Date.now();
    const stats = (ts: T[]) => {
      const closed = ts.filter((t) => t.status === 'closed');
      const open = ts.filter((t) => t.status !== 'closed');
      const wins = closed.filter((t) => (t.netProfit ?? 0) > 0).length;
      return {
        trades: ts.length,
        closed: closed.length,
        open: open.length,
        winRatePct: closed.length ? r2((wins / closed.length) * 100) : null,
        netProfitUsd: r2(closed.reduce((s, t) => s + (t.netProfit ?? 0), 0)),
        medianHoldDaysClosed: r2(median(closed.filter((t) => t.closedAt).map((t) => (t.closedAt!.getTime() - t.openedAt.getTime()) / 86_400_000))),
        openOver7d: open.filter((t) => now - t.openedAt.getTime() > 7 * 86_400_000).length,
        hitRoeMinus100: ts.filter((t) => t.troughRoePct != null && t.troughRoePct <= -100).length,
      };
    };
    const table = (m: Map<string, T[]>) =>
      [...m.entries()].map(([group, ts]) => ({ group, ...stats(ts) })).sort((a, b) => b.trades - a.trades);
    return {
      days,
      exchange: input.exchange ?? 'both',
      note:
        'declared = chiến lược khai báo khi vào lệnh; matched = quy tắc mà bối cảnh lúc vào thực sự khớp (tính lại cho cả lệnh cũ). ' +
        'hitRoeMinus100 = số lệnh từng gồng tới ROE ≤ −100%; openOver7d = số lệnh đang mở quá 7 ngày.',
      total: stats(all),
      byDeclared: table(groups.declared),
      byMatched: table(groups.matched),
    };
  }
}

function pairOf(raw: string): string {
  const s = String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.endsWith('USDT') ? s : `${s}USDT`;
}
