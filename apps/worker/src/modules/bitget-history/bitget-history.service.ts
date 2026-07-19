import { createHmac } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import axios, { type AxiosInstance, type Method } from 'axios';
import { normalizeBitgetClosed, type BitgetClosedRaw, type BitgetClosedNormalized } from '@app/core';
import {
  createBitgetTradeRepository,
  createBitgetTradeJournalRepository,
  createBitgetSyncStateRepository,
} from '@app/db';

/**
 * Reconciles Bitget USDT-futures trades into the `bitget_trades` lifecycle table.
 *
 * On each run it:
 *   1. Reads live open positions (`all-position`) → inserts any newly-seen one as
 *      `status = open` and writes a system "opened" log item.
 *   2. Reads closed position history (`history-position`) → flips the matching
 *      open row to `status = closed` (filling realized-PnL) and writes a system
 *      "closed" log item. A trade opened+closed between polls is inserted closed
 *      directly, with both an "opened" and "closed" log.
 *
 * Bitget only serves ~90 days of history, so mirroring it keeps a permanent trade
 * log + realized PnL for the /bitget history tab. Read-only against the exchange
 * and self-contained (its own signing) so it runs regardless of LIVE trading.
 * Driven by SchedulerService (every 15m) + a catch-up sync on boot.
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

/** Open-position row (the fields we read to track the live trade). */
type OpenPositionRaw = {
  symbol?: string;
  holdSide?: 'long' | 'short';
  marginMode?: string;
  total?: string;
  openPriceAvg?: string;
  markPrice?: string;
  unrealizedPL?: string;
  cTime?: string;
};

type OpenPositionEnvelope = { code: string; msg: string; data: OpenPositionRaw[] | null };

/** Canonical trade-session key — MUST match the web/API (`symbol-holdSide-openedAt(ISO)`). */
function tradeKeyOf(symbol: string, holdSide: string, openedAtMs: number): string {
  return `${symbol}-${holdSide}-${new Date(openedAtMs).toISOString()}`;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1) return n.toFixed(3);
  return n.toPrecision(4);
}

