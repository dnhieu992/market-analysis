import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type TradeEntryExchange = 'bitget' | 'mexc';
export type TradeEntryEvent = 'OPEN' | 'DCA';
export type TradeEntrySource = 'AI_CARD' | 'SETUP_TAB' | 'LIMIT' | 'AUTO' | 'EXCHANGE_APP' | 'BACKFILL';

/** What the trader / AI card declares about an entry. Every field is optional. */
export type TradeEntryDeclared = {
  strategyKey?: string | null;
  strategyVersion?: number | null;
  grade?: string | null;
  mode?: string | null;
  reason?: string | null;
  tags?: string[] | null;
  plan?: Record<string, unknown> | null;
};

export type TradeEntryInput = TradeEntryDeclared & {
  exchange: TradeEntryExchange;
  tradeKey?: string | null;
  symbol: string;
  holdSide: string;
  event: TradeEntryEvent;
  status?: 'recorded' | 'pending' | 'expired';
  source: TradeEntrySource;
  orderType?: 'MARKET' | 'LIMIT' | null;
  orderId?: string | null;
  enteredAt: Date;
  price?: number | null;
  size?: number | null;
  marginUsd?: number | null;
  leverage?: number | null;
  features?: Record<string, unknown> | null;
  featureSetVersion?: number | null;
  matched?: unknown[] | null;
  journaledAt?: Date | null;
};

const json = (v: unknown) => (v == null ? undefined : (v as Prisma.InputJsonValue));
const finite = (n: number | null | undefined) => (n != null && Number.isFinite(n) ? n : null);

function declaredData(d: TradeEntryDeclared) {
  return {
    ...(d.strategyKey !== undefined ? { strategyKey: d.strategyKey } : {}),
    ...(d.strategyVersion !== undefined ? { strategyVersion: d.strategyVersion } : {}),
    ...(d.grade !== undefined ? { grade: d.grade } : {}),
    ...(d.mode !== undefined ? { mode: d.mode } : {}),
    ...(d.reason !== undefined ? { reason: d.reason } : {}),
    ...(d.tags !== undefined ? { tags: json(d.tags) } : {}),
    ...(d.plan !== undefined ? { plan: json(d.plan) } : {}),
  };
}

/**
 * `trade_entries` — one row per entry event (OPEN / DCA) of a Bitget or MEXC
 * trade. Written from two sides that may race: the API records the trader's
 * intent when it places an order, and the worker records every position it sees
 * open (with market features). `upsertOpen` merges the two into one OPEN row per
 * trade, whichever arrives first.
 */
