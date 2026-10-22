import { createSkillTradeSetupRepository } from '@app/db';

import type { ChatTool } from '../contracts/chat-tool';

type ProposeTradeSetupInput = {
  symbol: string;
  direction: string;
  orderType: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  setupType?: string;
  confidence?: string;
  note?: string;
};

const ORDER_TYPES = ['MARKET', 'LIMIT', 'STOP'];

/** Returns why the prices don't form a valid trade, or null when they do. */
function validatePrices(i: ProposeTradeSetupInput, long: boolean): string | null {
  const prices = [i.entryPrice, i.stopLoss, i.takeProfit1, i.takeProfit2].filter((p) => p != null);
  if (prices.some((p) => !Number.isFinite(p) || p! <= 0)) return 'all prices must be positive numbers';
  const below = (a: number, b: number) => (long ? a < b : a > b);
  if (!below(i.stopLoss, i.entryPrice)) return `stopLoss must be ${long ? 'below' : 'above'} entryPrice for a ${long ? 'LONG' : 'SHORT'}`;
  if (!below(i.entryPrice, i.takeProfit1)) return `takeProfit1 must be ${long ? 'above' : 'below'} entryPrice for a ${long ? 'LONG' : 'SHORT'}`;
  if (i.takeProfit2 != null && !below(i.takeProfit1, i.takeProfit2)) return 'takeProfit2 must be beyond takeProfit1';
  return null;
}

/**
 * Saves a concrete trade setup so the chat UI can show it with Accept / Cancel buttons.
 * Accepting it (StrategyPaperTradesController) turns it into a paper trade on /trading-analysis.
 */
export function createProposeTradeSetupTool(repo = createSkillTradeSetupRepository()): ChatTool<ProposeTradeSetupInput, string> {
  return {
    name: 'propose_trade_setup',
    description:
      'Register ONE concrete, actionable trade setup so the user can Accept it (it then becomes a tracked paper trade ' +
      'with SL/TP) or Cancel it. Call once per setup you recommend (max 2 per reply), after you have the final numbers. ' +
      'orderType: MARKET (enter now), LIMIT (entry is a better price than now — pullback), STOP (entry is a breakout beyond ' +
      'the current price). takeProfit1 closes 50% and moves the stop to break-even; takeProfit2 closes the rest.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Trading pair, e.g. BTCUSDT' },
        direction: { type: 'string', description: 'LONG or SHORT' },
        orderType: { type: 'string', description: 'MARKET, LIMIT or STOP' },
        entryPrice: { type: 'number', description: 'Entry price (for MARKET: the current price)' },
        stopLoss: { type: 'number', description: 'Stop loss price' },
        takeProfit1: { type: 'number', description: 'First take profit (closes 50%)' },
        takeProfit2: { type: 'number', description: 'Second take profit (closes the rest); omit to use a single TP' },
        setupType: { type: 'string', description: 'Short setup name, e.g. "Pullback EMA21 + VWAP"' },
        confidence: { type: 'string', description: 'Cao, Trung bình or Thấp' },
        note: { type: 'string', description: 'One line: the trigger to wait for / what invalidates it' }
      },
      required: ['symbol', 'direction', 'orderType', 'entryPrice', 'stopLoss', 'takeProfit1']
    },
    async execute(input, context) {
      if (!context) return 'Error: propose_trade_setup is only available inside a conversation.';

      const direction = input.direction.toUpperCase();
      const orderType = input.orderType.toUpperCase();
      if (direction !== 'LONG' && direction !== 'SHORT') return 'Error: direction must be LONG or SHORT';
      if (!ORDER_TYPES.includes(orderType)) return 'Error: orderType must be MARKET, LIMIT or STOP';
      const invalid = validatePrices(input, direction === 'LONG');
      if (invalid) return `Error: ${invalid}. Fix the numbers and call again.`;

      const raw = input.symbol.toUpperCase();
      const setup = await repo.create({
        conversationId: context.conversationId,
        skillId: context.skillId ?? 'unknown',
        symbol: raw.endsWith('USDT') ? raw : `${raw}USDT`,
        direction,
        orderType,
        entryPrice: input.entryPrice,
        stopLoss: input.stopLoss,
        takeProfit1: input.takeProfit1,
        takeProfit2: input.takeProfit2 ?? null,
        setupType: input.setupType?.slice(0, 80) ?? null,
        confidence: input.confidence?.slice(0, 20) ?? null,
        note: input.note ?? null
      });
      return `Setup saved (id ${setup.id}). The user sees it under your reply with Accept / Cancel buttons — do not repeat the id.`;
    }
  };
}
