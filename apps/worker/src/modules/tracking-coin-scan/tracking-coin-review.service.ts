import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export type HoldingVerdict = 'GIU' | 'GOM_THEM' | 'CHOT_BOT' | 'THOAT';

export type HoldingReviewInput = {
  symbol: string;
  position: {
    layers: number;
    avgEntry: number;
    capitalDeployed: number;
    entryMode: 'SIGNAL' | 'FOMO' | 'MIXED';
  };
  currentPrice: number;
  pnlPct: number;
  signal: {
    weekTrend: string;
    trend: string;
    h4Trend: string;
    dcaScore: number;
    dcaZone: string | null;
    rsi: number | null;
    extPct: number | null;
    utBotW1Bullish: boolean | null;
    utBotD1Bullish: boolean | null;
    utBotH4Bullish: boolean | null;
  };
};

export type HoldingReview = {
  verdict: HoldingVerdict;
  reason: string;
  model: string;
};

const REVIEW_TOOL_NAME = 'record_holding_review';
const REVIEW_TIMEOUT_MS = 45_000;

// Daily holding review runs once/day per coin → use the cheap, fast Haiku model.
function resolveModel(): string {
  return process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001';
}

const REVIEW_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['GIU', 'GOM_THEM', 'CHOT_BOT', 'THOAT'],
      description:
        'GIU = giữ nguyên vị thế; GOM_THEM = nên gom thêm; CHOT_BOT = nên chốt bớt; THOAT = nên thoát toàn bộ.',
    },
    reason: { type: 'string', description: '1-2 câu lý do ngắn gọn bằng tiếng Việt.' },
  },
} as const;

function fmt(n: number | null | undefined, digits = 2): string {
  return n == null ? 'n/a' : Number(n).toFixed(digits);
}

function bull(b: boolean | null): string {
  return b == null ? 'n/a' : b ? 'bull' : 'bear';
}

function buildUserMessage(input: HoldingReviewInput): string {
  const { symbol, position, currentPrice, pnlPct, signal } = input;
  const entryModeVi =
    position.entryMode === 'SIGNAL' ? 'theo tín hiệu GOM' : position.entryMode === 'FOMO' ? 'FOMO (không theo tín hiệu)' : 'hỗn hợp';
  return [
    `Đánh giá vị thế DCA hiện tại của ${symbol} (spot, không stop-loss):`,
    `- Cách vào lệnh: ${entryModeVi}`,
    `- Số lớp đã gom: ${position.layers}`,
    `- Giá vốn trung bình: ${fmt(position.avgEntry, 6)}`,
    `- Vốn đã giải ngân: $${fmt(position.capitalDeployed)}`,
    `- Giá hiện tại: ${fmt(currentPrice, 6)}`,
    `- PnL hiện tại: ${pnlPct >= 0 ? '+' : ''}${fmt(pnlPct)}%`,
    '',
    'Bối cảnh tín hiệu hiện tại:',
    `- Xu hướng PA: W=${signal.weekTrend}, D1=${signal.trend}, H4=${signal.h4Trend}`,
    `- UT Bot: W=${bull(signal.utBotW1Bullish)}, D1=${bull(signal.utBotD1Bullish)}, H4=${bull(signal.utBotH4Bullish)}`,
    `- dcaScore (độ an toàn để DCA): ${signal.dcaScore}, vùng DCA: ${signal.dcaZone ?? 'n/a'}`,
    `- RSI(D1): ${fmt(signal.rsi, 1)}`,
    `- Ext% (cách EMA34 D1): ${signal.extPct == null ? 'n/a' : `${signal.extPct >= 0 ? '+' : ''}${fmt(signal.extPct, 1)}%`}`,
    '',
    'Hãy quyết định nên GIU / GOM_THEM / CHOT_BOT / THOAT và nêu lý do ngắn gọn bằng tiếng Việt.',
  ].join('\n');
}

@Injectable()
export class TrackingCoinReviewService {
  private readonly logger = new Logger(TrackingCoinReviewService.name);

  async review(input: HoldingReviewInput): Promise<HoldingReview | null> {
    const apiKey = (process.env.CLAUDE_API_KEY ?? '').trim();
    if (!apiKey) {
      this.logger.warn('Holding review skipped — CLAUDE_API_KEY missing');
      return null;
    }
    const model = resolveModel();

    try {
      const client = axios.create({
        baseURL: 'https://api.anthropic.com/v1',
        timeout: REVIEW_TIMEOUT_MS,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      });

      const response = await client.post<{
        content?: Array<{ type?: string; name?: string; input?: unknown }>;
      }>('/messages', {
        model,
        max_tokens: 400,
        system:
          'Bạn là một trader spot kỷ luật, đang đánh giá hằng ngày một vị thế DCA (gom dần, không stop-loss). ' +
          'Ưu tiên quản trị rủi ro: tránh gom thêm khi xu hướng lớn (W/D1) đang xấu hoặc giá đã extended; ' +
          'cân nhắc chốt bớt khi đã lãi tốt mà động lượng yếu đi; ' +
          'gợi ý thoát khi cấu trúc xu hướng dài hạn gãy. Trả lời ngắn gọn, thực dụng, bằng tiếng Việt.',
        messages: [{ role: 'user', content: buildUserMessage(input) }],
        tools: [{ name: REVIEW_TOOL_NAME, description: 'Ghi lại đánh giá vị thế nắm giữ.', input_schema: REVIEW_TOOL_SCHEMA }],
        tool_choice: { type: 'tool', name: REVIEW_TOOL_NAME },
      });

      const toolInput = response.data.content?.find(
        (block) => block.type === 'tool_use' && block.name === REVIEW_TOOL_NAME,
      )?.input as Record<string, unknown> | undefined;

      if (toolInput == null) {
        this.logger.warn(`Holding review ${input.symbol}: response missing tool_use block`);
        return null;
      }

      return {
        verdict: toolInput['verdict'] as HoldingVerdict,
        reason: (toolInput['reason'] as string) ?? '',
        model,
      };
    } catch (error) {
      const e = error as { response?: { status?: number; data?: unknown }; message?: string };
      this.logger.warn(`Holding review ${input.symbol} failed: ${e.message} | ${JSON.stringify(e.response?.data)}`);
      return null;
    }
  }
}