@Injectable()
export class BitgetHistoryService implements OnModuleInit {
  private readonly logger = new Logger(BitgetHistoryService.name);
  private readonly repo = createBitgetTradeRepository();
  private readonly journalRepo = createBitgetTradeJournalRepository();
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
        this.logger.warn(`Initial Bitget trade sync failed: ${(err as Error).message}`),
      );
    }, 10_000);
  }

  /**
   * Reconcile open positions + closed history into `bitget_trades`. Returns how
   * many trades were opened / closed this run. Guarded against overlapping runs.
   */
  async sync(): Promise<{ opened: number; closed: number; pages: number }> {
    if (!this.isConfigured()) {
      this.logger.debug('Bitget trade sync skipped — credentials not configured');
      return { opened: 0, closed: 0, pages: 0 };
    }
    if (this.syncing) {
      this.logger.debug('Bitget trade sync already in progress — skipping');
      return { opened: 0, closed: 0, pages: 0 };
    }
    this.syncing = true;
    try {
      const now = Date.now();
      const openPositions = await this.fetchOpenPositions();
      const liveKeys = new Set<string>();

      // 1. Record newly-seen open positions + their "opened" log.
      let opened = 0;
      for (const pos of openPositions) {
        const openedAtMs = Number(pos.cTime);
        if (!pos.symbol || !pos.holdSide || !Number.isFinite(openedAtMs) || openedAtMs <= 0) continue;
        const tradeKey = tradeKeyOf(pos.symbol, pos.holdSide, openedAtMs);
        liveKeys.add(tradeKey);

        const existing = await this.repo.findByTradeKey(tradeKey);
        if (existing) continue;

        const openAvgPrice = Number(pos.openPriceAvg);
        const openTotalPos = Number(pos.total);
        const openedAt = new Date(openedAtMs);
        await this.repo.createOpen({
          tradeKey,
          symbol: pos.symbol,
          holdSide: pos.holdSide,
          marginMode: pos.marginMode ?? '',
          openAvgPrice,
          openTotalPos,
          openedAt,
        });
        await this.writeOpenedLog(tradeKey, pos.symbol, pos.holdSide, {
          openAvgPrice,
          openTotalPos,
          openedAt,
          markPrice: Number(pos.markPrice),
        });
        opened++;
      }

      // 2. Pull closed history and reconcile closes.
      const historyStart = await this.resolveHistoryStart(now, openPositions);
      const floor = historyStart ? historyStart.getTime() : now - NINETY_DAYS_MS;
      const { rows: closedRows, pages } = await this.fetchClosedHistory(now, floor);

      let closed = 0;
      for (const c of closedRows) {
        // Idempotent: a trade already closed (positionId recorded) is skipped.
        const byPid = await this.repo.findByPositionId(c.positionId);
        if (byPid) continue;

        const tradeKey = tradeKeyOf(c.symbol, c.holdSide, c.openedAt.getTime());
        let match = await this.repo.findByTradeKey(tradeKey);

        // Fallback for a cTime mismatch: an open row for the same symbol+side that
        // is NOT currently live (so we never close a still-open position).
        if (!match) {
          const opens = await this.repo.findOpenBySymbolSide(c.symbol, c.holdSide);
          match =
            opens.find((o) => !liveKeys.has(o.tradeKey) && o.openedAt.getTime() <= c.closedAt.getTime()) ??
            null;
        }

        if (match && match.status === 'open' && !liveKeys.has(match.tradeKey)) {
          await this.repo.markClosed(match.id, this.closeInput(c));
          await this.writeClosedLog(match.tradeKey, c);
          closed++;
        } else if (!match) {
          // Opened and closed between polls — never saw it open. Record the full
          // lifecycle plus both an "opened" and "closed" log.
          await this.repo.createClosed({
            tradeKey,
            symbol: c.symbol,
            holdSide: c.holdSide,
            marginMode: c.marginMode,
            openAvgPrice: c.openAvgPrice,
            openTotalPos: c.openTotalPos,
            openedAt: c.openedAt,
            ...this.closeInput(c),
          });
          await this.writeOpenedLog(tradeKey, c.symbol, c.holdSide, {
            openAvgPrice: c.openAvgPrice,
            openTotalPos: c.openTotalPos,
            openedAt: c.openedAt,
            markPrice: c.openAvgPrice,
          });
          await this.writeClosedLog(tradeKey, c);
          closed++;
        }
      }

      if (opened || closed) {
        this.logger.log(`Bitget trade sync — opened ${opened}, closed ${closed} (${pages} page(s))`);
      }
      return { opened, closed, pages };
    } finally {
      this.syncing = false;
    }
  }

  private closeInput(c: BitgetClosedNormalized) {
    return {
      positionId: c.positionId,
      closeAvgPrice: c.closeAvgPrice,
      netProfit: c.netProfit,
      pnl: c.pnl,
      totalFunding: c.totalFunding,
      openFee: c.openFee,
      closeFee: c.closeFee,
      closedAt: c.closedAt,
    };
  }

  private async writeOpenedLog(
    tradeKey: string,
    symbol: string,
    holdSide: string,
    info: { openAvgPrice: number; openTotalPos: number; openedAt: Date; markPrice: number },
  ): Promise<void> {
    const side = holdSide === 'short' ? 'SHORT' : 'LONG';
    const content = [
      `🟢 **Đã mở lệnh** ${side} ${symbol}`,
      `- Giá vào: ${fmtNum(info.openAvgPrice)}`,
      `- Size: ${fmtNum(info.openTotalPos)}`,
    ].join('\n');
    await this.journalRepo
      .create({
        tradeKey,
        kind: 'system',
        symbol,
        holdSide,
        content,
        snapshot: {
          entryPrice: info.openAvgPrice,
          markPrice: Number.isFinite(info.markPrice) ? info.markPrice : info.openAvgPrice,
        },
      })
      .catch((err) => this.logger.warn(`Failed to write opened log for ${tradeKey}: ${(err as Error).message}`));
  }

  private async writeClosedLog(tradeKey: string, c: BitgetClosedNormalized): Promise<void> {
    const side = c.holdSide === 'short' ? 'SHORT' : 'LONG';
    const sign = c.netProfit >= 0 ? '+' : '−';
    const content = [
      `🔴 **Đã đóng lệnh** ${side} ${c.symbol}`,
      `- Giá đóng: ${fmtNum(c.closeAvgPrice)}`,
      `- PnL thực: ${sign}${fmtNum(Math.abs(c.netProfit))} USDT`,
      `- Phí: ${fmtNum(c.openFee + c.closeFee)} USDT`,
    ].join('\n');
    await this.journalRepo
      .create({
        tradeKey,
        kind: 'system',
        symbol: c.symbol,
        holdSide: c.holdSide,
        content,
        snapshot: {
          entryPrice: c.openAvgPrice,
          markPrice: c.closeAvgPrice,
          unrealizedPnlUsd: c.netProfit,
        },
      })
      .catch((err) => this.logger.warn(`Failed to write closed log for ${tradeKey}: ${(err as Error).message}`));
  }

  /** Page backwards through closed history from the floor and normalize the rows. */
  private async fetchClosedHistory(
    now: number,
    floor: number,
  ): Promise<{ rows: BitgetClosedNormalized[]; pages: number }> {
    const watermark = await this.repo.latestClosedAt();
    const startTime = Math.max(floor, watermark ? watermark.getTime() - OVERLAP_MS : floor);

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

      const env = await this.signedGet<HistoryEnvelope>(HISTORY_PATH, query);
      const list = env.data?.list ?? [];
      collected.push(...list);
      if (!env.data?.endId || list.length < PAGE_LIMIT) break;
      cursor = env.data.endId;
    }

    const rows = collected
      .map(normalizeBitgetClosed)
      .filter((r): r is BitgetClosedNormalized => r !== null)
      .filter((r) => r.closedAt.getTime() >= floor);
    return { rows, pages: pages + 1 };
  }

  private async fetchOpenPositions(): Promise<OpenPositionRaw[]> {
    const env = await this.signedGet<OpenPositionEnvelope>(ALL_POSITION_PATH, {
      productType: this.productType,
      marginCoin: this.marginCoin,
    });
    return (env.data ?? []).filter((p) => Number(p.total) > 0);
  }

  /**
   * Anchor the history-start floor once, to the open time of the earliest
   * currently-live position. On first run (no persisted anchor yet) with open
   * positions, persist it and purge older closed rows. Returns the effective
   * start floor, or null when it cannot be determined (account flat).
   */
  private async resolveHistoryStart(now: number, openPositions: OpenPositionRaw[]): Promise<Date | null> {
    const existing = await this.stateRepo.getHistoryStartAt();
    if (existing) return existing;

    const times = openPositions
      .map((p) => Number(p.cTime))
      .filter((t) => Number.isFinite(t) && t > 0);
    if (times.length === 0) return null;

    const start = new Date(Math.min(Math.min(...times), now));
    await this.stateRepo.setHistoryStartAt(start);
    const purged = await this.repo.deleteClosedBefore(start);
    this.logger.log(
      `Anchored Bitget history start to ${start.toISOString()} (earliest open position); purged ${purged} older row(s)`,
    );
    return start;
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
