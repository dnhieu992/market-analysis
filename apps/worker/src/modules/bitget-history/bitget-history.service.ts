import { createHmac } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import axios, { type AxiosInstance, type Method } from 'axios';
import { normalizeBitgetClosed, type BitgetClosedRaw } from '@app/core';
import { createBitgetClosedPositionRepository, createBitgetSyncStateRepository } from '@app/db';

/**
 * Syncs CLOSED Bitget USDT-futures positions into `bitget_closed_positions`.
 *
 * Bitget only serves ~90 days of position history, so we mirror it into our DB
 * to keep a permanent trade log + realized PnL for the /bitget-history page.
 * Read-only against the exchange (position/history-position) — signs with the
 * same account key the trading bot uses. Deliberately self-contained (its own
 * signing) so it runs regardless of LIVE trading being enabled.
 *
 * Driven by SchedulerService (periodic) + an initial catch-up sync on boot.
 */

const BASE_URL = 'https://api.bitget.com';
const HISTORY_PATH = '/api/v2/mix/position/history-position';
const ALL_POSITION_PATH = '/api/v2/mix/position/all-position';
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 100;
const MAX_PAGES = 40; // safety cap: 40 × 100 = 4000 trades per sync
// Re-scan a day back of the watermark so trades that settle slightly after close
// (funding/fees) are refreshed rather than missed.
const OVERLAP_MS = 24 * 60 * 60 * 1000;

type HistoryEnvelope = {
  code: string;
  msg: string;
  data: { list: BitgetClosedRaw[] | null; endId?: string } | null;
};

/** One open-position row (only the fields we read to anchor the history window). */
type OpenPositionRaw = { total?: string; cTime?: string };

type OpenPositionEnvelope = {
  code: string;
  msg: string;
  data: OpenPositionRaw[] | null;
};

