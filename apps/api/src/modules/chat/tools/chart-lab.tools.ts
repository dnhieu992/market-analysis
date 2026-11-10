import { Injectable } from '@nestjs/common';

import { ChartLabService, featureLine, outcomeLine } from '../../chart-lab/chart-lab.service';
import type { ChatTool, ChatToolRichResult } from '../contracts/chat-tool';

const shortId = (id: string) => id.slice(-6);
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
      description: 'What price REALLY did after a chart (6/24/72 candles, TP/SL first touch both ways). Use only when the user asks for the result.',
      inputSchema: { type: 'object', properties: { sampleId: { type: 'string', description: 'Chart id (full or #short id)' } }, required: ['sampleId'] },
      execute: async (input) => {
        const s = await this.lab.get(await this.resolveId(input.sampleId));
        if (s.outcomeStatus === 'ERROR') return `Chưa chấm được: ${s.outcomeError ?? 'lỗi'}`;
        return `#${shortId(s.id)} ${s.symbol} ${s.interval} · giá vào ${s.entryPrice} · ${outcomeLine(s.outcome)}${s.outcomeStatus === 'PENDING' ? ' (đang tiếp tục cập nhật khi có nến mới)' : ''}`;
      },
    };
  }

  private updateTool(): ChatTool<{ sampleId: string; direction?: string; tags?: string[]; note?: string }, string> {
    return {
      name: 'update_chart_sample',
      description:
        "Save the USER's label / tags / note on a chart. Only when the user explicitly asks (e.g. 'lưu là short', 'thêm tag double-top'). tags replaces the whole list — include the existing ones you keep.",
      inputSchema: {
        type: 'object',
        properties: {
          sampleId: { type: 'string', description: 'Chart id (full or #short id)' },
          direction: { type: 'string', description: 'LONG | SHORT | NONE' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Full tag list (lowercase-kebab)' },
          note: { type: 'string', description: "User's reasoning" },
        },
        required: ['sampleId'],
      },
      execute: async (input) => {
        const id = await this.resolveId(input.sampleId);
        const dir = input.direction?.toUpperCase();
        const s = await this.lab.update(id, {
          ...(dir ? { direction: dir as 'LONG' | 'SHORT' | 'NONE' } : {}),
          ...(input.tags ? { tags: input.tags } : {}),
          ...(input.note != null ? { note: input.note } : {}),
        });
        return `Đã lưu #${shortId(s.id)}: nhận định ${s.direction ?? 'chưa gắn'} · tag ${s.tags.join(', ') || '—'}${s.note ? ` · ghi chú: ${s.note.slice(0, 120)}` : ''}`;
      },
    };
  }
}
