import { createHmac } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import axios, { type AxiosInstance, type Method } from 'axios';
import { normalizeBitgetClosed, type BitgetClosedRaw } from '@app/core';
import { createBitgetClosedPositionRepository } from '@app/db';

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

@Injectable()
export class BitgetHistoryService implements OnModuleInit {
  private readonly logger = new Logger(BitgetHistoryService.name);
  private readonly repo = createBitgetClosedPositionRepository();
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 10_000 });

  private readonly apiKey = process.env.BITGET_API_KEY ?? '';
  private readonly apiSecret = process.env.BITGET_API_SECRET ?? '';
  private readonly passphrase = process.env.BITGET_API_PASSPHRASE ?? '';
  private readonly productType = process.env.BITGET_PRODUCT_TYPE ?? 'usdt-futures';

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
      const watermark = await this.repo.latestClosedAt();
      const startTime = Math.max(
        now - NINETY_DAYS_MS,
        watermark ? watermark.getTime() - OVERLAP_MS : now - NINETY_DAYS_MS,
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
        .filter((r): r is NonNullable<typeof r> => r !== null);
      const synced = await this.repo.upsertMany(rows);
      this.logger.log(`Bitget history sync — fetched ${collected.length}, upserted ${synced} (${pages + 1} page(s))`);
      return { synced, pages: pages + 1 };
    } finally {
      this.syncing = false;
    }
  }

  private async request(query: Record<string, string>): Promise<HistoryEnvelope['data']> {
    const timestamp = Date.now().toString();
    const queryString = new URLSearchParams(
      Object.keys(query)
        .sort()
        .map((k) => [k, query[k]] as [string, string]),
    ).toString();
    const requestPath = `${HISTORY_PATH}?${queryString}`;
    const prehash = `${timestamp}GET${requestPath}`;
    const sign = createHmac('sha256', this.apiSecret).update(prehash).digest('base64');

    const res = await this.client.request<HistoryEnvelope>({
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
      throw new Error(`Bitget ${HISTORY_PATH} error ${res.data.code}: ${res.data.msg}`);
    }
    return res.data.data;
  }
}
