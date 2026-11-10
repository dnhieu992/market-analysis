import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createChartSampleRepository } from '@app/db';

import type { ChatImage } from '../chat/providers/claude-chat.provider';
import { StorageService } from '../storage/storage.service';
import {
  HORIZONS,
  computeFeatures,
  computeOutcome,
  defaultTpSl,
  distance,
  fetchKlines,
  normalizeInterval,
  normalizeSymbol,
  sideView,
  similarityPct,
  type ChartFeatures,
  type ChartOutcome,
} from './chart-lab.engine';

type Row = NonNullable<Awaited<ReturnType<ReturnType<typeof createChartSampleRepository>['findById']>>>;
type Direction = 'LONG' | 'SHORT' | 'NONE';

export type ChartImageRef = { url: string; key: string | null };
export type TradeResult = 'TP' | 'SL';

export type ChartSampleView = {
  id: string;
  imageUrl: string | null;
  images: ChartImageRef[];
  /** Entry zone as the user typed it; entryPrice (lower / single) – entryPriceTo (upper) are parsed from it. */
  entryZone: string | null;
  entryPriceTo: number | null;
  /** The user's own record of how the trade closed. */
  result: TradeResult | null;
  closedAt: string | null;
  symbol: string | null;
  interval: string | null;
  chartTime: string | null;
  direction: Direction | null;
  /** The user's entry / TP / SL prices as typed (null = not given). */
  entryPrice: number | null;
  tpPrice: number | null;
  slPrice: number | null;
  /** What the scoring uses: entry = user's price or the candle close; TP/SL % from the user's prices or defaults. */
  levels: { entry: number; tpPct: number; slPct: number; tpFromUser: boolean; slFromUser: boolean } | null;
  note: string | null;
  tags: string[];
  features: ChartFeatures | null;
  outcome: ChartOutcome | null;
  outcomeStatus: string;
  outcomeError: string | null;
  side: ReturnType<typeof sideView>;
  conversationId: string | null;
  aiSummary: string | null;
  analyzedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChartSampleInput = Partial<{
  symbol: string | null;
  interval: string | null;
  chartTime: string | null;
  direction: Direction | null;
  entryPrice: number | null;
  tpPrice: number | null;
  slPrice: number | null;
  note: string | null;
  tags: string[];
  entryPriceTo: number | null;
  entryZone: string | null;
  result: TradeResult | null;
  closedAt: string | null;
  images: ChartImageRef[];
}>;

type StatRow = {
  key: string;
  n: number;
  tp: number;
  sl: number;
  open: number;
  tpWinRate: number | null;
  n24: number;
  win24: number;
  winRate24: number | null;
  avgRet24: number | null;
  avgFav24: number | null;
  avgAdv24: number | null;
};

const toTags = (x: unknown): string[] =>
  Array.isArray(x)
    ? Array.from(
        new Set(
          x
            .map((t) => String(t).trim().toLowerCase().replace(/\s+/g, '-').replace(/^#/, ''))
            .filter((t) => t && t.length <= 40),
        ),
      ).slice(0, 12)
    : [];
const price = (x: number | null | undefined) => (x != null && Number.isFinite(x) && x > 0 ? x : null);
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmtTime = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—');
const shortId = (id: string) => id.slice(-6);
/** Prices written in an entry-zone text: "150-152" → [150, 152], "1,234.5 / 1,200" → [1234.5, 1200]. */
const zonePrices = (zone: string | null): number[] =>
  (zone ?? '')
    .replace(/(\d),(?=\d{3}(\D|$))/g, '$1')
    .match(/\d+(?:[.,]\d+)?/g)
    ?.map((x) => Number(x.replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 6) ?? [];
/** All screenshots of a row (older rows only have imageUrl). */
const imagesOf = (r: Pick<Row, 'images' | 'imageUrl' | 'imageKey'>): ChartImageRef[] =>
  Array.isArray(r.images) ? (r.images as ChartImageRef[]) : r.imageUrl ? [{ url: r.imageUrl, key: r.imageKey }] : [];

/** Entry / TP% / SL% used to score a chart. */
function levelsOf(r: Pick<Row, 'entryPrice' | 'tpPrice' | 'slPrice' | 'interval' | 'features'>): ChartSampleView['levels'] {
  const entry = r.entryPrice ?? (r.features as ChartFeatures | null)?.close ?? null;
  if (!entry) return null;
  const d = defaultTpSl(r.interval);
  return {
    entry,
    tpPct: r.tpPrice ? r2((Math.abs(r.tpPrice - entry) / entry) * 100) || d.tpPct : d.tpPct,
    slPct: r.slPrice ? r2((Math.abs(r.slPrice - entry) / entry) * 100) || d.slPct : d.slPct,
    tpFromUser: Boolean(r.tpPrice),
    slFromUser: Boolean(r.slPrice),
  };
}

/**
 * /chart-lab: the user's chart library. A chart is saved exactly as the user typed it (no AI); the server
 * pins it to its Binance candle, fingerprints the market and scores what happened next. Claude only runs
 * when the user clicks Analyze (see ChartLabAnalyzeController) — buildChatContext feeds that chat.
 */
@Injectable()
export class ChartLabService {
  private readonly logger = new Logger(ChartLabService.name);
  private readonly repo = createChartSampleRepository();
  private refreshing = false;

  constructor(private readonly storage: StorageService) {}

  // ── CRUD ────────────────────────────────────────────────────────────────

  async list(): Promise<ChartSampleView[]> {
    return (await this.repo.list()).map((r) => this.view(r));
  }

  async get(id: string): Promise<ChartSampleView> {
    return this.view(await this.row(id));
  }

  /** Save a chart with the user's analysis. No Claude — Binance data only (~1–2 s). */
  async create(input: ChartSampleInput): Promise<ChartSampleView> {
    const fields = await this.parse(input, null);
    const row = await this.repo.create(fields);
    await this.recompute(row.id, { features: true });
    return this.get(row.id);
  }

  async update(id: string, input: ChartSampleInput): Promise<ChartSampleView> {
    const cur = await this.row(id);
    const fields = await this.parse(input, cur);
    if (fields.images !== undefined) {
      const keep = new Set(((fields.images as unknown as ChartImageRef[] | null) ?? []).map((i) => i.url));
      for (const old of imagesOf(cur)) if (old.key && !keep.has(old.url)) await this.storage.deleteByKey(old.key).catch(() => {});
    }
    const repin = ['symbol', 'interval', 'chartTime'].some((k) => k in fields);
    await this.repo.update(id, fields);
    if (repin || 'entryPrice' in fields || 'tpPrice' in fields || 'slPrice' in fields) await this.recompute(id, { features: repin });
    return this.get(id);
  }

  async remove(id: string) {
    const r = await this.row(id);
    await this.repo.remove(id);
    for (const img of imagesOf(r)) if (img.key) await this.storage.deleteByKey(img.key).catch(() => {});
    return { ok: true };
  }

  async setConversation(id: string, conversationId: string) {
    await this.repo.update(id, { conversationId });
  }

  /** Claude's answer to an Analyze click. */
  async saveAnalysis(id: string, text: string) {
    await this.repo.update(id, { aiSummary: text.slice(0, 60000), analyzedAt: new Date() });
  }

  async tags(): Promise<Array<{ tag: string; n: number }>> {
    const counts = new Map<string, number>();
    for (const r of await this.repo.list()) for (const t of toTags(r.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return Array.from(counts, ([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  }

  /** Validate + normalize the typed fields; pins the chart to the Binance candle containing its time. */
  private async parse(input: ChartSampleInput, cur: Row | null): Promise<Parameters<typeof this.repo.update>[1]> {
    const out: Parameters<typeof this.repo.update>[1] = {};
    if (input.direction !== undefined) {
      if (input.direction !== null && !['LONG', 'SHORT', 'NONE'].includes(input.direction)) throw new BadRequestException('Hướng phải là LONG | SHORT | NONE');
      out.direction = input.direction;
    }
    if (input.note !== undefined) out.note = input.note?.trim().slice(0, 10000) || null;
    if (input.tags !== undefined) out.tags = toTags(input.tags);
    if (input.entryPrice !== undefined) out.entryPrice = price(input.entryPrice);
    if (input.tpPrice !== undefined) out.tpPrice = price(input.tpPrice);
    if (input.slPrice !== undefined) out.slPrice = price(input.slPrice);
    if (input.entryPriceTo !== undefined) out.entryPriceTo = price(input.entryPriceTo);
    if (input.entryZone !== undefined) {
      const zone = input.entryZone?.trim().slice(0, 120) || null;
      out.entryZone = zone;
      // Numbers in the zone text drive the scoring: lowest = entryPrice, highest = entryPriceTo.
      if (input.entryPrice === undefined) {
        const nums = zonePrices(zone);
        out.entryPrice = nums.length ? Math.min(...nums) : null;
        out.entryPriceTo = nums.length > 1 ? Math.max(...nums) : null;
      }
    }
    if (input.result !== undefined) {
      if (input.result !== null && !['TP', 'SL'].includes(input.result)) throw new BadRequestException('Kết quả phải là TP | SL');
      out.result = input.result;
    }
    if (input.closedAt !== undefined) {
      const t = input.closedAt ? new Date(input.closedAt) : null;
      if (t && Number.isNaN(t.getTime())) throw new BadRequestException('Ngày đóng lệnh không hợp lệ');
      out.closedAt = t;
    }
    if (input.images !== undefined) {
      if (!Array.isArray(input.images) || input.images.length > 10) throw new BadRequestException('Tối đa 10 ảnh');
      const imgs = input.images.map((i) => ({ url: String(i?.url ?? ''), key: i?.key ? String(i.key).slice(0, 300) : null }));
      imgs.forEach((i) => this.assertOwnImage(i.url));
      out.images = imgs;
      out.imageUrl = imgs[0]?.url ?? null;
      out.imageKey = imgs[0]?.key ?? null;
    }

    let symbol = cur?.symbol ?? null;
    let interval = cur?.interval ?? null;
    let time: Date | null = cur?.chartTime ?? null;
    let changed = !cur;
    if (input.symbol !== undefined) {
      const s = normalizeSymbol(input.symbol);
      if (input.symbol && !s) throw new BadRequestException('Coin không hợp lệ');
      changed ||= s !== symbol;
      symbol = s;
    }
    if (input.interval !== undefined) {
      const i = normalizeInterval(input.interval);
      if (input.interval && !i) throw new BadRequestException('Khung thời gian không hợp lệ (vd 15m, 1h, 4h, 1d)');
      changed ||= i !== interval;
      interval = i;
    }
    if (input.chartTime !== undefined) {
      const t = input.chartTime ? new Date(input.chartTime) : null;
      if (t && Number.isNaN(t.getTime())) throw new BadRequestException('Thời điểm không hợp lệ');
      changed ||= (t?.getTime() ?? null) !== (time?.getTime() ?? null);
      time = t;
    }
    if (!changed) return out;
    out.symbol = symbol;
    out.interval = interval;
    // No timeframe = a journal entry: keep the open date exactly as typed.
    out.chartTime = interval ? null : time;
    if (symbol && interval) {
      // The candle that contains the time (no time = the latest closed candle, i.e. a chart taken now).
      const ks = await fetchKlines(symbol, interval, time ? { endTime: time.getTime(), limit: 1 } : { limit: 2 });
      const k = ks[ks.length - 1];
      if (!k) throw new BadRequestException(`Không có nến ${symbol} ${interval}${time ? ' tại thời điểm đó' : ''} trên Binance`);
      out.chartTime = new Date(k.t);
    }
    return out;
  }

  // ── Similar charts + stats ────────────────────────────────────────────────

  async similar(id: string, limit = 5): Promise<Array<{ sample: ChartSampleView; similarity: number }>> {
    const all = await this.repo.list();
    const me = all.find((r) => r.id === id);
    if (!me) throw new NotFoundException('Không tìm thấy chart');
    const mine = { id: me.id, features: me.features as ChartFeatures | null, tags: toTags(me.tags), interval: me.interval };
    return all
      .filter((r) => r.id !== id)
      .map((r) => ({ r, d: distance(mine, { id: r.id, features: r.features as ChartFeatures | null, tags: toTags(r.tags), interval: r.interval }) }))
      .filter((x): x is { r: Row; d: number } => x.d != null)
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.min(Math.max(limit, 1), 20))
      .map(({ r, d }) => ({ sample: this.view(r), similarity: similarityPct(d) }));
  }

  /** Win rates of the user's LONG/SHORT calls: overall, per direction, per tag. */
  async stats(excludeId?: string): Promise<{ overall: StatRow; byDirection: StatRow[]; byTag: StatRow[]; total: number; labeled: number; pending: number }> {
    const rows = (await this.repo.list()).filter((r) => r.id !== excludeId).map((r) => this.view(r));
    const labeled = rows.filter((r) => r.direction === 'LONG' || r.direction === 'SHORT');
    const agg = (key: string, list: ChartSampleView[]): StatRow => {
      const sides = list.map((r) => r.side).filter((s): s is NonNullable<typeof s> => s != null);
      const tp = sides.filter((s) => s.tpSl.result === 'TP').length;
      const sl = sides.filter((s) => s.tpSl.result === 'SL').length;
      const h24 = sides.map((s) => s.h24).filter((h): h is NonNullable<typeof h> => h != null);
      const avg = (xs: number[]) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
      const win24 = h24.filter((h) => h.retPct > 0).length;
      return {
        key,
        n: list.length,
        tp,
        sl,
        open: sides.filter((s) => s.tpSl.result === 'OPEN').length,
        tpWinRate: tp + sl ? Math.round((tp / (tp + sl)) * 100) : null,
        n24: h24.length,
        win24,
        winRate24: h24.length ? Math.round((win24 / h24.length) * 100) : null,
        avgRet24: avg(h24.map((h) => h.retPct)),
        avgFav24: avg(h24.map((h) => h.favPct)),
        avgAdv24: avg(h24.map((h) => h.advPct)),
      };
    };
    const tagSet = new Set(labeled.flatMap((r) => r.tags));
    return {
      total: rows.length,
      labeled: labeled.length,
      pending: rows.filter((r) => r.outcomeStatus === 'PENDING').length,
      overall: agg('Tất cả', labeled),
      byDirection: (['LONG', 'SHORT'] as const).map((d) => agg(d, labeled.filter((r) => r.direction === d))),
      byTag: Array.from(tagSet)
        .map((t) => agg(t, labeled.filter((r) => r.tags.includes(t))))
        .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)),
    };
  }

  // ── Outcome refresh ─────────────────────────────────────────────────────

  /** Charts whose result is still being written: re-score as new candles close. */
  @Cron('*/10 * * * *')
  async refreshPending(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      for (const r of await this.repo.listPending(50)) {
        await this.recompute(r.id, { features: !r.features }).catch((e) => this.logger.warn(`chart ${r.id}: ${(e as Error).message}`));
      }
    } finally {
      this.refreshing = false;
    }
  }

  private async recompute(id: string, opts: { features: boolean }) {
    const r = await this.row(id);
    if (!r.symbol || !r.interval || !r.chartTime) {
      await this.repo.update(id, {
        features: null,
        outcome: null,
        outcomeStatus: 'ERROR',
        outcomeError: 'Chưa đủ coin và khung giờ nên chưa lấy được dữ liệu giá Binance để chấm kết quả',
      });
      return;
    }
    try {
      const features = opts.features || !r.features ? await computeFeatures(r.symbol, r.interval, r.chartTime) : (r.features as ChartFeatures);
      const lv = levelsOf({ ...r, features: features as never });
      if (!lv) throw new Error('Không xác định được giá vào');
      const { outcome, done } = await computeOutcome(r.symbol, r.interval, r.chartTime, lv.entry, lv.tpPct, lv.slPct);
      await this.repo.update(id, { features: features as never, outcome: outcome as never, outcomeStatus: done ? 'DONE' : 'PENDING', outcomeError: null });
    } catch (e) {
      await this.repo.update(id, { outcomeStatus: 'ERROR', outcomeError: (e as Error).message });
    }
  }

  // ── Analyze (Claude) ────────────────────────────────────────────────────

  /**
   * Context of the Analyze chat for one chart: the user's analysis, the real outcome so far, the most
   * similar library charts (images + labels + outcomes) and the user's win rates on the other charts.
   * Image 1 = this chart, then the similar ones in order.
   */
  async buildChatContext(sampleId: string | undefined): Promise<{ text: string; images: ChatImage[] }> {
    if (!sampleId) return { text: 'Không có chart nào gắn với cuộc trò chuyện này.', images: [] };
    const me = await this.get(sampleId);
    const [similar, stats] = await Promise.all([this.similar(sampleId, 8), this.stats(sampleId)]);
    // Prefer neighbours whose result is known — that is what the user wants to learn from.
    const withResult = similar.filter((s) => s.sample.outcome?.horizons['24']);
    const picked = [...withResult, ...similar.filter((s) => !withResult.includes(s))].slice(0, 4);

    const images: ChatImage[] = [];
    try {
      images.push(await this.fetchImage(me.imageUrl));
    } catch (e) {
      this.logger.warn(`chart image ${me.id}: ${(e as Error).message}`);
    }
    const lines: string[] = [];
    lines.push(`## Chart đang phân tích (#${shortId(me.id)}, sampleId ${me.id})${images.length ? ' — ẢNH 1' : ' — (không tải được ảnh)'}`);
    lines.push(`Coin ${me.symbol ?? '?'} · khung ${me.interval ?? '?'} · nến ${fmtTime(me.chartTime)} · giá đóng nến đó ${me.features?.close ?? '?'}`);
    lines.push('### Phân tích của user');
    lines.push(`- Hướng: ${me.direction ?? 'chưa ghi'}`);
    lines.push(`- Giá vào: ${me.entryZone ? `"${me.entryZone}" → ` : ''}${me.entryPrice ?? 'không ghi (dùng giá đóng nến)'}${me.entryPriceTo ? ` – ${me.entryPriceTo} (vùng)` : ''} · TP: ${me.tpPrice ?? 'không ghi'} · SL: ${me.slPrice ?? 'không ghi'}`);
    if (me.levels) lines.push(`- Dùng để chấm: vào ${me.levels.entry}, TP ${me.levels.tpPct}%${me.levels.tpFromUser ? '' : ' (mặc định)'}, SL ${me.levels.slPct}%${me.levels.slFromUser ? '' : ' (mặc định)'}`);
    if (me.tags.length) lines.push(`- Tag: ${me.tags.join(', ')}`);
    if (me.result || me.closedAt) lines.push(`- User ghi kết quả: ${me.result ?? '—'}${me.closedAt ? ` · đóng lệnh ${fmtTime(me.closedAt)}` : ''}`);
    lines.push(`- Nhận xét: ${me.note ?? '(không có)'}`);
    if (me.features) lines.push(`Chỉ số lúc đó (server tính từ Binance): ${featureLine(me.features)}`);
    lines.push(`### Kết quả thật đến hiện tại`);
    lines.push(me.outcomeStatus === 'ERROR' ? `Chưa chấm được: ${me.outcomeError}` : outcomeLine(me.outcome));
    if (me.side) lines.push(`→ Theo TP/SL của user: ${me.side.tpSl.result === 'TP' ? 'chạm TP trước (ĐÚNG)' : me.side.tpSl.result === 'SL' ? 'chạm SL trước (SAI)' : 'chưa chạm TP/SL'}`);
    if (me.outcomeStatus === 'PENDING') lines.push('(Còn đang cập nhật: chart mới, chưa đủ nến sau đó.)');

    lines.push('', `## Chart cũ giống nhất trong thư viện (${picked.length}/${stats.total} chart khác)`);
    if (!picked.length) lines.push('Thư viện chưa có chart nào khác có dữ liệu giá — phân tích chỉ dựa trên chart này.');
    for (const [i, s] of picked.entries()) {
      let imgNo: number | null = null;
      try {
        images.push(await this.fetchImage(s.sample.imageUrl));
        imgNo = images.length;
      } catch {
        /* text only */
      }
      lines.push(sampleBlock(s.sample, `${i + 1}. #${shortId(s.sample.id)} — giống ${s.similarity}%${imgNo ? ` — ẢNH ${imgNo}` : ''}`));
    }

    lines.push('', `## Thống kê nhận định của user trên các chart KHÁC (${stats.labeled} chart có hướng LONG/SHORT, ${stats.pending} đang chờ kết quả)`);
    lines.push(statLine(stats.overall));
    for (const d of stats.byDirection) lines.push(statLine(d));
    const relevant = stats.byTag.filter((t) => me.tags.includes(t.key));
    if (relevant.length) {
      lines.push('Tag của chart này:');
      for (const t of relevant) lines.push(statLine(t));
    }
    return { text: lines.join('\n'), images };
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async row(id: string): Promise<Row> {
    const r = await this.repo.findById(id);
    if (!r) throw new NotFoundException('Không tìm thấy chart');
    return r;
  }

  /** Only images we stored ourselves (R2 public bucket) — never fetch arbitrary URLs server-side. */
  private assertOwnImage(url: string) {
    const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '');
    if (!base || !url.startsWith(`${base}/`)) throw new BadRequestException('Ảnh phải được upload qua app (R2)');
  }

  async fetchImage(url: string | null): Promise<ChatImage> {
    if (!url) throw new Error('Chart không có ảnh');
    this.assertOwnImage(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Không tải được ảnh (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type')?.split(';')[0] ?? 'image/png';
    return { data: buf.toString('base64'), mimeType: type.startsWith('image/') ? type : 'image/png' };
  }

  view(r: Row): ChartSampleView {
    const outcome = (r.outcome as ChartOutcome | null) ?? null;
    return {
      id: r.id,
      imageUrl: r.imageUrl,
      images: imagesOf(r),
      entryZone: r.entryZone,
      entryPriceTo: r.entryPriceTo,
      result: (r.result as TradeResult | null) ?? null,
      closedAt: r.closedAt?.toISOString() ?? null,
      symbol: r.symbol,
      interval: r.interval,
      chartTime: r.chartTime?.toISOString() ?? null,
      direction: (r.direction as Direction | null) ?? null,
      entryPrice: r.entryPrice,
      tpPrice: r.tpPrice,
      slPrice: r.slPrice,
      levels: levelsOf(r),
      note: r.note,
      tags: toTags(r.tags),
      features: (r.features as ChartFeatures | null) ?? null,
      outcome,
      outcomeStatus: r.outcomeStatus,
      outcomeError: r.outcomeError,
      side: sideView(outcome, r.direction),
      conversationId: r.conversationId,
      aiSummary: r.aiSummary,
      analyzedAt: r.analyzedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}

export function featureLine(f: ChartFeatures): string {
  return [
    `RSI14 ${f.rsi14}`,
    `vs EMA20 ${f.distEma20}% / EMA50 ${f.distEma50}% / EMA200 ${f.distEma200}%`,
    `EMA20 dốc ${f.ema20Slope}%/5 nến`,
    `thay đổi 5/20/50 nến ${f.ret5}% / ${f.ret20}% / ${f.ret50}%`,
    `vị trí trong BB ${f.bbPos} (0=dải dưới, 1=dải trên), BB rộng ${f.bbWidth}%`,
    `vị trí trong biên 50 nến ${f.rangePos50}`,
    `volume ×${f.volRatio} TB20`,
    `ATR ${f.atrPct}%`,
  ].join(' · ');
}

export function outcomeLine(o: ChartOutcome | null): string {
  if (!o) return 'chưa có kết quả';
  const hs = HORIZONS.map((h) => {
    const x = o.horizons[h];
    return x ? `sau ${h} nến ${x.retPct > 0 ? '+' : ''}${x.retPct}% (cao nhất +${x.maxUpPct}%, thấp nhất ${x.maxDownPct}%)` : `sau ${h} nến: chưa đủ nến`;
  });
  const ts = (side: string, r: ChartOutcome['long']) => `${side} ${r.result === 'OPEN' ? 'chưa chạm TP/SL' : `chạm ${r.result} sau ${r.bars} nến`}`;
  return `giá vào ${o.entry} · ${hs.join('; ')} · TP ${o.tpPct}%/SL ${o.slPct}%: ${ts('LONG', o.long)}, ${ts('SHORT', o.short)}`;
}

function sampleBlock(s: ChartSampleView, title: string): string {
  const out = [
    `${title}`,
    `   ${s.symbol ?? '?'} ${s.interval ?? '?'} · nến ${fmtTime(s.chartTime)} · user: ${s.direction ?? 'chưa ghi hướng'}${s.tags.length ? ` · tag: ${s.tags.join(', ')}` : ''}`,
  ];
  if (s.note) out.push(`   Nhận xét của user: ${s.note.slice(0, 400)}`);
  if (s.features) out.push(`   Chỉ số: ${featureLine(s.features)}`);
  out.push(`   Kết quả thật: ${outcomeLine(s.outcome)}`);
  if (s.side) out.push(`   → Nhận định của user ${s.side.tpSl.result === 'TP' ? 'ĐÚNG (chạm TP trước)' : s.side.tpSl.result === 'SL' ? 'SAI (chạm SL trước)' : 'chưa ngã ngũ'}`);
  return out.join('\n');
}

function statLine(s: StatRow): string {
  if (!s.n) return `- ${s.key}: chưa có mẫu`;
  return `- ${s.key}: ${s.n} mẫu · TP trước SL ${s.tpWinRate ?? '—'}% (${s.tp}/${s.tp + s.sl}, ${s.open} chưa ngã ngũ) · đúng hướng sau 24 nến ${s.winRate24 ?? '—'}% (n=${s.n24}), TB ${s.avgRet24 ?? '—'}%`;
}
