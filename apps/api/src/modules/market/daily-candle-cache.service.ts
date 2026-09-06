import { Injectable, Logger } from '@nestjs/common';
import type { Candle } from '@app/core';

import { MarketDataService } from './market-data.service';

/**
 * One shared, in-memory cache of daily candles per coin.
 *
 * `/tracking-coins/price-changes` and `/tracking-coins/scores` both need the
 * same 1d klines for the same ~37 symbols. Before this service each endpoint
 * fetched its own copy, one symbol at a time — 74 sequential Binance round
 * trips per cold page load, which measured 5-13s per endpoint. Here every
 * symbol is fetched once, concurrently, and reused by both.
 *
 * Freshness model:
 * - younger than FRESH_TTL_MS       → served straight from memory
 * - older, but younger than MAX_STALE_MS → the stale copy is served *immediately*
 *   and a refresh runs in the background (stale-while-revalidate), so only the
 *   very first load after a restart ever waits on Binance
 * - older than MAX_STALE_MS (or missing) → the caller waits for a fresh fetch
 */

/** Enough history for the 180-day change column and a 200-bar Supertrend warm-up. */
const CANDLE_LIMIT = 200;

/** Only the in-progress daily candle moves inside this window. */
const FRESH_TTL_MS = 5 * 60_000;

/** Past this age a reading is too old to hand out, even for one request. */
const MAX_STALE_MS = 6 * 60 * 60_000;

/** Binance tolerates this fan-out comfortably; klines cost weight 2 each. */
const FETCH_CONCURRENCY = 8;

type CacheEntry = { at: number; candles: Candle[] };

@Injectable()
export class DailyCandleCacheService {
  private readonly logger = new Logger(DailyCandleCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();
  /** Dedupes concurrent fetches of the same symbol (two endpoints, one request). */
  private readonly inFlight = new Map<string, Promise<Candle[] | null>>();

  constructor(private readonly marketData: MarketDataService) {}

  /**
   * Daily candles for each bare symbol ("ADA"), oldest first, including the
   * in-progress candle. A symbol maps to `null` when it has never been fetched
   * successfully — callers decide whether that is a blank cell or an error.
   */
  async getMany(bareSymbols: string[]): Promise<Map<string, Candle[] | null>> {
    const unique = [...new Set(bareSymbols)];
    const out = new Map<string, Candle[] | null>();
    const mustFetch: string[] = [];

    for (const bare of unique) {
      const entry = this.cache.get(bare);
      if (!entry || Date.now() - entry.at >= MAX_STALE_MS) {
        mustFetch.push(bare);
        continue;
      }
      out.set(bare, entry.candles);
      // Stale but usable: answer now, refresh for the next caller.
      if (Date.now() - entry.at >= FRESH_TTL_MS) void this.refresh(bare);
    }

    const fetched = await this.runPooled(mustFetch, (bare) => this.refresh(bare));
    for (const [bare, candles] of fetched) out.set(bare, candles);

    return out;
  }

  /** Single-symbol convenience wrapper around {@link getMany}. */
  async get(bareSymbol: string): Promise<Candle[] | null> {
    return (await this.getMany([bareSymbol])).get(bareSymbol) ?? null;
  }

  /**
   * Fetch one symbol and store it. Concurrent callers for the same symbol share
   * a single request. A failed fetch keeps whatever is already cached, so a
   * transient Binance error never blanks a column.
   */
  private refresh(bare: string): Promise<Candle[] | null> {
    const pending = this.inFlight.get(bare);
    if (pending) return pending;

    const task = (async (): Promise<Candle[] | null> => {
      try {
        const candles = await this.marketData.getCandles(`${bare}USDT`, '1d', CANDLE_LIMIT);
        this.cache.set(bare, { at: Date.now(), candles });
        return candles;
      } catch (error) {
        this.logger.warn(
          `Daily candle fetch failed for ${bare}: ${error instanceof Error ? error.message : String(error)}`
        );
        return this.cache.get(bare)?.candles ?? null;
      } finally {
        this.inFlight.delete(bare);
      }
    })();

    this.inFlight.set(bare, task);
    return task;
  }

  /** Run `task` over every key with at most FETCH_CONCURRENCY in flight. */
  private async runPooled(
    keys: string[],
    task: (key: string) => Promise<Candle[] | null>
  ): Promise<Map<string, Candle[] | null>> {
    const out = new Map<string, Candle[] | null>();
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < keys.length) {
        const key = keys[next++]!;
        out.set(key, await task(key));
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, keys.length) }, () => worker())
    );

    return out;
  }
}
