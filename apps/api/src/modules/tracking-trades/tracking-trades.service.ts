import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { AnalysisTimeframe } from '@app/config';
import { createTrackingSetupRepository, TRACKING_ACTIVE_STATUSES } from '@app/db';

import { renderSetupChart, SETUP_CHART_TF_CONFIG, type OhlcCandle } from '../bitget/setup-chart-renderer';
import { ClaudeChatProvider } from '../chat/providers/claude-chat.provider';
import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { StorageService } from '../storage/storage.service';
import {
  buildTargets,
  closeManually,
  fill,
  fmtPx,
  plannedRR,
  step,
  type Bar,
  type EngineEvent,
  type EngineState,
  type Target,
  validatePlan,
} from './tracking-engine';
import { bareSymbol, createTrackingSetup, pairOf, SetupInputError, type SetupInput } from './tracking-setup-factory';

const BASE = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';
const MINUTE = 60_000;
const H4 = 4 * 3_600_000;
/** Closed setups per lesson batch. */
export const LESSON_BATCH_SIZE = 100;

type SetupRow = NonNullable<Awaited<ReturnType<ReturnType<typeof createTrackingSetupRepository>['findById']>>>;

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function toState(r: SetupRow): EngineState {
  return {
    status: r.status as EngineState['status'],
    direction: r.direction as EngineState['direction'],
    orderType: r.orderType as EngineState['orderType'],
    entryPrice: r.entryPrice,
    stopLoss: r.stopLoss,
    targets: (r.targets as Target[]).map((t) => ({ ...t })),
    riskUsd: r.riskUsd,
    fillPrice: r.fillPrice,
    quantity: r.quantity,
    remainingQty: r.remainingQty,
    currentStop: r.currentStop,
    filledAt: r.filledAt?.getTime() ?? null,
    closedAt: r.closedAt?.getTime() ?? null,
    closeReason: r.closeReason as EngineState['closeReason'],
    realizedPnlUsd: r.realizedPnlUsd ?? 0,
    mfeR: r.mfeR,
    maeR: r.maeR,
    mfeAt: r.mfeAt?.getTime() ?? null,
    maeAt: r.maeAt?.getTime() ?? null,
    pathR: (r.pathR as number[] | null) ?? [],
  };
}

function fromState(s: EngineState) {
  const d = (ms: number | null) => (ms == null ? null : new Date(ms));
  return {
    status: s.status,
    targets: s.targets,
    fillPrice: s.fillPrice,
    quantity: s.quantity,
    remainingQty: s.remainingQty,
    currentStop: s.currentStop,
    filledAt: d(s.filledAt),
    closedAt: d(s.closedAt),
    closeReason: s.closeReason,
    realizedPnlUsd: s.fillPrice != null ? s.realizedPnlUsd : null,
    rMultiple: s.status === 'CLOSED' ? s.realizedPnlUsd / s.riskUsd : null,
    mfeR: s.mfeR,
    maeR: s.maeR,
    mfeAt: d(s.mfeAt),
    maeAt: d(s.maeAt),
    pathR: s.pathR,
  };
}

/** Win rate / total R per group of closed setups. */
function groupStats(rows: SetupRow[], key: (r: SetupRow) => string) {
  const map = new Map<string, SetupRow[]>();
  for (const r of rows) map.set(key(r), [...(map.get(key(r)) ?? []), r]);
  return [...map.entries()]
    .map(([group, list]) => {
      const rs = list.map((r) => r.rMultiple ?? 0);
      const total = rs.reduce((a, b) => a + b, 0);
      return { group, trades: list.length, winRate: round(rs.filter((r) => r > 0).length / list.length, 3), totalR: round(total), avgR: round(total / list.length, 3) };
    })
    .sort((a, b) => b.trades - a.trades);
}

