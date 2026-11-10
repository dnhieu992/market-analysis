import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createChartSampleRepository } from '@app/db';

import { ClaudeChatProvider, type ChatImage } from '../chat/providers/claude-chat.provider';
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
  resolveChartCandle,
  sideView,
  similarityPct,
  type ChartFeatures,
  type ChartOutcome,
} from './chart-lab.engine';

type Row = NonNullable<Awaited<ReturnType<ReturnType<typeof createChartSampleRepository>['findById']>>>;

export type ChartAiRead = {
  symbol: string | null;
  interval: string | null;
  exchange: string | null;
  lastClose: number | null;
  approxLastTime: string | null;
  bias: 'LONG' | 'SHORT' | 'NONE' | null;
  suggestedTags: string[];
  description: string;
  pinNote?: string;
  pinWarning?: string;
  error?: string;
};

export type ChartSampleView = {
  id: string;
  imageUrl: string;
  symbol: string | null;
  interval: string | null;
  chartTime: string | null;
  entryPrice: number | null;
  direction: 'LONG' | 'SHORT' | 'NONE' | null;
  tpPct: number | null;
  slPct: number | null;
  note: string | null;
  tags: string[];
  aiRead: ChartAiRead | null;
  features: ChartFeatures | null;
  outcome: ChartOutcome | null;
  outcomeStatus: string;
  outcomeError: string | null;
  side: ReturnType<typeof sideView>;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateChartSampleInput = Partial<{
  symbol: string | null;
  interval: string | null;
  chartTime: string | null;
  direction: 'LONG' | 'SHORT' | 'NONE' | null;
  tpPct: number | null;
  slPct: number | null;
  note: string | null;
  tags: string[];
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

const READ_SYSTEM = `Bạn đọc ảnh chụp chart giá crypto (TradingView, Binance, OKX, Bitget…). Trả về DUY NHẤT một object JSON, không markdown:
{
  "symbol": "cặp giao dịch như trên chart, vd BTCUSDT, ETH/USDT, SOLUSDT.P — null nếu không thấy",
  "interval": "khung thời gian của chart, vd 15m, 1h, 4h, 1D — null nếu không thấy",
  "exchange": "sàn nếu thấy, không thì null",
  "lastClose": số — giá đóng cửa của cây nến CUỐI CÙNG bên phải (đọc nhãn giá hiện tại trên trục giá hoặc OHLC ở góc trên), null nếu không đọc được,
  "approxLastTime": "thời điểm (ISO 8601, giờ UTC nếu chart ghi UTC; nếu chart theo giờ VN thì ghi kèm +07:00) của cây nến cuối, suy ra từ nhãn trục thời gian / OHLC / ngày giờ hiển thị; nếu chỉ thấy ngày/tháng thì đoán năm gần nhất không vượt quá hôm nay; null nếu không suy ra được",
  "bias": "LONG | SHORT | NONE — thiên hướng setup trên chart theo bạn (kể cả các nét vẽ / ghi chú của người dùng)",
  "suggestedTags": ["2–5 tag ngắn mô tả SETUP, chữ thường, nối bằng gạch ngang, dùng thuật ngữ TA tiếng Anh phổ biến — ưu tiên dùng lại tag đã có nếu đúng nghĩa"],
  "description": "3–6 câu tiếng Việt: cấu trúc giá, vùng hỗ trợ/kháng cự, chỉ báo nhìn thấy (EMA, RSI, volume…), nét vẽ/ghi chú của người dùng"
}`;

const asNum = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() && Number.isFinite(+x.replace(/,/g, '')) ? +x.replace(/,/g, '') : null);
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

function parseJson(text: string): Record<string, unknown> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude không trả JSON');
  return JSON.parse(m[0]) as Record<string, unknown>;
}

const fmtTime = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—');
const shortId = (id: string) => id.slice(-6);

/**
 * /chart-lab: the user's library of chart screenshots. Each upload is read by Claude, pinned to its
 * Binance candle, fingerprinted and — as candles close — scored. The library feeds the analysis chat
 * (similar past charts + their real outcomes) and the per-tag win-rate table.
 */
@Injectable()
export class ChartLabService {
  private readonly logger = new Logger(ChartLabService.name);
  private readonly repo = createChartSampleRepository();
  private refreshing = false;

