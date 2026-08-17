import { createHmac } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import axios, { type AxiosInstance, type Method } from 'axios';
import { normalizeOkxClosed, fromOkxInstId, type OkxClosedRaw, type OkxClosedNormalized } from '@app/core';
import {
  createOkxTradeRepository,
  createOkxTradeJournalRepository,
  createOkxSyncStateRepository,
} from '@app/db';

/**
 * Reconciles OKX USDT-swap trades into the `okx_trades` lifecycle table — the
 * OKX twin of `BitgetHistoryService` / `MexcHistoryService`, kept as its own
 * service (with its own signing) so no exchange's sync can break another.
 *
 * On each run it:
 *   1. Reads live open positions (`/account/positions`) → inserts any newly-seen
 *      one as `status = open` and writes a system "opened" log item.
 *   2. Reads closed position history (`/account/positions-history`) → flips the
 *      matching open row to `status = closed` (filling realized-PnL) and writes a
 *      system "closed" log item. A trade opened+closed between polls is inserted
 *      closed directly, with both an "opened" and "closed" log.
 *
 * OKX-specific details that shape the code:
 *   - Sizes are in CONTRACTS; `ctVal` (from the public instruments endpoint,
 *     cached) converts them to the base asset the dashboard shows.
 *   - Instruments are `BTC-USDT-SWAP` on the wire and `BTCUSDT` in the app.
 *   - In the default NET position mode `posSide` is the literal `"net"` and `pos`
 *     is signed, so the direction comes from the sign; in long/short mode it
 *     comes from `posSide`. History rows carry `direction` in both modes.
 *   - History is paged by an `after` cursor over `uTime` (newest first), not by
 *     a page number.
 *
 * Read-only against the exchange, driven by SchedulerService (every 15s) + a
 * catch-up sync on boot.
 */

const BASE_URL = process.env.OKX_API_BASE_URL ?? 'https://www.okx.com';
const HISTORY_PATH = '/api/v5/account/positions-history';
const OPEN_POSITION_PATH = '/api/v5/account/positions';
const INSTRUMENTS_PATH = '/api/v5/public/instruments';
const TICKER_PATH = '/api/v5/market/ticker';
/** OKX instrument family the dashboard trades — USDT-margined perpetual swaps. */
const INST_TYPE = 'SWAP';
/** OKX only keeps ~3 months of position history; this floor matches that. */
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 100;
const MAX_PAGES = 40; // safety cap: 40 × 100 = 4000 trades per sync
// Re-scan a day back of the watermark so trades that settle slightly after close
// (funding/fees) are refreshed rather than missed.
const OVERLAP_MS = 24 * 60 * 60 * 1000;

/** Open-position row (the fields we read to track the live trade). */
type OpenPositionRaw = {
  posId?: string;
  instId?: string;
  posSide?: string;
  mgnMode?: string;
  pos?: string;
  avgPx?: string;
  imr?: string;
  margin?: string;
  lever?: string;
  upl?: string;
  cTime?: string;
};

// ROE% milestones we record on a trade's journal, as a ratchet in each direction.
// ROE = upl ÷ margin × 100 — the same number the /okx table shows. Only recorded
// once per step and never re-logged when ROE dips and recovers.
const UP_MILESTONES = [50, 70, 100, 150, 200];
const DOWN_MILESTONES = [-50, -80, -100, -200, -300, -400, -500];

/** App symbol (`BTCUSDT`) → OKX instrument id (`BTC-USDT-SWAP`). */
function toOkxInstId(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes('-')) return s.endsWith(`-${INST_TYPE}`) ? s : `${s}-${INST_TYPE}`;
  const base = s.endsWith('USDT') ? s.slice(0, -4) : s;
  return `${base}-USDT-${INST_TYPE}`;
}

