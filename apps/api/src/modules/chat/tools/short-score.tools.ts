import { Injectable } from '@nestjs/common';
import { analyzeMarketStructure, type Candle } from '@app/core';

import { ShortScoreService, type ShortScoreView } from '../../short-score/short-score.service';
import type { ChatTool } from '../contracts/chat-tool';

const BASE = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';
type KlineRow = [number, string, string, string, string, string, number, ...unknown[]];

async function klines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const res = await fetch(`${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Binance ${res.status} for ${symbol} ${interval}`);
  const rows = (await res.json()) as KlineRow[];
  // drop the still-forming candle
  return rows.slice(0, -1).map((r) => ({
    openTime: new Date(r[0]),
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    volume: parseFloat(r[5]),
    closeTime: new Date(r[6]),
  }));
}

const px = (n: number) => Number(n.toPrecision(7));

function pair(raw: unknown): string {
  const s = String(raw ?? 'BTC').trim().toUpperCase().replace(/-SWAP$/, '').replace(/[^A-Z0-9]/g, '');
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

export function formatScore(v: ShortScoreView): string {
  const lines = [
    `Điểm SHORT ${v.symbol} lúc ${v.takenAt.slice(0, 16).replace('T', ' ')} UTC (giá ${v.price ?? '—'}): ${v.scorePct}% = ${v.hitPoints}/${v.maxPoints} điểm · bộ tiêu chí v${v.criteriaVersion}`,
    ...v.criteria.map((c) => `${c.error ? '⚠️' : c.hit ? '✅' : '❌'} [${c.id}] ${c.label} (+${c.points}) — ${c.error ? `LỖI: ${c.error}` : (c.detail ?? '')}`),
  ];
  return lines.join('\n');
}

/**
 * Tools of the /trades OKX short chat around the user's BTC SHORT checklist: score it, read / edit
 * the criteria (versioned, dry-run before saving), backtest the set, and find resistance zones
 * for the entry (swing: H4 and up, scalp: M15/M30).
 */
@Injectable()
export class ShortScoreChatService {
  constructor(private readonly score: ShortScoreService) {}

  tools(): ChatTool[] {
    return [this.scoreTool(), this.getCriteriaTool(), this.updateCriteriaTool(), this.backtestTool(), this.resistanceTool()] as ChatTool[];
  }

  private scoreTool(): ChatTool<Record<string, never>, string> {
    return {
      name: 'get_short_score',
      description:
        "Score the user's BTC SHORT checklist NOW (current criteria set, live data incl. Fear & Greed). Returns % short = points met / total points and each criterion ✅/❌ with its numbers. Takes ~3–10 s.",
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        try {
          return formatScore(await this.score.scoreNow('CHAT'));
        } catch (e) {
          return `Không chấm được điểm: ${(e as Error).message}`;
        }
      },
    };
  }

  private getCriteriaTool(): ChatTool<Record<string, never>, string> {
    return {
      name: 'get_score_criteria',
      description: 'The current criteria set of the SHORT score as JSON { symbol, intervals, criteria: [{ id, label, points, enabled, code }] } + version history. Call before editing.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const [cur, history] = await Promise.all([this.score.criteria(), this.score.history()]);
        return JSON.stringify({ version: cur.version, isDefault: cur.isDefault, set: cur.set, history: history.slice(0, 10) });
      },
    };
  }

  private updateCriteriaTool(): ChatTool<{ set: unknown; note?: string }, string> {
    return {
      name: 'update_score_criteria',
      description:
        'Save a NEW version of the SHORT score criteria set (full set, not a diff). The set is dry-run on live data first; any syntax error or criterion that throws rejects the save with the message — fix and call again. Only when the user explicitly asks to add / remove / change criteria.',
      inputSchema: {
        type: 'object',
        properties: {
          set: {
            type: 'object',
            description: 'Full set: { symbol: "BTCUSDT", intervals: ["1d","4h","1h","15m"], criteria: [{ id, label, points, enabled?, code }] }',
          },
          note: { type: 'string', description: 'Short Vietnamese note of what changed' },
        },
        required: ['set'],
      },
      execute: async (input, context) => {
        try {
          const r = await this.score.updateCriteria(input?.set, input?.note ? String(input.note).slice(0, 500) : null, 'LLM', context?.conversationId ?? null);
          return `Đã lưu bộ tiêu chí v${r.version}. Kết quả chạy thử với dữ liệu hiện tại:\n${formatScore(r.dryRun)}`;
        } catch (e) {
          return `Chưa lưu: ${(e as Error).message}`;
        }
      },
    };
  }

  private backtestTool(): ChatTool<{ days?: number; hourVn?: number; moves?: number[]; set?: unknown }, string> {
    return {
      name: 'backtest_short_score',
      description:
        'Backtest the SHORT score: scores the criteria once a day at hourVn (Vietnam time) over the past `days`, and for each score level reports how often price then touched −m% before +m% (= short won). Also per criterion: short-win when met vs not met. Pass `set` to test a proposed set before saving it.',
      inputSchema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Default 365 (30..1000)' },
          hourVn: { type: 'number', description: 'Hour (Vietnam time) the score is taken each day, default 12' },
          moves: { type: 'array', items: { type: 'number' }, description: 'Move sizes in %, default [1,2,3]' },
          set: { type: 'object', description: 'Optional proposed criteria set (same shape as update_score_criteria); default = the saved one' },
        },
      },
      execute: async (input) => {
        try {
          const r = await this.score.backtest({ days: input?.days, hourVn: input?.hourVn, moves: input?.moves, set: input?.set });
          return JSON.stringify(r);
        } catch (e) {
          return `Backtest lỗi: ${(e as Error).message}`;
        }
      },
    };
  }

  private resistanceTool(): ChatTool<{ symbol?: string; mode?: string }, string> {
    return {
      name: 'find_resistance_levels',
      description:
        'Resistance (and support) zones for the SHORT entry. mode "swing" → W / D1 / H4 zones (swing entries use H4 and higher); mode "scalp" → H1 / M30 / M15 zones. Zones above the price are sorted nearest first, with test count and strength.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Default BTCUSDT' },
          mode: { type: 'string', description: '"swing" (default) or "scalp"' },
        },
      },
      execute: async (input) => {
        const symbol = pair(input?.symbol ?? 'BTCUSDT');
        const scalp = String(input?.mode ?? 'swing').toLowerCase().startsWith('scalp');
        const tfs = scalp ? (['1h', '30m', '15m'] as const) : (['1w', '1d', '4h'] as const);
        try {
          const [a, b, c] = await Promise.all([klines(symbol, tfs[0], scalp ? 500 : 150), klines(symbol, tfs[1], scalp ? 500 : 365), klines(symbol, tfs[2], 500)]);
          if (c.length < 30) return `Không đủ dữ liệu cho ${symbol}.`;
          const ms = analyzeMarketStructure(symbol, a, b, c);
          const price = c[c.length - 1]!.close;
          const zones = (label: string, tf: (typeof ms)['daily']) => ({
            resistance: tf.resistance
              .filter((z) => z.zoneHigh >= price)
              .sort((x, y) => x.zoneCenter - y.zoneCenter)
              .slice(0, 5)
              .map((z) => ({ tf: label, center: px(z.zoneCenter), zone: [px(z.zoneLow), px(z.zoneHigh)], distPct: Number(((z.zoneCenter / price - 1) * 100).toFixed(2)), tests: z.testCount, strength: z.strength })),
            support: tf.support
              .filter((z) => z.zoneLow <= price)
              .sort((x, y) => y.zoneCenter - x.zoneCenter)
              .slice(0, 3)
              .map((z) => ({ tf: label, center: px(z.zoneCenter), zone: [px(z.zoneLow), px(z.zoneHigh)], distPct: Number(((z.zoneCenter / price - 1) * 100).toFixed(2)), tests: z.testCount, strength: z.strength })),
            trend: tf.trend,
            recentSwingHighs: tf.swings.filter((s) => s.type === 'high').slice(-3).map((s) => ({ price: px(s.price), time: s.time })),
            fib: tf.fib,
          });
          const labels = scalp ? ['H1', 'M30', 'M15'] : ['W', 'D1', 'H4'];
          return JSON.stringify({
            symbol,
            mode: scalp ? 'scalp' : 'swing',
            price: px(price),
            [labels[0]!]: zones(labels[0]!, ms.weekly),
            [labels[1]!]: zones(labels[1]!, ms.daily),
            [labels[2]!]: zones(labels[2]!, ms.fourHour),
          });
        } catch (e) {
          return `Lỗi lấy kháng cự: ${(e as Error).message}`;
        }
      },
    };
  }
}
