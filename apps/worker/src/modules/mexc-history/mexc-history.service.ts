import { createHmac } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import axios, { type AxiosInstance, type Method } from 'axios';
import { normalizeMexcClosed, type MexcClosedRaw, type MexcClosedNormalized } from '@app/core';
import {
  createMexcTradeRepository,
  createMexcTradeJournalRepository,
  createMexcSyncStateRepository,
} from '@app/db';

/**
 * Reconciles MEXC USDT-futures trades into the `mexc_trades` lifecycle table —
 * the MEXC twin of `BitgetHistoryService`, kept as its own service (with its own
 * signing) so neither exchange's sync can break the other.
 *
 * On each run it:
 *   1. Reads live open positions (`position/open_positions`) → inserts any
 *      newly-seen one as `status = open` and writes a system "opened" log item.
 *   2. Reads closed position history (`position/list/history_positions`) → flips
 *      the matching open row to `status = closed` (filling realized-PnL) and
 *      writes a system "closed" log item. A trade opened+closed between polls is
 *      inserted closed directly, with both an "opened" and "closed" log.
 *
 * MEXC-specific details that shape the code:
 *   - Volumes are in CONTRACTS; `contractSize` (from the public contract detail
 *     endpoint, cached) converts them to the base asset the dashboard shows.
 *   - Symbols are `BTC_USDT` on the wire and `BTCUSDT` everywhere in the app.
 *   - History is paged by `page_num`/`page_size`, not by a cursor id.
 *
 * Read-only against the exchange, driven by SchedulerService (every 15s) + a
 * catch-up sync on boot.
 */

const BASE_URL = process.env.MEXC_API_BASE_URL ?? 'https://api.mexc.com';
const HISTORY_PATH = '/api/v1/private/position/list/history_positions';
const OPEN_POSITION_PATH = '/api/v1/private/position/open_positions';
const CONTRACT_DETAIL_PATH = '/api/v1/contract/detail';
const TICKER_PATH = '/api/v1/contract/ticker';
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 100;
const MAX_PAGES = 40; // safety cap: 40 × 100 = 4000 trades per sync
// Re-scan a day back of the watermark so trades that settle slightly after close
// (funding/fees) are refreshed rather than missed.
const OVERLAP_MS = 24 * 60 * 60 * 1000;
/** MEXC `state` code for a fully-closed position. */
const STATE_CLOSED = 3;

type HistoryEnvelope = {
  success?: boolean;
  code?: number;
  message?: string;
  data: MexcClosedRaw[] | { resultList?: MexcClosedRaw[] | null } | null;
};

/** Open-position row (the fields we read to track the live trade). */
type OpenPositionRaw = {
  positionId?: number;
  symbol?: string;
  positionType?: number;
  openType?: number;
  holdVol?: number;
  openAvgPrice?: number;
  holdAvgPrice?: number;
  im?: number;
  oim?: number;
  leverage?: number;
  unRealizedPnl?: number;
  unrealizedPnl?: number;
  createTime?: number;
};

// ROE% milestones we record on a trade's journal, as a ratchet in each direction.
// ROE = unrealizedPnl ÷ margin × 100 — the same number the /mexc table shows.
// Only recorded once per step and never re-logged when ROE dips and recovers.
const UP_MILESTONES = [50, 70, 100, 150, 200];
const DOWN_MILESTONES = [-50, -80, -100, -200, -300, -400, -500];

type OpenPositionEnvelope = {
  success?: boolean;
  code?: number;
  message?: string;
  data: OpenPositionRaw[] | null;
};

/** App symbol (`BTCUSDT`) → MEXC contract symbol (`BTC_USDT`). */
function toMexcSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes('_')) return s;
  return s.endsWith('USDT') ? `${s.slice(0, -4)}_USDT` : s;
}

/** MEXC contract symbol (`BTC_USDT`) → app symbol (`BTCUSDT`). */
function fromMexcSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace('_', '');
}

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

/** Signed percentage with a leading +/− (uses the same − glyph as the rest of the log). */
function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
}