@Injectable()
export class BitgetHistoryService implements OnModuleInit {
  private readonly logger = new Logger(BitgetHistoryService.name);
  private readonly repo = createBitgetClosedPositionRepository();
  private readonly stateRepo = createBitgetSyncStateRepository();
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 10_000 });

  private readonly apiKey = process.env.BITGET_API_KEY ?? '';
  private readonly apiSecret = process.env.BITGET_API_SECRET ?? '';
  private readonly passphrase = process.env.BITGET_API_PASSPHRASE ?? '';
  private readonly productType = process.env.BITGET_PRODUCT_TYPE ?? 'usdt-futures';
  private readonly marginCoin = process.env.BITGET_MARGIN_COIN ?? 'USDT';

  private syncing = false;

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.passphrase);
  }

  /** One catch-up sync a few seconds after boot so the page has data on deploy. */
  onModuleInit(): void {
    if (!this.isConfigured()) return;
    setTimeout(() => {
      this.sync().catch((err) =>
        this.logger.warn(`Initial Bitget history sync failed: ${(err as Error).message}`),
      );
    }, 10_000);
  }

  /**
   * Pull closed positions from `latestClosedAt − 1d` (or 90d ago on first run)
   * up to now, paging backwards by `idLessThan`, and upsert them. Returns how
   * many rows were written. Guarded against overlapping runs.
   */
  async sync(): Promise<{ synced: number; pages: number }> {
    if (!this.isConfigured()) {
      this.logger.debug('Bitget history sync skipped — credentials not configured');
      return { synced: 0, pages: 0 };
    }
    if (this.syncing) {
      this.logger.debug('Bitget history sync already in progress — skipping');
      return { synced: 0, pages: 0 };
    }
    this.syncing = true;
    try {
      const now = Date.now();

      // Anchor the trade log to when the current live positions were opened, so
      // the history tab records only from that point forward (not Bitget's full
      // 90-day backfill). Done once, then persisted; older rows are purged.
      const historyStart = await this.resolveHistoryStart(now);
      const floor = historyStart ? historyStart.getTime() : now - NINETY_DAYS_MS;

      const watermark = await this.repo.latestClosedAt();
      const startTime = Math.max(
        floor,
        watermark ? watermark.getTime() - OVERLAP_MS : floor,
      );

      const collected: BitgetClosedRaw[] = [];
      let cursor: string | undefined;
      let pages = 0;

      for (; pages < MAX_PAGES; pages++) {
        const query: Record<string, string> = {
          productType: this.productType,
          startTime: String(startTime),
          endTime: String(now),
          limit: String(PAGE_LIMIT),
        };
        if (cursor) query.idLessThan = cursor;

        const data = await this.request(query);
        const list = data?.list ?? [];
        collected.push(...list);

        if (!data?.endId || list.length < PAGE_LIMIT) break;
        cursor = data.endId;
      }

      const rows = collected
        .map(normalizeBitgetClosed)
        .filter((r): r is NonNullable<typeof r> => r !== null)
        // Never store trades that closed before the anchored history start.
        .filter((r) => r.closedAt.getTime() >= floor);
      const synced = await this.repo.upsertMany(rows);
      this.logger.log(`Bitget history sync — fetched ${collected.length}, upserted ${synced} (${pages + 1} page(s))`);
      return { synced, pages: pages + 1 };
    } finally {
      this.syncing = false;
    }
  }

  private request(query: Record<string, string>): Promise<HistoryEnvelope['data']> {
    return this.signedGet<HistoryEnvelope>(HISTORY_PATH, query).then((env) => env.data);
  }

  /**
   * Anchor the history-start floor once, to the open time of the earliest
   * currently-live position. On first run (no persisted anchor yet) with open
   * positions, persist it and purge any older backfilled rows. Returns the
   * effective start floor, or null when it cannot be determined (account flat).
   */
  private async resolveHistoryStart(now: number): Promise<Date | null> {
    const existing = await this.stateRepo.getHistoryStartAt();
    if (existing) return existing;

    const earliestOpen = await this.fetchEarliestOpenPositionTime().catch((err) => {
      this.logger.warn(`Could not read open positions to anchor history: ${(err as Error).message}`);
      return null;
    });
    if (earliestOpen == null) return null;

    const start = new Date(Math.min(earliestOpen, now));
    await this.stateRepo.setHistoryStartAt(start);
    const purged = await this.repo.deleteClosedBefore(start);
    this.logger.log(
      `Anchored Bitget history start to ${start.toISOString()} (earliest open position); purged ${purged} older row(s)`,
    );
    return start;
  }

  /** Earliest `cTime` across all currently-open positions (ms), or null if flat. */
  private async fetchEarliestOpenPositionTime(): Promise<number | null> {
    const env = await this.signedGet<OpenPositionEnvelope>(ALL_POSITION_PATH, {
      productType: this.productType,
      marginCoin: this.marginCoin,
    });
    const open = (env.data ?? []).filter((p) => Number(p.total) > 0);
    const times = open
      .map((p) => Number(p.cTime))
      .filter((t) => Number.isFinite(t) && t > 0);
    return times.length > 0 ? Math.min(...times) : null;
  }

  private async signedGet<E extends { code: string; msg: string }>(
    path: string,
    query: Record<string, string>,
  ): Promise<E> {
    const timestamp = Date.now().toString();
    const queryString = new URLSearchParams(
      Object.keys(query)
        .sort()
        .map((k) => [k, query[k]] as [string, string]),
    ).toString();
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const prehash = `${timestamp}GET${requestPath}`;
    const sign = createHmac('sha256', this.apiSecret).update(prehash).digest('base64');

    const res = await this.client.request<E>({
      method: 'GET' as Method,
      url: requestPath,
      headers: {
        'ACCESS-KEY': this.apiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': this.passphrase,
        'Content-Type': 'application/json',
        locale: 'en-US',
      },
    });

    if (res.data.code !== '00000') {
      throw new Error(`Bitget ${path} error ${res.data.code}: ${res.data.msg}`);
    }
    return res.data;
  }
}