export function createTradeEntryRepository(client = prisma) {
  return {
    create(input: TradeEntryInput) {
      return client.tradeEntry.create({
        data: {
          exchange: input.exchange,
          tradeKey: input.tradeKey ?? null,
          symbol: input.symbol,
          holdSide: input.holdSide,
          event: input.event,
          status: input.status ?? 'recorded',
          source: input.source,
          orderType: input.orderType ?? null,
          orderId: input.orderId ?? null,
          enteredAt: input.enteredAt,
          price: finite(input.price),
          size: finite(input.size),
          marginUsd: finite(input.marginUsd),
          leverage: finite(input.leverage),
          features: json(input.features),
          featureSetVersion: input.featureSetVersion ?? null,
          matched: json(input.matched),
          journaledAt: input.journaledAt ?? null,
          ...declaredData(input),
        },
      });
    },

    findOpenEntry(exchange: TradeEntryExchange, tradeKey: string) {
      return client.tradeEntry.findFirst({ where: { exchange, tradeKey, event: 'OPEN' }, orderBy: { createdAt: 'asc' } });
    },

    listByTradeKey(exchange: TradeEntryExchange, tradeKey: string) {
      return client.tradeEntry.findMany({ where: { exchange, tradeKey }, orderBy: { enteredAt: 'asc' } });
    },

    /**
     * Record the OPEN entry of a trade. When one already exists (the other side
     * got there first) the new information is merged in: declared fields from an
     * intent overwrite an undeclared EXCHANGE_APP row, and features fill gaps.
     */
    async upsertOpen(input: TradeEntryInput) {
      const tradeKey = input.tradeKey;
      if (!tradeKey) return this.create(input);
      const existing = await this.findOpenEntry(input.exchange, tradeKey);
      if (!existing) return this.create({ ...input, event: 'OPEN' });
      const incomingDeclares = input.source !== 'EXCHANGE_APP' && input.source !== 'BACKFILL';
      return client.tradeEntry.update({
        where: { id: existing.id },
        data: {
          ...(incomingDeclares
            ? {
                source: input.source,
                orderType: input.orderType ?? existing.orderType,
                orderId: input.orderId ?? existing.orderId,
                marginUsd: finite(input.marginUsd) ?? existing.marginUsd,
                ...declaredData(input),
              }
            : {}),
          price: existing.price ?? finite(input.price),
          size: existing.size ?? finite(input.size),
          leverage: existing.leverage ?? finite(input.leverage),
          ...(existing.features == null && input.features
            ? { features: json(input.features), featureSetVersion: input.featureSetVersion ?? null, matched: json(input.matched) }
            : {}),
          ...(input.journaledAt ? { journaledAt: input.journaledAt } : {}),
        },
      });
    },

    /**
     * Claim a pending LIMIT intent for a position the worker just saw open:
     * same exchange + symbol + side, placed before the open and not too old.
     */
    async claimPending(exchange: TradeEntryExchange, symbol: string, holdSide: string, openedAt: Date, maxAgeMs: number) {
      const pending = await client.tradeEntry.findFirst({
        where: {
          exchange,
          symbol,
          holdSide,
          status: 'pending',
          tradeKey: null,
          event: 'OPEN',
          createdAt: { gte: new Date(openedAt.getTime() - maxAgeMs), lte: new Date(openedAt.getTime() + 5 * 60_000) },
        },
        orderBy: { createdAt: 'desc' },
      });
      return pending;
    },

    update(id: string, data: Partial<TradeEntryInput>) {
      const { exchange: _e, ...rest } = data;
      return client.tradeEntry.update({
        where: { id },
        data: {
          ...(rest.tradeKey !== undefined ? { tradeKey: rest.tradeKey } : {}),
          ...(rest.status !== undefined ? { status: rest.status } : {}),
          ...(rest.event !== undefined ? { event: rest.event } : {}),
          ...(rest.enteredAt !== undefined ? { enteredAt: rest.enteredAt } : {}),
          ...(rest.price !== undefined ? { price: finite(rest.price) } : {}),
          ...(rest.size !== undefined ? { size: finite(rest.size) } : {}),
          ...(rest.leverage !== undefined ? { leverage: finite(rest.leverage) } : {}),
          ...(rest.features !== undefined ? { features: json(rest.features) } : {}),
          ...(rest.featureSetVersion !== undefined ? { featureSetVersion: rest.featureSetVersion } : {}),
          ...(rest.matched !== undefined ? { matched: json(rest.matched) } : {}),
          ...(rest.journaledAt !== undefined ? { journaledAt: rest.journaledAt } : {}),
          ...declaredData(rest),
        },
      });
    },

    /** Recorded entries whose "🧭 Lý do vào lệnh" journal note is not written yet. */
    listUnjournaled(exchange: TradeEntryExchange, olderThan: Date, take = 20) {
      return client.tradeEntry.findMany({
        where: { exchange, status: 'recorded', journaledAt: null, tradeKey: { not: null }, createdAt: { lte: olderThan }, source: { not: 'BACKFILL' } },
        orderBy: { createdAt: 'asc' },
        take,
      });
    },

    /** Pending LIMIT intents older than the cutoff → expired (never filled / cancelled). */
    expirePending(olderThan: Date) {
      return client.tradeEntry.updateMany({
        where: { status: 'pending', createdAt: { lt: olderThan } },
        data: { status: 'expired' },
      });
    },

    /** tradeKeys (of one exchange) that already have an OPEN entry. */
    async openTradeKeys(exchange: TradeEntryExchange): Promise<Set<string>> {
      const rows = await client.tradeEntry.findMany({
        where: { exchange, event: 'OPEN', tradeKey: { not: null } },
        select: { tradeKey: true },
      });
      return new Set(rows.map((r) => r.tradeKey!));
    },

    /** Entries in a time window, newest first — for strategy reviews. */
    listSince(since: Date, opts: { event?: TradeEntryEvent; exchange?: TradeEntryExchange } = {}) {
      return client.tradeEntry.findMany({
        where: {
          enteredAt: { gte: since },
          status: 'recorded',
          ...(opts.event ? { event: opts.event } : {}),
          ...(opts.exchange ? { exchange: opts.exchange } : {}),
        },
        orderBy: { enteredAt: 'desc' },
      });
    },

    listStrategies() {
      return client.tradeStrategy.findMany({ orderBy: [{ key: 'asc' }, { version: 'desc' }] });
    },
  };
}
