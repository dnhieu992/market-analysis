import { Injectable } from '@nestjs/common';

import { ChartLabService, featureLine, outcomeLine, type ChartSampleInput } from '../../chart-lab/chart-lab.service';
import type { ChatTool, ChatToolRichResult } from '../contracts/chat-tool';

const shortId = (id: string) => id.slice(-6);
/** 'YYYY-MM-DD HH:mm' without an offset is Vietnam time (what the user types); anything with an offset passes through. */
const vnTime = (v: string | null) => {
  if (!v) return null;
  const t = v.trim().replace(' ', 'T');
  return /(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : `${t.length === 16 ? `${t}:00` : t}+07:00`;
};

type UpdateInput = {
  sampleId: string;
  symbol?: string | null;
  interval?: string | null;
  chartTime?: string | null;
  direction?: string | null;
  entryPrice?: number | null;
  tpPrice?: number | null;
  slPrice?: number | null;
  tags?: string[];
  addTags?: string[];
  removeTags?: string[];
  note?: string | null;
  appendNote?: string;
  aiSummary?: string | null;
};

const fmt = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '—');

/** Tools of the /chart-lab analysis chat: browse the library, read win rates, see a result, label a chart. */
@Injectable()
export class ChartLabChatService {
  constructor(private readonly lab: ChartLabService) {}

  tools(): ChatTool[] {
    return [this.similarTool(), this.statsTool(), this.outcomeTool(), this.updateTool()] as ChatTool[];
  }