/** Leverage as e.g. "20x" (drops a trailing ".0"). */
function fmtLev(lev: number): string {
  const rounded = Math.round(lev * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}x`;
}

@Injectable()
export class MexcHistoryService implements OnModuleInit {
  private readonly logger = new Logger(MexcHistoryService.name);
  private readonly repo = createMexcTradeRepository();
  private readonly journalRepo = createMexcTradeJournalRepository();
  private readonly stateRepo = createMexcSyncStateRepository();
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 10_000 });

  private readonly apiKey = process.env.MEXC_API_KEY ?? '';
  private readonly apiSecret = process.env.MEXC_API_SECRET ?? '';
  /** Contract sizes barely change — cache them for the process lifetime. */
  private readonly contractSizes = new Map<string, number>();

  private syncing = false;

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  /** One catch-up sync a few seconds after boot so the page has data on deploy. */
  onModuleInit(): void {
    if (!this.isConfigured()) return;
    setTimeout(() => {
      this.sync().catch((err) =>
        this.logger.warn(`Initial MEXC trade sync failed: ${(err as Error).message}`),
      );
    }, 10_000);
  }

  /**
   * Reconcile open positions + closed history into `mexc_trades`. Returns how
   * many trades were opened / closed this run. Guarded against overlapping runs.
   */
  async sync(): Promise<{ opened: number; closed: number; pages: number }> {
    if (!this.isConfigured()) {
      this.logger.debug('MEXC trade sync skipped — credentials not configured');
      return { opened: 0, closed: 0, pages: 0 };
    }
    if (this.syncing) {
      this.logger.debug('MEXC trade sync already in progress — skipping');
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
        const openedAtMs = Number(pos.createTime);
        const symbol = pos.symbol ? fromMexcSymbol(pos.symbol) : '';
        if (!symbol || !Number.isFinite(openedAtMs) || openedAtMs <= 0) continue;
        const holdSide = pos.positionType === 2 ? 'short' : 'long';
        const tradeKey = tradeKeyOf(symbol, holdSide, openedAtMs);
        liveKeys.add(tradeKey);

        const existing = await this.repo.findByTradeKey(tradeKey);
        if (existing) continue;

        const contractSize = await this.contractSizeOf(symbol);
        const openAvgPrice = Number(pos.holdAvgPrice ?? pos.openAvgPrice);
        const openTotalPos = Number(pos.holdVol) * contractSize;
        const leverage = Number(pos.leverage);
        const openedAt = new Date(openedAtMs);
        await this.repo.createOpen({
          tradeKey,
          symbol,
          holdSide,
          marginMode: pos.openType === 1 ? 'isolated' : 'crossed',
          openAvgPrice,
          openTotalPos,
          leverage: Number.isFinite(leverage) && leverage > 0 ? leverage : null,
          openedAt,
        });
        await this.writeOpenedLog(tradeKey, symbol, holdSide, {
          openAvgPrice,
          openTotalPos,
          openedAt,
          markPrice: await this.fetchLastPrice(symbol),
          dayOpenPrice: null,
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

        // Fallback for a createTime mismatch: an open row for the same
        // symbol+side that is NOT currently live (so we never close a still-open
        // position).
        if (!match) {
          const opens = await this.repo.findOpenBySymbolSide(c.symbol, c.holdSide);
          match =
            opens.find((o) => !liveKeys.has(o.tradeKey) && o.openedAt.getTime() <= c.closedAt.getTime()) ??
            null;
        }

        if (match && match.status === 'open' && !liveKeys.has(match.tradeKey)) {
          await this.repo.markClosed(match.id, this.closeInput(c));
          await this.writeClosedLog(match.tradeKey, c, match.leverage ?? c.leverage);
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
            leverage: c.leverage,
            openedAt: c.openedAt,
            ...this.closeInput(c),
          });
          await this.writeOpenedLog(tradeKey, c.symbol, c.holdSide, {
            openAvgPrice: c.openAvgPrice,
            openTotalPos: c.openTotalPos,
            openedAt: c.openedAt,
            markPrice: c.openAvgPrice,
            dayOpenPrice: null,
          });
          await this.writeClosedLog(tradeKey, c, c.leverage);
          closed++;
        }
      }

      if (opened || closed) {
        this.logger.log(`MEXC trade sync — opened ${opened}, closed ${closed} (${pages} page(s))`);
      }
      return { opened, closed, pages };
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Record ROE% milestones for the currently-open positions — see the Bitget
   * twin for the full ratchet semantics (independent up/down ratchets, reset on
   * a profit⇄loss reversal, one log per step per excursion).
   *
   * MEXC positions carry `unRealizedPnl`, so ROE is that ÷ the position's
   * initial margin. When the field is absent the position is skipped rather than
   * guessed at — a wrong milestone in the journal is worse than a missing one.
   */
  async syncMilestones(): Promise<{ logged: number }> {
    if (!this.isConfigured()) return { logged: 0 };

    const positions = await this.fetchOpenPositions();
    let logged = 0;
    for (const pos of positions) {
      const openedAtMs = Number(pos.createTime);
      const symbol = pos.symbol ? fromMexcSymbol(pos.symbol) : '';
      if (!symbol || !Number.isFinite(openedAtMs) || openedAtMs <= 0) continue;

      const margin = Number(pos.im ?? pos.oim);
      const raw = pos.unRealizedPnl ?? pos.unrealizedPnl;
      const upl = raw != null ? Number(raw) : NaN;
      if (!(margin > 0) || !Number.isFinite(upl)) continue;
      const roe = (upl / margin) * 100;

      const holdSide = pos.positionType === 2 ? 'short' : 'long';
      const tradeKey = tradeKeyOf(symbol, holdSide, openedAtMs);
      const trade = await this.repo.findByTradeKey(tradeKey);
      if (!trade || trade.status !== 'open') continue;

      logged += await this.recordMilestones(trade, roe, await this.fetchLastPrice(symbol));
    }
    if (logged > 0) this.logger.log(`MEXC milestone sync — logged ${logged} PnL milestone(s)`);
    return { logged };
  }

  /**
   * Advance the up/down ROE ratchets for one open trade, writing a journal item
   * for every newly-passed milestone step. Returns how many items were written.
   */
  private async recordMilestones(
    trade: {
      id: string;
      tradeKey: string;
      symbol: string;
      holdSide: string;
      peakRoePct: number | null;
      troughRoePct: number | null;
    },
    roe: number,
    markPrice: number,
  ): Promise<number> {
    let written = 0;
    const patch: { peakRoePct?: number | null; troughRoePct?: number | null } = {};

    // A profit⇄loss reversal — ROE crossing 0 — resets the OPPOSITE ratchet so its
    // milestones log fresh on the next run in that direction.
    if (roe <= 0 && trade.peakRoePct != null) patch.peakRoePct = null;
    if (roe >= 0 && trade.troughRoePct != null) patch.troughRoePct = null;

    const prevPeak = patch.peakRoePct === null ? -Infinity : trade.peakRoePct ?? -Infinity;
    const newUp = UP_MILESTONES.filter((m) => m <= roe && m > prevPeak);
    for (const m of newUp) {
      await this.writeMilestoneLog(trade, m, roe, markPrice);
      written++;
    }
    if (newUp.length > 0) patch.peakRoePct = newUp[newUp.length - 1];

    const prevTrough = patch.troughRoePct === null ? Infinity : trade.troughRoePct ?? Infinity;
    const newDown = DOWN_MILESTONES.filter((m) => m >= roe && m < prevTrough);
    for (const m of newDown) {
      await this.writeMilestoneLog(trade, m, roe, markPrice);
      written++;
    }
    if (newDown.length > 0) patch.troughRoePct = newDown[newDown.length - 1];

    // Persist whenever a ratchet advanced OR was reset by a reversal.
    if (Object.keys(patch).length > 0) {
      await this.repo
        .updateMilestones(trade.id, patch)
        .catch((err) =>
          this.logger.warn(`Failed to advance milestone ratchet for ${trade.tradeKey}: ${(err as Error).message}`),
        );
    }
    return written;
  }

  private async writeMilestoneLog(
    trade: { tradeKey: string; symbol: string; holdSide: string },
    milestone: number,
    roe: number,
    markPrice: number,
  ): Promise<void> {
    const side = trade.holdSide === 'short' ? 'SHORT' : 'LONG';
    const up = milestone >= 0;
    const label = `${up ? '+' : '−'}${Math.abs(milestone)}%`;
    const roeStr = `${roe >= 0 ? '+' : '−'}${Math.abs(roe).toFixed(2)}%`;
    const content = [
      `${up ? '🎯' : '⚠️'} **Đạt mốc PnL ${label}** ${side} ${trade.symbol}`,
      `- ROE hiện tại: ${roeStr}`,
      `- Giá: ${fmtNum(markPrice)}`,
    ].join('\n');
    await this.journalRepo
      .create({
        tradeKey: trade.tradeKey,
        kind: 'system',
        symbol: trade.symbol,
        holdSide: trade.holdSide,
        content,
        snapshot: { markPrice: Number.isFinite(markPrice) ? markPrice : undefined, roePct: roe },
      })
      .catch((err) =>
        this.logger.warn(`Failed to write milestone log for ${trade.tradeKey}: ${(err as Error).message}`),
      );
  }

  private closeInput(c: MexcClosedNormalized) {
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
    info: {
      openAvgPrice: number;
      openTotalPos: number;
      openedAt: Date;
      markPrice: number;
      /** Day-open (00:00 UTC) price — MEXC's ticker has no such field, so null. */
      dayOpenPrice: number | null;
    },
  ): Promise<void> {
    const side = holdSide === 'short' ? 'SHORT' : 'LONG';
    const dayOpenChangePct =
      info.dayOpenPrice != null ? ((info.openAvgPrice - info.dayOpenPrice) / info.dayOpenPrice) * 100 : null;
    const lines = [
      `🟢 **Đã mở lệnh** ${side} ${symbol}`,
      `- Giá vào: ${fmtNum(info.openAvgPrice)}`,
      `- Size: ${fmtNum(info.openTotalPos)}`,
    ];
    if (dayOpenChangePct != null) {
      const sign = dayOpenChangePct >= 0 ? '+' : '−';
      lines.push(`- So với giá mở cửa hôm nay (00:00 UTC): ${sign}${Math.abs(dayOpenChangePct).toFixed(2)}%`);
    }
    await this.journalRepo
      .create({
        tradeKey,
        kind: 'system',
        symbol,
        holdSide,
        content: lines.join('\n'),
        snapshot: {
          entryPrice: info.openAvgPrice,
          markPrice: Number.isFinite(info.markPrice) && info.markPrice > 0 ? info.markPrice : info.openAvgPrice,
          ...(info.dayOpenPrice != null ? { dayOpenPrice: info.dayOpenPrice } : {}),
          ...(dayOpenChangePct != null ? { dayOpenChangePct } : {}),
        },
      })
      .catch((err) => this.logger.warn(`Failed to write opened log for ${tradeKey}: ${(err as Error).message}`));
  }

  private async writeClosedLog(
    tradeKey: string,
    c: MexcClosedNormalized,
    leverage: number | null | undefined,
  ): Promise<void> {
    const side = c.holdSide === 'short' ? 'SHORT' : 'LONG';
    const sign = c.netProfit >= 0 ? '+' : '−';

    // Price move in the trade's favour (long: up = gain, short: down = gain),
    // then scaled by leverage so the log shows the leveraged return.
    const rawPct =
      c.openAvgPrice > 0
        ? ((c.closeAvgPrice - c.openAvgPrice) / c.openAvgPrice) * 100 * (c.holdSide === 'short' ? -1 : 1)
        : null;
    const changeLine =
      rawPct != null
        ? leverage && leverage > 0
          ? `- Biến động giá: ${fmtPct(rawPct)} × ${fmtLev(leverage)} = ${fmtPct(rawPct * leverage)} (gồm đòn bẩy)`
          : `- Biến động giá: ${fmtPct(rawPct)}`
        : null;

    const content = [
      `🔴 **Đã đóng lệnh** ${side} ${c.symbol}`,
      `- Giá đóng: ${fmtNum(c.closeAvgPrice)}`,
      ...(changeLine ? [changeLine] : []),
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

  /**
   * Page through closed history from the floor and normalize the rows. MEXC
   * pages by number (newest first), so we walk forward until a page comes back
   * short or every row on it predates the floor.
   */
  private async fetchClosedHistory(
    now: number,
    floor: number,
  ): Promise<{ rows: MexcClosedNormalized[]; pages: number }> {
    const watermark = await this.repo.latestClosedAt();
    const startTime = Math.max(floor, watermark ? watermark.getTime() - OVERLAP_MS : floor);

    const collected: MexcClosedRaw[] = [];
    let pages = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      pages = page;
      const env = await this.signedGet<HistoryEnvelope>(HISTORY_PATH, {
        page_num: String(page),
        page_size: String(PAGE_LIMIT),
        start_time: String(startTime),
        end_time: String(now),
      });
      const list = Array.isArray(env.data) ? env.data : env.data?.resultList ?? [];
      collected.push(...list);
      if (list.length < PAGE_LIMIT) break;
    }

    const rows: MexcClosedNormalized[] = [];
    for (const raw of collected) {
      // Only fully-closed positions — a partially-closed one is still live.
      if (raw.state != null && raw.state !== STATE_CLOSED) continue;
      const symbol = raw.symbol ? fromMexcSymbol(raw.symbol) : '';
      if (!symbol) continue;
      const normalized = normalizeMexcClosed(
        { ...raw, symbol },
        await this.contractSizeOf(symbol),
      );
      if (normalized && normalized.closedAt.getTime() >= floor) rows.push(normalized);
    }
    return { rows, pages };
  }

  private async fetchOpenPositions(): Promise<OpenPositionRaw[]> {
    const env = await this.signedGet<OpenPositionEnvelope>(OPEN_POSITION_PATH, {});
    return (env.data ?? []).filter((p) => Number(p.holdVol) > 0);
  }

  /**
   * Base-asset amount of one contract, from the public contract-detail endpoint
   * (cached per symbol). Falls back to 1 — i.e. "volumes are already in the base
   * asset" — so a lookup failure degrades the recorded size rather than dropping
   * the trade entirely.
   */
  private async contractSizeOf(symbol: string): Promise<number> {
    const cached = this.contractSizes.get(symbol);
    if (cached != null) return cached;
    try {
      const res = await this.client.get<{ data: { contractSize?: number } | Array<{ contractSize?: number }> }>(
        CONTRACT_DETAIL_PATH,
        { params: { symbol: toMexcSymbol(symbol) } },
      );
      const row = Array.isArray(res.data.data) ? res.data.data[0] : res.data.data;
      const size = Number(row?.contractSize);
      const value = Number.isFinite(size) && size > 0 ? size : 1;
      this.contractSizes.set(symbol, value);
      return value;
    } catch (err) {
      this.logger.debug(`Failed to fetch contract size for ${symbol}: ${(err as Error).message}`);
      return 1;
    }
  }

  /** Last traded price from the public ticker; 0 when unavailable (non-fatal). */
  private async fetchLastPrice(symbol: string): Promise<number> {
    try {
      const res = await this.client.get<{
        data: { lastPrice?: number } | Array<{ lastPrice?: number }> | null;
      }>(TICKER_PATH, { params: { symbol: toMexcSymbol(symbol) } });
      const row = Array.isArray(res.data.data) ? res.data.data[0] : res.data.data;
      const price = Number(row?.lastPrice);
      return Number.isFinite(price) && price > 0 ? price : 0;
    } catch (err) {
      this.logger.debug(`Failed to fetch last price for ${symbol}: ${(err as Error).message}`);
      return 0;
    }
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

    const times = openPositions.map((p) => Number(p.createTime)).filter((t) => Number.isFinite(t) && t > 0);
    if (times.length === 0) return null;

    const start = new Date(Math.min(Math.min(...times), now));
    await this.stateRepo.setHistoryStartAt(start);
    const purged = await this.repo.deleteClosedBefore(start);
    this.logger.log(
      `Anchored MEXC history start to ${start.toISOString()} (earliest open position); purged ${purged} older row(s)`,
    );
    return start;
  }

  /**
   * Signed GET. MEXC signs `accessKey + timestamp + <sorted query string>` with
   * HMAC-SHA256 in HEX — the signed string MUST be byte-identical to what is
   * sent, so the query string is built once and reused for both.
   */
  private async signedGet<E extends { success?: boolean; code?: number; message?: string }>(
    path: string,
    query: Record<string, string>,
  ): Promise<E> {
    const timestamp = Date.now().toString();
    const queryString = Object.keys(query)
      .sort()
      .map((k) => `${k}=${query[k]}`)
      .join('&');
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const sign = createHmac('sha256', this.apiSecret)
      .update(this.apiKey + timestamp + queryString)
      .digest('hex');

    const res = await this.client.request<E>({
      method: 'GET' as Method,
      url: requestPath,
      headers: {
        ApiKey: this.apiKey,
        'Request-Time': timestamp,
        Signature: sign,
        'Recv-Window': '30',
        'Content-Type': 'application/json',
      },
    });

    if (res.data.success === false || (res.data.code != null && res.data.code !== 0)) {
      throw new Error(`MEXC ${path} error ${res.data.code}: ${res.data.message ?? 'unknown error'}`);
    }
    return res.data;
  }
}
