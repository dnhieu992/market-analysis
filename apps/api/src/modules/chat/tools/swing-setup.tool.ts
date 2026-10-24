import type { ChatTool } from '../contracts/chat-tool';
import { createTrackingSetup, SetupInputError } from '../../tracking-trades/tracking-setup-factory';

type Input = {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  orderType: 'LIMIT' | 'STOP' | 'MARKET';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  takeProfit3?: number;
  setupType?: string;
  confidence?: string;
  thesis?: string;
  triggerNote?: string;
  invalidation?: string;
};

/**
 * Stores a swing setup for /tracking-coins as PROPOSED; the panel shows it under the reply with
 * Theo dõi / Đặt lệnh / Bỏ. Nothing is placed until the user decides.
 */
export const proposeSwingSetupTool: ChatTool<Input, string> = {
  name: 'propose_swing_setup',
  description:
    'Propose one swing trade setup for a coin on the user\'s Tracking Coins list. It appears as a card with buttons to ' +
    'watch it, place it as a paper order, or discard it. Call once per setup (at most 2 per coin). Targets close ' +
    '50/30/20% of the size by default; TP1 moves the stop to break-even, TP2 moves it to TP1.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Coin, e.g. "SOL" or "SOLUSDT" (must be on the watchlist)' },
      direction: { type: 'string', description: 'LONG or SHORT' },
      orderType: { type: 'string', description: 'LIMIT (wait for a pullback to entry), STOP (wait for a break through entry) or MARKET (enter now)' },
      entryPrice: { type: 'number', description: 'Entry price (for MARKET: the current price)' },
      stopLoss: { type: 'number', description: 'Stop loss' },
      takeProfit1: { type: 'number', description: 'First target' },
      takeProfit2: { type: 'number', description: 'Second target (optional)' },
      takeProfit3: { type: 'number', description: 'Third target (optional)' },
      setupType: { type: 'string', description: 'Short, consistent setup name for statistics, e.g. "Pullback EMA34 D1"' },
      confidence: { type: 'string', description: 'e.g. "6/10"' },
      thesis: { type: 'string', description: 'Why this trade, in 1-3 sentences' },
      triggerNote: { type: 'string', description: 'Concrete condition to act on, e.g. "4H close above 0.589"' },
      invalidation: { type: 'string', description: 'What cancels the idea' },
    },
    required: ['symbol', 'direction', 'orderType', 'entryPrice', 'stopLoss', 'takeProfit1'],
  },
  async execute(input, context) {
    try {
      const setup = await createTrackingSetup(
        {
          ...input,
          direction: String(input.direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG',
          orderType: (String(input.orderType).toUpperCase() as Input['orderType']) || 'LIMIT',
          targets: [input.takeProfit1, input.takeProfit2, input.takeProfit3].filter((x): x is number => typeof x === 'number'),
        },
        { source: 'CLAUDE', status: 'PROPOSED', conversationId: context?.conversationId ?? null },
      );
      return `Đã tạo thẻ setup ${setup.direction} ${setup.symbol} (id ${setup.id}). Người dùng sẽ quyết định Theo dõi / Đặt lệnh / Bỏ.`;
    } catch (e) {
      if (e instanceof SetupInputError) return `Không tạo được setup: ${e.message} Hãy sửa lại số liệu rồi gọi lại.`;
      throw e;
    }
  },
};