  constructor(
    private readonly claude: ClaudeChatProvider,
    private readonly storage: StorageService,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────────────

  async list(): Promise<ChartSampleView[]> {
    return (await this.repo.list()).map((r) => this.view(r));
  }

  async get(id: string): Promise<ChartSampleView> {
    return this.view(await this.row(id));
  }

  /** New chart: save it, let Claude read it, pin it to its candle, fingerprint + score it. ~10–20 s. */
  async create(imageUrl: string, imageKey?: string | null): Promise<ChartSampleView> {
    this.assertOwnImage(imageUrl);
    const row = await this.repo.create({ imageUrl, imageKey: imageKey ?? null });
    let read: ChartAiRead;
    try {
      read = await this.readImage(imageUrl);
    } catch (e) {
      read = { symbol: null, interval: null, exchange: null, lastClose: null, approxLastTime: null, bias: null, suggestedTags: [], description: '', error: (e as Error).message };
    }
    const symbol = normalizeSymbol(read.symbol);
    const interval = normalizeInterval(read.interval);
    let chartTime: Date | null = null;
    let entryPrice: number | null = null;
    if (symbol && interval) {
      try {
        const approx = read.approxLastTime ? new Date(read.approxLastTime) : null;
        const { candle, note } = await resolveChartCandle(symbol, interval, approx && !Number.isNaN(approx.getTime()) ? approx : null, read.lastClose);
        chartTime = new Date(candle.t);
        entryPrice = candle.c;
        read.pinNote = note;
        // The chart's price vs the pinned candle: far apart = wrong candle (old chart without a time axis).
        if (read.lastClose && Math.abs(candle.c - read.lastClose) / read.lastClose > 0.015) {
          const gap = ((candle.c - read.lastClose) / read.lastClose) * 100;
          read.pinWarning = `Giá trên chart (${read.lastClose}) lệch ${gap > 0 ? '+' : ''}${gap.toFixed(1)}% so với nến đã ghim (${candle.c}). Có thể đây là chart cũ, hãy sửa "Nến cuối" cho đúng.`;
        }
      } catch (e) {
        read.pinNote = (e as Error).message;
      }
    }
    const { tpPct, slPct } = defaultTpSl(interval);
    await this.repo.update(row.id, {
      aiRead: read as never,
      symbol,
      interval,
      chartTime,
      entryPrice,
      tpPct,
      slPct,
      tags: read.suggestedTags,
    });
    await this.recompute(row.id, { features: true });
    return this.get(row.id);
  }

  async update(id: string, input: UpdateChartSampleInput): Promise<ChartSampleView> {
    const cur = await this.row(id);
    const patch: Parameters<typeof this.repo.update>[1] = {};
    if (input.direction !== undefined) {
      if (input.direction !== null && !['LONG', 'SHORT', 'NONE'].includes(input.direction)) throw new BadRequestException('direction phải là LONG | SHORT | NONE');
      patch.direction = input.direction;
    }
    if (input.note !== undefined) patch.note = input.note?.slice(0, 5000) || null;
    if (input.tags !== undefined) patch.tags = toTags(input.tags);
    if (input.tpPct !== undefined) patch.tpPct = input.tpPct && input.tpPct > 0 ? input.tpPct : null;
    if (input.slPct !== undefined) patch.slPct = input.slPct && input.slPct > 0 ? input.slPct : null;

    let repin = false;
    if (input.symbol !== undefined) {
      patch.symbol = normalizeSymbol(input.symbol);
      if (input.symbol && !patch.symbol) throw new BadRequestException('Symbol không hợp lệ');
      repin ||= patch.symbol !== cur.symbol;
    }
    if (input.interval !== undefined) {
      patch.interval = normalizeInterval(input.interval);
      if (input.interval && !patch.interval) throw new BadRequestException('Khung thời gian không hợp lệ (vd 15m, 1h, 4h, 1d)');
      repin ||= patch.interval !== cur.interval;
    }
    if (input.chartTime !== undefined) {
      const t = input.chartTime ? new Date(input.chartTime) : null;
      if (t && Number.isNaN(t.getTime())) throw new BadRequestException('Thời điểm không hợp lệ');
      patch.chartTime = t;
      repin ||= (t?.getTime() ?? null) !== (cur.chartTime?.getTime() ?? null);
    }
    const symbol = patch.symbol !== undefined ? patch.symbol : cur.symbol;
    const interval = patch.interval !== undefined ? patch.interval : cur.interval;
    const chartTime = patch.chartTime !== undefined ? patch.chartTime : cur.chartTime;
    if (repin) {
      patch.entryPrice = null;
      if (symbol && interval && chartTime) {
        // The candle that contains the chosen time.
        const [k] = (await fetchKlines(symbol, interval, { endTime: chartTime.getTime(), limit: 1 })).slice(-1);
        if (!k) throw new BadRequestException(`Không có nến ${symbol} ${interval} tại thời điểm đó`);
        patch.chartTime = new Date(k.t);
        patch.entryPrice = k.c;
        if (cur.aiRead && (cur.aiRead as ChartAiRead).pinWarning) patch.aiRead = { ...(cur.aiRead as ChartAiRead), pinWarning: undefined, pinNote: 'Thời điểm do bạn chỉnh' } as never;
      }
    }
    await this.repo.update(id, patch);
    if (repin || patch.tpPct !== undefined || patch.slPct !== undefined) await this.recompute(id, { features: repin });
    return this.get(id);
  }

  async remove(id: string) {
    const r = await this.row(id);
    await this.repo.remove(id);
    if (r.imageKey) await this.storage.deleteByKey(r.imageKey);
    return { ok: true };
  }

  async setConversation(id: string, conversationId: string) {
    await this.repo.update(id, { conversationId });
  }

  async tags(): Promise<Array<{ tag: string; n: number }>> {
    const counts = new Map<string, number>();
    for (const r of await this.repo.list()) for (const t of toTags(r.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return Array.from(counts, ([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
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
      const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
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
        // Not before the first horizon could have changed.
        await this.recompute(r.id, { features: !r.features }).catch((e) => this.logger.warn(`chart ${r.id}: ${(e as Error).message}`));
      }
    } finally {
      this.refreshing = false;
    }
  }

  private async recompute(id: string, opts: { features: boolean }) {
    const r = await this.row(id);
    if (!r.symbol || !r.interval || !r.chartTime || r.entryPrice == null) {
      await this.repo.update(id, {
        features: null,
        outcome: null,
        outcomeStatus: 'ERROR',
        outcomeError: 'Thiếu coin / khung giờ / thời điểm — sửa trong form để hệ thống lấy dữ liệu giá',
      });
      return;
    }
    try {
      const patch: Parameters<typeof this.repo.update>[1] = {};
      if (opts.features || !r.features) patch.features = (await computeFeatures(r.symbol, r.interval, r.chartTime)) as never;
      const d = defaultTpSl(r.interval);
      const { outcome, done } = await computeOutcome(r.symbol, r.interval, r.chartTime, r.entryPrice, r.tpPct ?? d.tpPct, r.slPct ?? d.slPct);
      patch.outcome = outcome as never;
      patch.outcomeStatus = done ? 'DONE' : 'PENDING';
      patch.outcomeError = null;
      await this.repo.update(id, patch);
    } catch (e) {
      await this.repo.update(id, { outcomeStatus: 'ERROR', outcomeError: (e as Error).message });
    }
  }

  // ── Claude ──────────────────────────────────────────────────────────────

  private async readImage(imageUrl: string): Promise<ChartAiRead> {
    const img = await this.fetchImage(imageUrl);
    const known = (await this.tags()).slice(0, 60).map((t) => t.tag);
    const today = new Date().toISOString().slice(0, 10);
    const text = `Hôm nay: ${today}. Tag đã có trong thư viện: ${known.length ? known.join(', ') : '(chưa có)'}.\nĐọc chart này.`;
    const out = parseJson(await this.claude.askWithImages(READ_SYSTEM, text, [img], { timeoutMs: 120_000 }));
    const bias = String(out.bias ?? '').toUpperCase();
    return {
      symbol: out.symbol ? String(out.symbol) : null,
      interval: out.interval ? String(out.interval) : null,
      exchange: out.exchange ? String(out.exchange) : null,
      lastClose: asNum(out.lastClose),
      approxLastTime: out.approxLastTime ? String(out.approxLastTime) : null,
      bias: bias === 'LONG' || bias === 'SHORT' || bias === 'NONE' ? bias : null,
      suggestedTags: toTags(out.suggestedTags),
      description: String(out.description ?? '').slice(0, 3000),
    };
  }

  /**
   * Context of the analysis chat for one chart: its data + the most similar labeled charts with their
   * real outcomes + the win rates of its tags. Image 1 = this chart, then the similar ones in order.
   * This chart's own outcome is left out on purpose (no spoiler) — the chat has a tool for it.
   */
  async buildChatContext(sampleId: string | undefined): Promise<{ text: string; images: ChatImage[] }> {
    if (!sampleId) return { text: 'Không có chart nào gắn với cuộc trò chuyện này.', images: [] };
    const me = await this.get(sampleId);
    // Stats without this chart — its own result must not leak into the analysis.
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
    lines.push(`Coin ${me.symbol ?? '?'} · khung ${me.interval ?? '?'} · nến cuối ${fmtTime(me.chartTime)} · giá đóng nến cuối ${me.entryPrice ?? '?'}`);
    if (me.direction) lines.push(`Nhận định user đã gắn: ${me.direction}`);
    if (me.tags.length) lines.push(`Tag: ${me.tags.join(', ')}`);
    if (me.note) lines.push(`Ghi chú của user: ${me.note}`);
    if (me.aiRead?.description) lines.push(`Lần đọc ảnh đầu tiên: ${me.aiRead.description}`);
    if (me.features) lines.push(`Chỉ số lúc đó: ${featureLine(me.features)}`);
    lines.push(`TP/SL dùng để chấm: +${me.tpPct ?? '?'}% / −${me.slPct ?? '?'}%`);

    lines.push('', `## Chart cũ giống nhất trong thư viện (${picked.length}/${stats.total} chart khác)`);
    if (!picked.length) lines.push('Thư viện chưa có chart nào khác có dữ liệu giá — phân tích chỉ dựa trên ảnh này.');
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

    lines.push('', `## Thống kê nhận định của user trên các chart KHÁC (${stats.labeled} chart đã gắn LONG/SHORT, ${stats.pending} chart đang chờ kết quả)`);
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

  private async fetchImage(url: string): Promise<ChatImage> {
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
      symbol: r.symbol,
      interval: r.interval,
      chartTime: r.chartTime?.toISOString() ?? null,
      entryPrice: r.entryPrice,
      direction: (r.direction as ChartSampleView['direction']) ?? null,
      tpPct: r.tpPct,
      slPct: r.slPct,
      note: r.note,
      tags: toTags(r.tags),
      aiRead: (r.aiRead as ChartAiRead | null) ?? null,
      features: (r.features as ChartFeatures | null) ?? null,
      outcome,
      outcomeStatus: r.outcomeStatus,
      outcomeError: r.outcomeError,
      side: sideView(outcome, r.direction),
      conversationId: r.conversationId,
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
  return `${hs.join('; ')} · TP+${o.tpPct}%/SL−${o.slPct}%: ${ts('LONG', o.long)}, ${ts('SHORT', o.short)}`;
}

function sampleBlock(s: ChartSampleView, title: string): string {
  const out = [`${title}`, `   ${s.symbol ?? '?'} ${s.interval ?? '?'} · nến cuối ${fmtTime(s.chartTime)} · user gắn: ${s.direction ?? 'chưa gắn'}${s.tags.length ? ` · tag: ${s.tags.join(', ')}` : ''}`];
  if (s.note) out.push(`   Ghi chú user: ${s.note.slice(0, 400)}`);
  if (s.features) out.push(`   Chỉ số: ${featureLine(s.features)}`);
  out.push(`   Kết quả thực tế: ${outcomeLine(s.outcome)}`);
  if (s.side) out.push(`   → Nhận định của user ${s.side.tpSl.result === 'TP' ? 'ĐÚNG (chạm TP trước)' : s.side.tpSl.result === 'SL' ? 'SAI (chạm SL trước)' : 'chưa ngã ngũ'}`);
  return out.join('\n');
}

function statLine(s: StatRow): string {
  if (!s.n) return `- ${s.key}: chưa có mẫu`;
  return `- ${s.key}: ${s.n} mẫu · TP trước SL ${s.tpWinRate ?? '—'}% (${s.tp}/${s.tp + s.sl}, ${s.open} chưa ngã ngũ) · đúng hướng sau 24 nến ${s.winRate24 ?? '—'}% (n=${s.n24}), TB ${s.avgRet24 ?? '—'}%`;
}