@Injectable()
export class TrackingTradesService {
  private readonly logger = new Logger(TrackingTradesService.name);
  private readonly repo = createTrackingSetupRepository();
  private ticking = false;

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly storage: StorageService,
    private readonly claude: ClaudeChatProvider,
  ) {}

  // ---------------- read ----------------

  /** A setup row plus what the page shows next to it. */
  private present(r: SetupRow) {
    const targets = r.targets as Target[];
    const entry = r.fillPrice ?? r.entryPrice;
    const risk = Math.abs(entry - r.stopLoss);
    const dir = r.direction === 'SHORT' ? -1 : 1;
    const unrealizedR =
      r.status === 'OPEN' && r.lastPrice != null && r.quantity
        ? round(((r.realizedPnlUsd ?? 0) + (r.remainingQty ?? 0) * (r.lastPrice - entry) * dir) / r.riskUsd, 2)
        : null;
    return { ...r, pair: pairOf(r.symbol), plannedRR: plannedRR(r.entryPrice, r.stopLoss, targets), riskPct: round((risk / entry) * 100, 2), unrealizedR };
  }

  async overview() {
    const [setups, config, batches] = await Promise.all([this.repo.list({}, 1000), this.repo.getConfig(), this.repo.listLessonBatches()]);
    const closed = setups.filter((s) => s.status === 'CLOSED');
    const unbatched = closed.filter((s) => !s.lessonBatchId).length;
    return {
      setups: setups.map((s) => this.present(s)),
      stats: this.stats(closed),
      config: { riskUsd: config.riskUsd },
      lessons: { batches, unbatched, batchSize: LESSON_BATCH_SIZE, canDraft: unbatched >= LESSON_BATCH_SIZE && !batches.some((b) => b.status === 'DRAFT') },
    };
  }

  stats(closed: SetupRow[]) {
    const rs = closed.map((r) => r.rMultiple ?? 0);
    const total = rs.reduce((a, b) => a + b, 0);
    const rated = closed.filter((r) => r.rating != null);
    return {
      closed: closed.length,
      winRate: closed.length ? round(rs.filter((r) => r > 0).length / closed.length, 3) : null,
      totalR: round(total),
      avgR: closed.length ? round(total / closed.length, 3) : null,
      avgRating: rated.length ? round(rated.reduce((a, r) => a + r.rating!, 0) / rated.length, 2) : null,
      bySetupType: groupStats(closed, (r) => r.setupType?.trim() || '(chưa phân loại)'),
      bySymbol: groupStats(closed, (r) => r.symbol),
      byDirection: groupStats(closed, (r) => r.direction),
      bySource: groupStats(closed, (r) => (r.source === 'CLAUDE' ? 'Claude' : 'Tự nhập')),
      byIntervention: groupStats(closed, (r) => (r.manualIntervention ? 'Có can thiệp tay' : 'Để lệnh tự chạy')),
      byCloseReason: groupStats(closed, (r) => r.closeReason ?? '?'),
    };
  }

  async listForSymbol(symbol: string) {
    const bare = bareSymbol(symbol);
    const [setups, events] = await Promise.all([this.repo.list({ symbol: bare }, 200), this.repo.listEvents({ symbol: bare }, 300)]);
    return { setups: setups.map((s) => this.present(s)), events };
  }

  async getSetup(id: string) {
    const s = await this.load(id);
    return { setup: this.present(s), events: await this.repo.listEvents({ setupId: id }) };
  }

  private async load(id: string): Promise<SetupRow> {
    const s = await this.repo.findById(id);
    if (!s) throw new NotFoundException(`Setup ${id} không tồn tại`);
    return s;
  }

  // ---------------- create / decide ----------------

  async createManual(body: SetupInput & { place?: boolean }) {
    try {
      const setup = await createTrackingSetup(body, { source: 'MANUAL', status: 'WATCHING' });
      if (body.place) return this.place(setup.id, {});
      return { setup: this.present(setup) };
    } catch (e) {
      if (e instanceof SetupInputError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /** PROPOSED → WATCHING: keep the idea and wait for its trigger. */
  async watch(id: string) {
    const s = await this.load(id);
    if (s.status !== 'PROPOSED') throw new BadRequestException('Chỉ setup vừa đề xuất mới chuyển sang theo dõi được.');
    const updated = await this.repo.update(id, { status: 'WATCHING' });
    await this.event(s, 'WATCHING', `Theo dõi ý tưởng${s.triggerNote ? ` — chờ: ${s.triggerNote}` : ''}.`, s.entryPrice);
    return { setup: this.present(updated) };
  }

  /** PROPOSED / WATCHING → PENDING (LIMIT/STOP) or OPEN (MARKET, or a limit already through). */
  async place(id: string, edits: Partial<Pick<SetupInput, 'entryPrice' | 'stopLoss' | 'orderType'>>) {
    const s = await this.load(id);
    if (s.status !== 'PROPOSED' && s.status !== 'WATCHING') throw new BadRequestException('Setup này không còn ở bước chờ đặt lệnh.');
    const orderType = (edits.orderType ?? s.orderType) as EngineState['orderType'];
    const entryPrice = edits.entryPrice ?? s.entryPrice;
    const stopLoss = edits.stopLoss ?? s.stopLoss;
    const price = await this.binance.fetchCurrentPrice(pairOf(s.symbol));
    const long = s.direction === 'LONG';
    const dir = long ? 1 : -1;
    const fillNow =
      orderType === 'MARKET' ||
      (orderType === 'LIMIT' && (long ? price <= entryPrice : price >= entryPrice)) ||
      (orderType === 'STOP' && (long ? price >= entryPrice : price <= entryPrice));
    const targets = s.targets as Target[];
    if (fillNow && ((price - stopLoss) * dir <= 0 || (targets[0]!.price - price) * dir <= 0)) {
      throw new BadRequestException(`Giá hiện tại ${fmtPx(price)} đã vượt SL hoặc TP1 — không vào lệnh.`);
    }
    const config = await this.repo.getConfig();
    const now = Date.now();
    const state = toState({ ...s, orderType, entryPrice, stopLoss, riskUsd: config.riskUsd, status: 'PENDING' });
    const events: EngineEvent[] = fillNow ? fill(state, price, now) : [];
    const updated = await this.repo.update(id, {
      ...fromState(state),
      orderType,
      entryPrice,
      stopLoss,
      riskUsd: config.riskUsd,
      placedAt: new Date(now),
      lastPrice: price,
      lastCheckedAt: new Date(now),
    });
    const placed = await this.event(
      updated,
      'PLACED',
      fillNow
        ? `Vào lệnh ${s.direction} ${orderType === 'MARKET' ? 'MARKET' : `${orderType} (giá đã tới)`} @ ${fmtPx(price)}.`
        : `Đặt lệnh ${orderType} ${s.direction} @ ${fmtPx(entryPrice)} (giá hiện tại ${fmtPx(price)}), SL ${fmtPx(stopLoss)}.`,
      fillNow ? price : entryPrice,
    );
    this.attachChart(placed.id, updated);
    await this.saveEvents(updated, events);
    return { setup: this.present(updated) };
  }

  async discard(id: string, reason: string) {
    const s = await this.load(id);
    if (s.status !== 'PROPOSED' && s.status !== 'WATCHING') throw new BadRequestException('Chỉ bỏ được setup chưa đặt lệnh.');
    const updated = await this.repo.update(id, { status: 'DISCARDED', closedAt: new Date() });
    await this.event(s, 'DISCARDED', `Bỏ setup${reason ? `: ${reason}` : ''}.`, null);
    return { setup: this.present(updated) };
  }

  async cancel(id: string, reason: string) {
    const s = await this.load(id);
    if (s.status !== 'PENDING') throw new BadRequestException('Chỉ huỷ được lệnh đang chờ khớp.');
    const updated = await this.repo.update(id, { status: 'CANCELLED', closedAt: new Date() });
    await this.event(s, 'CANCELLED', `Huỷ lệnh chờ khớp${reason ? `: ${reason}` : ''}.`, null);
    return { setup: this.present(updated) };
  }

  /** Edit a plan that hasn't been placed yet. */
  async edit(id: string, body: Partial<SetupInput>) {
    const s = await this.load(id);
    if (s.status !== 'PROPOSED' && s.status !== 'WATCHING') throw new BadRequestException('Chỉ sửa được setup chưa đặt lệnh.');
    const merged: SetupInput = {
      symbol: s.symbol,
      direction: (body.direction ?? s.direction) as SetupInput['direction'],
      orderType: (body.orderType ?? s.orderType) as SetupInput['orderType'],
      entryPrice: body.entryPrice ?? s.entryPrice,
      stopLoss: body.stopLoss ?? s.stopLoss,
      targets: body.targets ?? (s.targets as Target[]).map((t) => t.price),
      targetPcts: body.targetPcts ?? (body.targets ? undefined : (s.targets as Target[]).map((t) => t.pct)),
    };
    const targets = buildTargets(merged.targets, merged.targetPcts);
    const problem = validatePlan(merged.direction, merged.entryPrice, merged.stopLoss, targets);
    if (problem) throw new BadRequestException(problem);
    const updated = await this.repo.update(id, {
      direction: merged.direction,
      orderType: merged.orderType,
      entryPrice: merged.entryPrice,
      stopLoss: merged.stopLoss,
      targets,
      ...(body.setupType !== undefined ? { setupType: body.setupType } : {}),
      ...(body.thesis !== undefined ? { thesis: body.thesis } : {}),
      ...(body.triggerNote !== undefined ? { triggerNote: body.triggerNote } : {}),
      ...(body.invalidation !== undefined ? { invalidation: body.invalidation } : {}),
    });
    await this.event(
      updated,
      'EDITED',
      `Sửa kế hoạch: ${merged.orderType} @ ${fmtPx(merged.entryPrice)}, SL ${fmtPx(merged.stopLoss)}, ${targets.map((t, i) => `TP${i + 1} ${fmtPx(t.price)} (${t.pct}%)`).join(', ')}.`,
      merged.entryPrice,
    );
    return { setup: this.present(updated) };
  }

  // ---------------- manual management ----------------

  async moveStop(id: string, price: number, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Cần ghi lý do khi dời SL.');
    const s = await this.load(id);
    if (s.status !== 'OPEN') throw new BadRequestException('Chỉ dời SL được khi lệnh đang mở.');
    const now = await this.binance.fetchCurrentPrice(pairOf(s.symbol));
    const dir = s.direction === 'SHORT' ? -1 : 1;
    if ((now - price) * dir <= 0) throw new BadRequestException(`SL mới phải nằm ${dir === 1 ? 'dưới' : 'trên'} giá hiện tại ${fmtPx(now)}.`);
    const ok = await this.repo.updateIfUnchanged(id, s.updatedAt, { currentStop: price, manualIntervention: true });
    if (!ok) throw new BadRequestException('Lệnh vừa được cập nhật, thử lại.');
    await this.event(s, 'STOP_MOVED', `Dời SL tay ${fmtPx(s.currentStop ?? s.stopLoss)} → ${fmtPx(price)}. Lý do: ${reason.trim()}`, price, { manual: true, from: s.currentStop, reason: reason.trim() });
    return this.getSetup(id);
  }

  async closeManual(id: string, pct: number, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Cần ghi lý do khi đóng tay.');
    const s = await this.load(id);
    if (s.status !== 'OPEN') throw new BadRequestException('Chỉ đóng được lệnh đang mở.');
    if (!(pct > 0 && pct <= 100)) throw new BadRequestException('% đóng phải từ 1 đến 100.');
    const price = await this.binance.fetchCurrentPrice(pairOf(s.symbol));
    const state = toState(s);
    const now = Date.now();
    const events = closeManually(state, pct, price, now);
    const ok = await this.repo.updateIfUnchanged(id, s.updatedAt, { ...fromState(state), manualIntervention: true, lastPrice: price });
    if (!ok) throw new BadRequestException('Lệnh vừa được cập nhật, thử lại.');
    const updated = await this.load(id);
    await this.event(updated, 'MANUAL_CLOSE', `Đóng tay ${pct >= 99.9 ? 'toàn bộ' : `${round(pct, 1)}% phần còn lại`} @ ${fmtPx(price)}. Lý do: ${reason.trim()}`, price, { manual: true, pct, reason: reason.trim() });
    await this.saveEvents(updated, events);
    return this.getSetup(id);
  }

  async review(id: string, rating: number | null, note: string | null) {
    const s = await this.load(id);
    if (rating != null && !(rating >= 1 && rating <= 5)) throw new BadRequestException('Điểm từ 1 đến 5.');
    const updated = await this.repo.update(id, { rating, reviewNote: note?.trim() || null, reviewedAt: new Date() });
    await this.event(s, 'REVIEW', `Tự đánh giá: ${rating != null ? `${rating}/5` : '—'}${note?.trim() ? ` — ${note.trim()}` : ''}`, null);
    return { setup: this.present(updated) };
  }

  // ---------------- notes ----------------

  async addNote(body: { symbol: string; setupId?: string | null; message: string; images?: string[] }) {
    const message = body.message?.trim() ?? '';
    const images = (body.images ?? []).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 10);
    if (!message && images.length === 0) throw new BadRequestException('Ghi chú trống.');
    return this.repo.addEvent({ symbol: bareSymbol(body.symbol), setupId: body.setupId || null, type: 'NOTE', message, images });
  }

  async deleteNote(id: string) {
    const ev = await this.repo.findEvent(id);
    if (!ev) throw new NotFoundException('Ghi chú không tồn tại');
    if (ev.type !== 'NOTE') throw new BadRequestException('Chỉ xoá được ghi chú tay.');
    await this.repo.deleteEvent(id);
    return { deleted: true };
  }

  async updateConfig(riskUsd: number) {
    if (!(riskUsd > 0 && riskUsd <= 100_000)) throw new BadRequestException('1R phải > 0.');
    return this.repo.updateConfig({ riskUsd });
  }

  // ---------------- monitor ----------------

  @Cron('40 * * * * *')
  async scheduledTick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.runTick();
    } catch (e) {
      this.logger.warn(`tracking tick failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.ticking = false;
    }
  }

  async runTick(): Promise<{ checked: number }> {
    const live = await this.repo.list({ statuses: ['PENDING', 'OPEN'] }, 500);
    for (const s of live) {
      try {
        await this.manage(s);
      } catch (e) {
        this.logger.warn(`[tracking ${s.symbol}] ${s.id} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { checked: live.length };
  }

  private async fetchMinuteBars(pair: string, startTime: number): Promise<Bar[]> {
    const res = await fetch(`${BASE}/api/v3/klines?symbol=${pair}&interval=1m&startTime=${startTime}&limit=1000`);
    if (!res.ok) throw new Error(`Binance ${res.status} ${pair} 1m`);
    const rows = (await res.json()) as Array<[number, string, string, string, string, string, number]>;
    const now = Date.now();
    return rows
      .map((r) => ({ t: r[0], closeT: r[6], open: parseFloat(r[1]), high: parseFloat(r[2]), low: parseFloat(r[3]), close: parseFloat(r[4]) }))
      .filter((b) => b.closeT <= now);
  }

  private async manage(s: SetupRow): Promise<void> {
    const from = Math.ceil((s.lastCheckedAt ?? s.placedAt ?? s.createdAt).getTime() / MINUTE) * MINUTE;
    const bars = (await this.fetchMinuteBars(pairOf(s.symbol), from)).filter((b) => b.t >= from);
    if (bars.length === 0) return;
    const state = toState(s);
    const events = step(state, bars);
    const last = bars[bars.length - 1]!;
    const ok = await this.repo.updateIfUnchanged(s.id, s.updatedAt, {
      ...fromState(state),
      lastPrice: last.close,
      lastCheckedAt: new Date(last.closeT + 1),
    });
    if (!ok) return; // a manual action landed meanwhile — the next tick replays from the stored point
    if (events.length) await this.saveEvents(await this.load(s.id), events);
  }

  // ---------------- events, charts, post-mortem ----------------

  private event(s: SetupRow, type: string, message: string, price: number | null, data?: Record<string, unknown>) {
    return this.repo.addEvent({ symbol: s.symbol, setupId: s.id, type, message, price, ...(data ? { data: data as object } : {}) });
  }

  private async saveEvents(s: SetupRow, events: EngineEvent[]) {
    for (const e of events) {
      const ev = await this.repo.addEvent({
        symbol: s.symbol,
        setupId: s.id,
        type: e.type,
        price: e.price,
        message: e.message,
        createdAt: new Date(e.at),
        ...(e.data ? { data: e.data as object } : {}),
      });
      if (e.type === 'FILLED' || e.type === 'CLOSED') this.attachChart(ev.id, s, e.type === 'CLOSED' ? e.price : undefined);
    }
    if (events.some((e) => e.type === 'CLOSED')) {
      this.logger.log(`[tracking ${s.symbol}] ${s.id} closed ${s.closeReason} ${round(s.rMultiple ?? 0)}R`);
      const warn = (what: string) => (e: unknown) => this.logger.warn(`${what} for ${s.id} failed: ${e instanceof Error ? e.message : e}`);
      void this.writePostMortem(s.id)
        .catch(warn('post-mortem'))
        .finally(() => this.maybeDraftLessons().catch(warn('lesson draft')));
    }
  }

  /** Renders the 4H chart around the setup and attaches it to a timeline event (fire-and-forget). */
  private attachChart(eventId: string, s: SetupRow, exitPrice?: number) {
    this.renderChart(s, exitPrice)
      .then((url) => this.repo.updateEvent(eventId, { chartUrl: url }))
      .catch((e) => this.logger.warn(`chart for ${s.id} failed: ${e instanceof Error ? e.message : e}`));
  }

  private async renderChart(s: SetupRow, exitPrice?: number): Promise<string> {
    const { limit, display } = SETUP_CHART_TF_CONFIG['4h']!;
    const now = Date.now();
    const raw = await this.binance.fetchKlinesInRange({
      symbol: pairOf(s.symbol),
      timeframe: '4h' as AnalysisTimeframe,
      startTime: now - (limit - 1) * H4,
      endTime: now,
      limit,
    });
    const candles: OhlcCandle[] = raw.map((k) => ({
      time: Number(k[0]),
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[5])),
    }));
    const side = s.direction === 'SHORT' ? 'short' : 'long';
    const shown = candles.slice(-display);
    const at = (ms: number | null | undefined) => (ms == null ? -1 : shown.findIndex((c) => c.time === Math.floor(ms / H4) * H4));
    const openIndex = at(s.filledAt?.getTime());
    const closeIndex = at(s.closedAt?.getTime());
    const entry = s.fillPrice ?? s.entryPrice;
    const closed = s.status === 'CLOSED' && s.fillPrice != null;
    const buffer = await renderSetupChart({
      symbol: pairOf(s.symbol),
      timeframe: '4h',
      candles,
      currentPrice: candles[candles.length - 1]!.close,
      display,
      markers: closed
        ? [{ kind: 'closed', holdSide: side, entryPrice: entry, closePrice: exitPrice ?? s.lastPrice ?? entry, pnlUsd: s.realizedPnlUsd ?? 0 }]
        : [{ kind: 'open', holdSide: side, entryPrice: entry }],
      entryMarker: { price: entry, side, ...(openIndex >= 0 ? { index: openIndex } : {}) },
      ...(closed && openIndex >= 0 && closeIndex >= 0 ? { tradeSpan: { openIndex, closeIndex, win: (s.realizedPnlUsd ?? 0) > 0 } } : {}),
    });
    const key = `tracking-charts/${s.id}-${now}.png`;
    const stored = await this.storage.uploadFile({ buffer, mimetype: 'image/png', originalname: `${s.id}.png`, size: buffer.length }, key);
    return stored.url;
  }

  /** Claude compares the plan with what happened; saved on the setup and in the timeline. */
  async writePostMortem(id: string) {
    const s = await this.load(id);
    if (s.status !== 'CLOSED') throw new BadRequestException('Chỉ viết post-mortem cho lệnh đã đóng.');
    const events = (await this.repo.listEvents({ setupId: id })).reverse();
    const targets = s.targets as Target[];
    const hours = s.filledAt && s.closedAt ? round((s.closedAt.getTime() - s.filledAt.getTime()) / 3_600_000, 1) : null;
    const path = ((s.pathR as number[] | null) ?? []).filter((_, i) => i % 4 === 3).map((r) => round(r, 2));
    const prompt = [
      `Lệnh swing paper ${s.direction} ${s.symbol}USDT (${s.orderType}, khung ${s.timeframe}), nguồn: ${s.source === 'CLAUDE' ? 'Claude đề xuất' : 'người dùng tự nhập'}.`,
      `Loại setup: ${s.setupType ?? '(không ghi)'} · Độ tin cậy: ${s.confidence ?? '-'}`,
      `Luận điểm: ${s.thesis ?? '-'}`,
      `Điều kiện kích hoạt: ${s.triggerNote ?? '-'}`,
      `Điều kiện huỷ: ${s.invalidation ?? '-'}`,
      `Kế hoạch: entry ${fmtPx(s.entryPrice)}, SL ${fmtPx(s.stopLoss)}, ${targets.map((t, i) => `TP${i + 1} ${fmtPx(t.price)} (${t.pct}%)${t.hitAt ? ' ✓' : ''}`).join(', ')}`,
      `Kết quả: khớp ${s.fillPrice != null ? fmtPx(s.fillPrice) : '-'}, đóng (${s.closeReason}), ${round(s.rMultiple ?? 0)}R, giữ ${hours ?? '-'} giờ.`,
      `MFE ${s.mfeR ?? '-'}R · MAE ${s.maeR ?? '-'}R. Can thiệp tay: ${s.manualIntervention ? 'có' : 'không'}.`,
      `R tại mỗi 4 giờ sau khi khớp: ${path.join(', ') || '-'}`,
      '',
      'Dòng thời gian:',
      ...events.filter((e) => e.type !== 'POSTMORTEM').map((e) => `- ${e.createdAt.toISOString().slice(0, 16)} ${e.type}: ${e.message.slice(0, 400)}`),
    ].join('\n');
    const system =
      'Bạn là coach giao dịch swing, viết post-mortem ngắn gọn bằng tiếng Việt cho một lệnh paper đã đóng. ' +
      'So kế hoạch với diễn biến thực tế, dựa trên số liệu được cho, không bịa thêm dữ liệu. Markdown với các mục: ' +
      '**Tóm tắt** (1–2 câu), **Kế hoạch vs thực tế**, **Điều làm đúng**, **Điều sai / thiếu** (entry, SL, TP, thời điểm), ' +
      '**Can thiệp tay** (nếu có: giúp hay hại, ước lượng bằng R), **Bài học** (1–3 gạch đầu dòng, cụ thể, áp dụng được). Tối đa ~250 từ.';
    const { reply } = await this.claude.chat([
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ]);
    const updated = await this.repo.update(id, { postMortem: reply, postMortemAt: new Date() });
    await this.repo.addEvent({ symbol: s.symbol, setupId: id, type: 'POSTMORTEM', message: reply });
    return { setup: this.present(updated), postMortem: reply };
  }

  // ---------------- lessons ----------------

  /** Once enough closed setups have no batch yet, Claude drafts the next lesson batch. */
  async maybeDraftLessons(force = false) {
    const batches = await this.repo.listLessonBatches();
    if (batches.some((b) => b.status === 'DRAFT')) {
      if (force) throw new BadRequestException('Đang có bản nháp bài học chờ duyệt.');
      return null;
    }
    const pool = (await this.repo.listClosed()).filter((s) => !s.lessonBatchId);
    if (pool.length < LESSON_BATCH_SIZE) {
      if (force) throw new BadRequestException(`Cần ${LESSON_BATCH_SIZE} lệnh đóng chưa tổng hợp, hiện có ${pool.length}.`);
      return null;
    }
    const trades = pool.slice(0, LESSON_BATCH_SIZE);
    const stats = this.stats(trades);
    const lines = trades.map(
      (t, i) =>
        `#${i + 1} ${t.symbol} ${t.direction} ${t.setupType ?? '-'} | ${t.source} | ${round(t.rMultiple ?? 0)}R ${t.closeReason}` +
        ` | MFE ${t.mfeR ?? '-'} MAE ${t.maeR ?? '-'}${t.manualIntervention ? ' | can thiệp tay' : ''}` +
        `${t.rating != null ? ` | tự chấm ${t.rating}/5` : ''}${t.reviewNote ? ` | ghi chú: ${t.reviewNote.slice(0, 200)}` : ''}` +
        `${t.postMortem ? `\n  Post-mortem: ${t.postMortem.replace(/\s+/g, ' ').slice(0, 700)}` : ''}`,
    );
    const system =
      'Bạn tổng hợp bài học từ một đợt lệnh swing paper đã đóng để cải thiện các lần phân tích sau. Tiếng Việt, markdown. ' +
      'Chỉ rút ra quy tắc có bằng chứng từ dữ liệu (nêu số lệnh / R làm căn cứ). Các mục: **Tổng quan đợt**, ' +
      '**Setup hiệu quả / kém hiệu quả**, **Sai lầm lặp lại**, **Quản lý lệnh & can thiệp tay**, ' +
      '**Quy tắc cho lần phân tích sau** (5–10 gạch đầu dòng ngắn, dạng mệnh lệnh). Tối đa ~600 từ.';
    const { reply } = await this.claude.chat([
      { role: 'system', content: system },
      { role: 'user', content: `Thống kê: ${JSON.stringify(stats)}\n\nTừng lệnh:\n${lines.join('\n')}` },
    ]);
    const batch = await this.repo.createLessonBatch({ tradeCount: trades.length, tradeIds: trades.map((t) => t.id), stats, draft: reply });
    await this.repo.assignLessonBatch(trades.map((t) => t.id), batch.id);
    this.logger.log(`lesson batch ${batch.id} drafted from ${trades.length} setups`);
    return batch;
  }

  async saveLessons(id: string, content: string, approve: boolean) {
    const b = await this.repo.findLessonBatch(id);
    if (!b) throw new NotFoundException('Đợt bài học không tồn tại');
    if (!content?.trim()) throw new BadRequestException('Nội dung trống.');
    return this.repo.updateLessonBatch(id, {
      content: content.trim(),
      ...(approve ? { status: 'APPROVED', approvedAt: new Date() } : {}),
    });
  }

  /** Active setups per coin, for the watchlist table and the chat skills. */
  async activeByCoin() {
    const rows = await this.repo.list({ statuses: TRACKING_ACTIVE_STATUSES }, 1000);
    const map: Record<string, Array<{ id: string; status: string; direction: string }>> = {};
    for (const r of rows) (map[r.symbol] ??= []).push({ id: r.id, status: r.status, direction: r.direction });
    return map;
  }
}