/** Direction of a live position: explicit in long/short mode, signed in net mode. */
function holdSideOf(pos: OpenPositionRaw): 'long' | 'short' {
  if (pos.posSide === 'long' || pos.posSide === 'short') return pos.posSide;
  return Number(pos.pos) < 0 ? 'short' : 'long';
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
export class OkxHistoryService implements OnModuleInit {
  private readonly logger = new Logger(OkxHistoryService.name);
  private readonly repo = createOkxTradeRepository();
  private readonly journalRepo = createOkxTradeJournalRepository();
  private readonly stateRepo = createOkxSyncStateRepository();
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 10_000 });

  private readonly apiKey = process.env.OKX_API_KEY ?? '';
  private readonly apiSecret = process.env.OKX_API_SECRET ?? '';
  private readonly passphrase = process.env.OKX_API_PASSPHRASE ?? '';
  /** Demo-trading flag — must match the API app's, or the two read different accounts. */
  private readonly simulated = process.env.OKX_SIMULATED === 'true';
  /** Contract values barely change — cache them for the process lifetime. */
  private readonly contractSizes = new Map<string, number>();

  private syncing = false;

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.passphrase);
  }

  /** One catch-up sync a few seconds after boot so the page has data on deploy. */
  onModuleInit(): void {
    if (!this.isConfigured()) return;
    setTimeout(() => {
      this.sync().catch((err) =>
        this.logger.warn(`Initial OKX trade sync failed: ${(err as Error).message}`),
      );
    }, 10_000);
  }

  /**
   * Reconcile open positions + closed history into `okx_trades`. Returns how
   * many trades were opened / closed this run. Guarded against overlapping runs.
   */
  async sync(): Promise<{ opened: number; closed: number; pages: number }> {
    if (!this.isConfigured()) {
      this.logger.debug('OKX trade sync skipped — credentials not configured');
      return { opened: 0, closed: 0, pages: 0 };
    }
    if (this.syncing) {
      this.logger.debug('OKX trade sync already in progress — skipping');
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
        const symbol = pos.instId ? fromOkxInstId(pos.instId) : '';
        if (!symbol || !Number.isFinite(openedAtMs) || openedAtMs <= 0) continue;
        const holdSide = holdSideOf(pos);
        const tradeKey = tradeKeyOf(symbol, holdSide, openedAtMs);
        liveKeys.add(tradeKey);

        const existing = await this.repo.findByTradeKey(tradeKey);
        if (existing) continue;

        const ctVal = await this.contractSizeOf(symbol);
        const openAvgPrice = Number(pos.avgPx);
        const openTotalPos = Math.abs(Number(pos.pos)) * ctVal;
        const leverage = Number(pos.lever);
        const openedAt = new Date(openedAtMs);
        await this.repo.createOpen({
          tradeKey,
          symbol,
          holdSide,
          marginMode: pos.mgnMode === 'isolated' ? 'isolated' : 'crossed',
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
      const { rows: closedRows, pages } = await this.fetchClosedHistory(floor);

      let closed = 0;
      for (const c of closedRows) {
        // Idempotent: a trade already closed (positionId recorded) is skipped.
        const byPid = await this.repo.findByPositionId(c.positionId);
        if (byPid) continue;

        const tradeKey = tradeKeyOf(c.symbol, c.holdSide, c.openedAt.getTime());
        let match = await this.repo.findByTradeKey(tradeKey);

        // Fallback for a cTime mismatch: an open row for the same symbol+side
        // that is NOT currently live (so we never close a still-open position).
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
        this.logger.log(`OKX trade sync — opened ${opened}, closed ${closed} (${pages} page(s))`);
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
   * OKX positions carry `upl`, so ROE is that ÷ the position's initial margin
   * (`imr` on cross, `margin` on isolated). When either is absent the position is
   * skipped rather than guessed at — a wrong milestone in the journal is worse
   * than a missing one.
   */
  async syncMilestones(): Promise<{ logged: number }> {
    if (!this.isConfigured()) return { logged: 0 };

    const positions = await this.fetchOpenPositions();
    let logged = 0;
    for (const pos of positions) {
      const openedAtMs = Number(pos.cTime);
      const symbol = pos.instId ? fromOkxInstId(pos.instId) : '';
      if (!symbol || !Number.isFinite(openedAtMs) || openedAtMs <= 0) continue;

      const margin = Number(pos.imr ?? pos.margin);
      const upl = pos.upl != null && pos.upl !== '' ? Number(pos.upl) : NaN;
      if (!(margin > 0) || !Number.isFinite(upl)) continue;
      const roe = (upl / margin) * 100;

      const holdSide = holdSideOf(pos);
      const tradeKey = tradeKeyOf(symbol, holdSide, openedAtMs);
      const trade = await this.repo.findByTradeKey(tradeKey);
      if (!trade || trade.status !== 'open') continue;

      logged += await this.recordMilestones(trade, roe, await this.fetchLastPrice(symbol));
    }
    if (logged > 0) this.logger.log(`OKX milestone sync — logged ${logged} PnL milestone(s)`);
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

  private closeInput(c: OkxClosedNormalized) {
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
      /** Day-open (00:00 UTC) price — filled from the ticker's `sodUtc0` when present. */
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
    c: OkxClosedNormalized,
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
   * Page through closed history from the floor and normalize the rows. OKX pages
   * with an `after` cursor over `uTime` (newest first), so we walk backwards
   * until a page comes back short or its oldest row predates the start time.
   */
  private async fetchClosedHistory(floor: number): Promise<{ rows: OkxClosedNormalized[]; pages: number }> {
    const watermark = await this.repo.latestClosedAt();
    const startTime = Math.max(floor, watermark ? watermark.getTime() - OVERLAP_MS : floor);

    const collected: OkxClosedRaw[] = [];
    let pages = 0;
    let cursor: string | undefined;
    for (let page = 1; page <= MAX_PAGES; page++) {
      pages = page;
      const list = await this.signedGet<OkxClosedRaw[]>(HISTORY_PATH, {
        instType: INST_TYPE,
        limit: String(PAGE_LIMIT),
        ...(cursor ? { after: cursor } : {}),
      });
      if (!list || list.length === 0) break;
      collected.push(...list);

      const oldest = Math.min(...list.map((r) => Number(r.uTime)).filter((t) => Number.isFinite(t) && t > 0));
      if (list.length < PAGE_LIMIT || !Number.isFinite(oldest) || oldest <= startTime) break;
      cursor = String(oldest);
    }

    const rows: OkxClosedNormalized[] = [];
    for (const raw of collected) {
      // A row with nothing closed out is not a finished trade — skip it rather
      // than persist a half-formed position.
      if (!raw.instId || !(Number(raw.closeTotalPos) > 0) || !(Number(raw.closeAvgPx) > 0)) continue;
      const normalized = normalizeOkxClosed(raw, await this.contractSizeOf(fromOkxInstId(raw.instId)));
      if (normalized && normalized.closedAt.getTime() >= floor) rows.push(normalized);
    }
    return { rows, pages };
  }

  private async fetchOpenPositions(): Promise<OpenPositionRaw[]> {
    const rows = await this.signedGet<OpenPositionRaw[]>(OPEN_POSITION_PATH, { instType: INST_TYPE });
    return (rows ?? []).filter((p) => Math.abs(Number(p.pos)) > 0);
  }

  /**
   * Base-asset amount of one contract (`ctVal`), from the public instruments
   * endpoint (cached per symbol). Falls back to 1 — i.e. "sizes are already in
   * the base asset" — so a lookup failure degrades the recorded size rather than
   * dropping the trade entirely.
   */
  private async contractSizeOf(symbol: string): Promise<number> {
    const cached = this.contractSizes.get(symbol);
    if (cached != null) return cached;
    try {
      const res = await this.client.get<{ data?: Array<{ ctVal?: string }> }>(INSTRUMENTS_PATH, {
        params: { instType: INST_TYPE, instId: toOkxInstId(symbol) },
      });
      const size = Number(res.data.data?.[0]?.ctVal);
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
      const res = await this.client.get<{ data?: Array<{ last?: string }> }>(TICKER_PATH, {
        params: { instId: toOkxInstId(symbol) },
      });
      const price = Number(res.data.data?.[0]?.last);
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

    const times = openPositions.map((p) => Number(p.cTime)).filter((t) => Number.isFinite(t) && t > 0);
    if (times.length === 0) return null;

    const start = new Date(Math.min(Math.min(...times), now));
    await this.stateRepo.setHistoryStartAt(start);
    const purged = await this.repo.deleteClosedBefore(start);
    this.logger.log(
      `Anchored OKX history start to ${start.toISOString()} (earliest open position); purged ${purged} older row(s)`,
    );
    return start;
  }

  /**
   * Signed GET. OKX signs `timestamp + METHOD + requestPath + body` with
   * HMAC-SHA256 in BASE64, where the timestamp is ISO-8601 with milliseconds and
   * `requestPath` INCLUDES the query string — the signed string MUST be
   * byte-identical to what is sent, so the path is built once and reused.
   */
  private async signedGet<T>(path: string, query: Record<string, string>): Promise<T> {
    const timestamp = new Date().toISOString();
    const queryString = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const sign = createHmac('sha256', this.apiSecret)
      .update(`${timestamp}GET${requestPath}`)
      .digest('base64');

    const headers: Record<string, string> = {
      'OK-ACCESS-KEY': this.apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': this.passphrase,
      'Content-Type': 'application/json',
    };
    if (this.simulated) headers['x-simulated-trading'] = '1';

    const res = await this.client.request<{ code?: string; msg?: string; data: T }>({
      method: 'GET' as Method,
      url: requestPath,
      headers,
    });

    if (res.data.code != null && res.data.code !== '0') {
      throw new Error(`OKX ${path} error ${res.data.code}: ${res.data.msg ?? 'unknown error'}`);
    }
    return res.data.data;
  }
}
