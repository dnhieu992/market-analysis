import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  ENTRY_FEATURE_SET_VERSION,
  candlesFromKlines,
  fetchEntryFeatures,
  formatEntryReasonNote,
  matchEntryStrategies,
  type EntryCandle,
  type EntryFeatures,
  type EntryKlineFetcher,
} from '@app/core';
import {
  prisma,
  createTradeEntryRepository,
  createBitgetTradeJournalRepository,
  createMexcTradeJournalRepository,
  type TradeEntryExchange,
} from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

/** A LIMIT intent can wait this long on the exchange before it is considered dead. */
const PENDING_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Give the API time to merge the trader's declared intent before the note is written. */
const NOTE_DELAY_MS = 90_000;
/** Entries enriched (klines fetched) + journaled per sync pass. */
const NOTES_PER_PASS = 4;
const BACKFILL_DELAY_MS = 60_000;
const BACKFILL_PAUSE_MS = 300;

type OpenedTrade = {
  exchange: TradeEntryExchange;
  tradeKey: string;
  symbol: string;
  holdSide: string;
  openedAt: Date;
  price: number;
  size: number;
  leverage: number | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Keeps `trade_entries` complete for Bitget + MEXC:
 *  - `onTradeOpened` — called by the history sync for every newly-seen position:
 *    attaches it to the trader's pending LIMIT intent, or to the OPEN intent the
 *    API already recorded, or records it as an undeclared EXCHANGE_APP entry.
 *  - `flush` — after each sync: computes the market features + matched
 *    strategies for fresh entries and writes the "🧭 Lý do vào lệnh" note to the
 *    trade journal (delayed ~90s so the API's declared intent is merged first).
 *  - a one-off backfill on boot for trades that have no OPEN entry yet, then a
 *    re-enrich of entries whose features predate ENTRY_FEATURE_SET_VERSION (so a
 *    newly added strategy is matched on old trades too; no new journal note).
 */
@Injectable()
export class TradeEntryRecorderService implements OnModuleInit {
  private readonly logger = new Logger(TradeEntryRecorderService.name);
  private readonly repo = createTradeEntryRepository();
  private readonly journals = {
    bitget: createBitgetTradeJournalRepository(),
    mexc: createMexcTradeJournalRepository(),
  };
  private flushing = new Set<TradeEntryExchange>();
  private backfilling = false;

  constructor(private readonly binance: BinanceMarketDataService) {}

  private readonly fetcher: EntryKlineFetcher = async ({ symbol, interval, limit, endTime }) =>
    (await this.binance.fetchKlines({ symbol, timeframe: interval as never, limit, endTime })) as unknown as ReadonlyArray<
      ReadonlyArray<string | number>
    >;

  onModuleInit(): void {
    if (process.env.TRADE_ENTRY_BACKFILL === 'off') return;
    setTimeout(() => {
      this.backfill().catch((err) => this.logger.warn(`Trade-entry backfill failed: ${(err as Error).message}`));
    }, BACKFILL_DELAY_MS).unref();
  }

  async onTradeOpened(t: OpenedTrade): Promise<void> {
    try {
      const existing = await this.repo.findOpenEntry(t.exchange, t.tradeKey);
      if (existing) {
        if (existing.price == null || existing.size == null) {
          await this.repo.update(existing.id, {
            price: existing.price ?? t.price,
            size: existing.size ?? t.size,
            leverage: existing.leverage ?? t.leverage,
            enteredAt: t.openedAt,
          });
        }
        return;
      }
      const pending = await this.repo.claimPending(t.exchange, t.symbol, t.holdSide, t.openedAt, PENDING_MAX_AGE_MS);
      if (pending) {
        await this.repo.update(pending.id, {
          tradeKey: t.tradeKey,
          status: 'recorded',
          enteredAt: t.openedAt,
          price: t.price,
          size: t.size,
          leverage: t.leverage ?? pending.leverage,
        });
        return;
      }
      await this.repo.upsertOpen({
        exchange: t.exchange,
        tradeKey: t.tradeKey,
        symbol: t.symbol,
        holdSide: t.holdSide,
        event: 'OPEN',
        source: 'EXCHANGE_APP',
        enteredAt: t.openedAt,
        price: t.price,
        size: t.size,
        leverage: t.leverage,
      });
    } catch (err) {
      this.logger.warn(`Failed to record entry for ${t.tradeKey}: ${(err as Error).message}`);
    }
  }

  /** Enrich + journal fresh entries of one exchange. Cheap when there is nothing to do. */
  async flush(exchange: TradeEntryExchange): Promise<void> {
    if (this.flushing.has(exchange)) return;
    this.flushing.add(exchange);
    try {
      const due = await this.repo.listUnjournaled(exchange, new Date(Date.now() - NOTE_DELAY_MS), NOTES_PER_PASS);
      for (const e of due) {
        let features = (e.features as EntryFeatures | null) ?? null;
        let matched = (e.matched as ReturnType<typeof matchEntryStrategies> | null) ?? null;
        if (!features) {
          features = await fetchEntryFeatures(this.fetcher, e.symbol, e.enteredAt, e.price).catch((err) => {
            this.logger.debug(`Features failed for ${e.symbol}: ${(err as Error).message}`);
            return null;
          });
          matched = matchEntryStrategies(features, {
            symbol: e.symbol,
            side: e.holdSide === 'short' ? 'short' : 'long',
            opposite: await this.oppositeAt(exchange, e.symbol, e.holdSide, e.enteredAt),
            size: e.size,
          });
        }
        // A plain DCA (no strategy, no reason) is already logged as "➕ Thêm volume" — only store its features.
        const silent = e.event === 'DCA' && !e.strategyKey && !e.reason;
        const content = formatEntryReasonNote({
          event: e.event === 'DCA' ? 'DCA' : 'OPEN',
          source: e.source,
          strategyKey: e.strategyKey,
          strategyVersion: e.strategyVersion,
          grade: e.grade,
          mode: e.mode,
          reason: e.reason,
          tags: e.tags,
          features,
          matched,
          plan: e.plan as { takeProfitPrice?: number | null } | null,
        });
        if (!silent) await this.journals[exchange]
          .create({
            tradeKey: e.tradeKey!,
            kind: 'system',
            symbol: e.symbol,
            holdSide: e.holdSide,
            content,
            snapshot: { ...(e.price != null ? { entryPrice: e.price } : {}), ...(features ? { markPrice: features.price } : {}) },
          })
          .catch((err) => this.logger.warn(`Failed to write entry note for ${e.tradeKey}: ${(err as Error).message}`));
        await this.repo.update(e.id, {
          features: features ?? null,
          featureSetVersion: features?.featureSetVersion ?? null,
          matched: matched ?? [],
          journaledAt: new Date(),
        });
      }
      await this.repo.expirePending(new Date(Date.now() - PENDING_MAX_AGE_MS));
    } catch (err) {
      this.logger.warn(`Trade-entry flush (${exchange}) failed: ${(err as Error).message}`);
    } finally {
      this.flushing.delete(exchange);
    }
  }

  /** Recompute features + matched strategies for entries stored with an older feature set. */
  private async reenrich(btcAll: EntryCandle[]): Promise<void> {
    let done = 0;
    let failed = 0;
    for (;;) {
      const stale = await this.repo.listStaleFeatures(ENTRY_FEATURE_SET_VERSION, 50);
      if (!stale.length) break;
      for (const e of stale) {
        const at = e.enteredAt;
        const exchange = e.exchange as TradeEntryExchange;
        const btcD1 = btcAll.filter((c) => c.closeTime <= at.getTime());
        const features = await fetchEntryFeatures(this.fetcher, e.symbol, at, e.price, btcD1).catch(() => null);
        if (!features) {
          // Keep the old snapshot but stop retrying it on every boot.
          await this.repo.update(e.id, { featureSetVersion: ENTRY_FEATURE_SET_VERSION });
          failed++;
          continue;
        }
        await this.repo.update(e.id, {
          features,
          featureSetVersion: features.featureSetVersion,
          matched: matchEntryStrategies(features, {
            symbol: e.symbol,
            side: e.holdSide === 'short' ? 'short' : 'long',
            opposite: await this.oppositeAt(exchange, e.symbol, e.holdSide, at),
            size: e.size,
          }),
        });
        done++;
        await sleep(BACKFILL_PAUSE_MS);
      }
    }
    if (done || failed) this.logger.log(`Trade-entry re-enrich (feature set v${ENTRY_FEATURE_SET_VERSION}) — ${done} updated, ${failed} without candles`);
  }

  /** The opposite-side trade of the same coin that was open at `at` (for the hedge rule). */
  private async oppositeAt(exchange: TradeEntryExchange, symbol: string, holdSide: string, at: Date) {
    const where = {
      symbol,
      holdSide: holdSide === 'short' ? 'long' : 'short',
      openedAt: { lte: at },
      OR: [{ closedAt: null }, { closedAt: { gt: at } }],
    };
    const row =
      exchange === 'bitget'
        ? await prisma.bitgetTrade.findFirst({ where, orderBy: { openedAt: 'desc' } })
        : await prisma.mexcTrade.findFirst({ where, orderBy: { openedAt: 'desc' } });
    return row ? { size: Number(row.openTotalPos) } : null;
  }

  /**
   * One OPEN entry (source BACKFILL) for every recorded trade that has none, with
   * features computed as of its open time. A trade that an executed AI card
   * opened gets that card's reason. No journal note (old trades). Idempotent.
   */
  async backfill(): Promise<void> {
    if (this.backfilling) return;
    this.backfilling = true;
    try {
      const btcRows = await this.fetcher({ symbol: 'BTCUSDT', interval: '1d', limit: 1000 });
      const btcAll = candlesFromKlines(btcRows, Date.now());
      let done = 0;
      for (const exchange of ['bitget', 'mexc'] as const) {
        const have = await this.repo.openTradeKeys(exchange);
        const trades =
          exchange === 'bitget'
            ? await prisma.bitgetTrade.findMany({ orderBy: { openedAt: 'asc' } })
            : await prisma.mexcTrade.findMany({ orderBy: { openedAt: 'asc' } });
        const missing = trades.filter((t) => !have.has(t.tradeKey));
        if (!missing.length) continue;
        const cards =
          exchange === 'bitget'
            ? await prisma.bitgetAiAction.findMany({ where: { status: 'EXECUTED', type: 'OPEN' } })
            : await prisma.mexcAiAction.findMany({ where: { status: 'EXECUTED', type: 'OPEN' } });
        this.logger.log(`Trade-entry backfill: ${missing.length} ${exchange} trade(s) without an entry`);
        for (const t of missing) {
          const at = t.openedAt;
          const btcD1: EntryCandle[] = btcAll.filter((c) => c.closeTime <= at.getTime());
          const features = await fetchEntryFeatures(this.fetcher, t.symbol, at, Number(t.openAvgPrice), btcD1).catch(() => null);
          const card = cards.find(
            (c) =>
              c.symbol === t.symbol &&
              c.holdSide === t.holdSide &&
              c.decidedAt != null &&
              Math.abs(c.decidedAt.getTime() - at.getTime()) <= 10 * 60_000,
          );
          await this.repo.create({
            exchange,
            tradeKey: t.tradeKey,
            symbol: t.symbol,
            holdSide: t.holdSide,
            event: 'OPEN',
            source: 'BACKFILL',
            enteredAt: at,
            price: Number(t.openAvgPrice),
            size: Number(t.openTotalPos),
            leverage: t.leverage != null ? Number(t.leverage) : null,
            reason: card?.reason ?? null,
            tags: card ? ['ai-card'] : null,
            features,
            featureSetVersion: features?.featureSetVersion ?? null,
            matched: matchEntryStrategies(features, {
              symbol: t.symbol,
              side: t.holdSide === 'short' ? 'short' : 'long',
              opposite: await this.oppositeAt(exchange, t.symbol, t.holdSide, at),
              size: Number(t.openTotalPos),
            }),
            journaledAt: new Date(),
          });
          done++;
          await sleep(BACKFILL_PAUSE_MS);
        }
      }
      if (done) this.logger.log(`Trade-entry backfill done — ${done} entr${done === 1 ? 'y' : 'ies'}`);
      await this.reenrich(btcAll);
    } finally {
      this.backfilling = false;
    }
  }
}