  /** Library ids are shown as the last 6 chars (#abc123) — accept either form. */
  private async resolveId(raw: unknown): Promise<string> {
    const s = String(raw ?? '').trim().replace(/^#/, '');
    if (!s) throw new Error('Thiếu sampleId');
    if (s.length > 10) return s;
    const hit = (await this.lab.list()).find((x) => x.id.endsWith(s));
    if (!hit) throw new Error(`Không có chart #${s}`);
    return hit.id;
  }

  private similarTool(): ChatTool<{ sampleId: string; limit?: number; tag?: string; withImages?: boolean }, string | ChatToolRichResult> {
    return {
      name: 'find_similar_charts',
      description:
        'Charts in the library most similar to a given chart (market fingerprint + shared tags), with the user label, note and REAL outcome of each. ' +
        'Optional tag filter. withImages=true attaches up to 3 of their images.',
      inputSchema: {
        type: 'object',
        properties: {
          sampleId: { type: 'string', description: 'Chart id (full or the #6-char short id)' },
          limit: { type: 'number', description: 'How many (default 6, max 15)' },
          tag: { type: 'string', description: 'Only charts carrying this tag' },
          withImages: { type: 'boolean', description: 'Attach images of the top 3 (default false)' },
        },
        required: ['sampleId'],
      },
      execute: async (input) => {
        const id = await this.resolveId(input.sampleId);
        let list = await this.lab.similar(id, input.tag ? 20 : Math.min(input.limit ?? 6, 15));
        if (input.tag) list = list.filter((s) => s.sample.tags.includes(input.tag!.toLowerCase())).slice(0, Math.min(input.limit ?? 6, 15));
        if (!list.length) return 'Không có chart nào phù hợp trong thư viện.';
        const text = list
          .map(({ sample: s, similarity }) =>
            [
              `#${shortId(s.id)} — giống ${similarity}% — ${s.symbol ?? '?'} ${s.interval ?? '?'} · ${fmt(s.chartTime)} · user gắn: ${s.direction ?? 'chưa gắn'}${s.tags.length ? ` · tag: ${s.tags.join(', ')}` : ''}`,
              s.note ? `   Ghi chú: ${s.note.slice(0, 300)}` : '',
              s.features ? `   Chỉ số: ${featureLine(s.features)}` : '',
              `   Kết quả: ${outcomeLine(s.outcome)}`,
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n');
        if (!input.withImages) return text;
        const images: Array<{ data: string; mimeType: string }> = [];
        for (const { sample } of list.slice(0, 3)) {
          if (!sample.imageUrl) continue;
          try {
            const res = await fetch(sample.imageUrl, { signal: AbortSignal.timeout(20_000) });
            if (res.ok) images.push({ data: Buffer.from(await res.arrayBuffer()).toString('base64'), mimeType: res.headers.get('content-type') ?? 'image/png' });
          } catch {
            /* text only */
          }
        }
        return images.length ? { kind: 'rich', text: `${text}\n\n(Ảnh đính kèm theo thứ tự 3 chart đầu)`, images } : text;
      },
    };
  }

  private statsTool(): ChatTool<Record<string, never>, string> {
    return {
      name: 'get_chart_lab_stats',
      description: "Win rates of the user's LONG/SHORT calls in the library: overall, per direction and per tag (TP-before-SL rate, right direction after 24 candles, average move).",
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const s = await this.lab.stats();
        const line = (r: (typeof s)['overall']) =>
          `- ${r.key}: n=${r.n} · TP trước SL ${r.tpWinRate ?? '—'}% (${r.tp}/${r.tp + r.sl}, ${r.open} chưa ngã ngũ) · đúng hướng 24 nến ${r.winRate24 ?? '—'}% (n=${r.n24}) · TB ${r.avgRet24 ?? '—'}% · TB chạy được ${r.avgFav24 ?? '—'}% · TB ngược ${r.avgAdv24 ?? '—'}%`;
        return [
          `Thư viện: ${s.total} chart, ${s.labeled} đã gắn LONG/SHORT, ${s.pending} đang chờ kết quả.`,
          line(s.overall),
          ...s.byDirection.map(line),
          'Theo tag:',
          ...(s.byTag.length ? s.byTag.map(line) : ['(chưa có)']),
        ].join('\n');
      },
    };
  }

  private outcomeTool(): ChatTool<{ sampleId: string }, string> {
    return {
      name: 'get_chart_outcome',
      description: 'What price REALLY did after any chart in the library (6/24/72 candles, TP/SL first touch both ways), latest data.',
      inputSchema: { type: 'object', properties: { sampleId: { type: 'string', description: 'Chart id (full or #short id)' } }, required: ['sampleId'] },
      execute: async (input) => {
        const s = await this.lab.get(await this.resolveId(input.sampleId));
        if (s.outcomeStatus === 'ERROR') return `Chưa chấm được: ${s.outcomeError ?? 'lỗi'}`;
        return `#${shortId(s.id)} ${s.symbol} ${s.interval} · ${outcomeLine(s.outcome)}${s.outcomeStatus === 'PENDING' ? ' (đang tiếp tục cập nhật khi có nến mới)' : ''}`;
      },
    };
  }

  private updateTool(): ChatTool<UpdateInput, string> {
    return {
      name: 'update_chart_sample',
      description:
        "Write the USER's analysis of a chart in the library to the database: coin, timeframe, time, direction, entry / TP / SL price, tags, note, and the saved Claude summary. " +
        'Only the fields you pass change; pass null to clear one. Changing coin/timeframe/time/entry/TP/SL re-scores the real Binance outcome. ' +
        "Use only when the user asks to save / change something (e.g. 'sửa TP thành 3.2', 'đổi khung 4h', 'thêm tag double-top', 'lưu nhận xét này').",
      inputSchema: {
        type: 'object',
        properties: {
          sampleId: { type: 'string', description: 'Chart id (full or #short id)' },
          symbol: { type: ['string', 'null'], description: 'Binance symbol, e.g. BTCUSDT' },
          interval: { type: ['string', 'null'], description: '1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w' },
          chartTime: { type: ['string', 'null'], description: "Chart time. 'YYYY-MM-DD HH:mm' = Vietnam time (UTC+7), or ISO with offset. null = latest closed candle" },
          direction: { type: ['string', 'null'], description: 'LONG | SHORT | NONE (đứng ngoài)' },
          entryPrice: { type: ['number', 'null'], description: 'Entry price (null = candle close)' },
          tpPrice: { type: ['number', 'null'], description: 'Take-profit price (null = timeframe default)' },
          slPrice: { type: ['number', 'null'], description: 'Stop-loss price (null = timeframe default)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Replace the whole tag list (lowercase-kebab)' },
          addTags: { type: 'array', items: { type: 'string' }, description: 'Tags to add (keeps existing)' },
          removeTags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' },
          note: { type: ['string', 'null'], description: "Replace the user's note" },
          appendNote: { type: 'string', description: 'Text appended to the existing note on a new line' },
          aiSummary: { type: ['string', 'null'], description: 'Replace the saved Claude summary of this chart' },
        },
        required: ['sampleId'],
      },
      execute: async (input) => {
        const id = await this.resolveId(input.sampleId);
        const before = await this.lab.get(id);
        const patch: ChartSampleInput = {};
        if (input.symbol !== undefined) patch.symbol = input.symbol;
        if (input.interval !== undefined) patch.interval = input.interval;
        if (input.chartTime !== undefined) patch.chartTime = vnTime(input.chartTime);
        if (input.direction !== undefined) patch.direction = (input.direction?.toUpperCase() ?? null) as ChartSampleInput['direction'];
        if (input.entryPrice !== undefined) patch.entryPrice = input.entryPrice;
        if (input.tpPrice !== undefined) patch.tpPrice = input.tpPrice;
        if (input.slPrice !== undefined) patch.slPrice = input.slPrice;
        if (input.tags || input.addTags || input.removeTags) {
          const drop = new Set((input.removeTags ?? []).map((t) => t.toLowerCase()));
          patch.tags = [...(input.tags ?? before.tags), ...(input.addTags ?? [])].filter((t) => !drop.has(t.toLowerCase()));
        }
        if (input.note !== undefined) patch.note = input.note;
        if (input.appendNote) patch.note = [patch.note ?? before.note, input.appendNote].filter(Boolean).join('\n');

        const after = Object.keys(patch).length ? await this.lab.update(id, patch) : before;
        if (input.aiSummary !== undefined) await this.lab.saveAnalysis(id, input.aiSummary ?? '');

        const show = (x: typeof before) =>
          `${x.symbol ?? '?'} ${x.interval ?? '?'} · ${fmt(x.chartTime)} · ${x.direction ?? 'chưa gắn'} · vào ${x.entryPrice ?? '—'} · TP ${x.tpPrice ?? '—'} · SL ${x.slPrice ?? '—'} · tag ${x.tags.join(', ') || '—'}`;
        return [
          `Đã lưu vào DB chart #${shortId(id)}.`,
          `Trước: ${show(before)}`,
          `Sau:   ${show(after)}`,
          input.note !== undefined || input.appendNote ? `Nhận xét: ${(after.note ?? '—').slice(0, 300)}` : '',
          input.aiSummary !== undefined ? 'Đã thay tóm tắt Claude đã lưu.' : '',
          after.outcomeStatus === 'ERROR' ? `Kết quả: chưa chấm được (${after.outcomeError})` : `Kết quả thật: ${outcomeLine(after.outcome)}`,
        ]
          .filter(Boolean)
          .join('\n');
      },
    };
  }
}
