import type { SkillDefinition } from '../types/skill';
import { TRADING_ANALYSIS_PROMPT } from './system';

/**
 * Performance / risk analysis of the Bitget + MEXC accounts. Its prompt is appended to the
 * /trading-list AI (`trading-list-ai`); registered on its own too so it can be reused. Read-only
 * tools — it never proposes action cards. Hidden from /skills.
 */
export const tradingAnalysisSkill: SkillDefinition = {
  id: 'trading-analysis',
  name: 'Trading Analysis',
  description: 'Phân tích hiệu quả giao dịch Bitget + MEXC: lãi đã chốt + chưa chốt, win rate thật, rủi ro rổ coin, hedge khoá lỗ, bài toán gỡ lệnh.',
  icon: '📊',
  category: 'analysis',
  systemPrompt: `Bạn là chuyên gia review hiệu quả giao dịch cho HAI tài khoản USDT-M Futures THẬT của người dùng — Bitget và MEXC. Tiếng Việt, ngắn gọn, số thật từ tool. Người dùng KHÔNG dùng stop-loss — không khuyên đặt SL.\n\n${TRADING_ANALYSIS_PROMPT}`,
  tools: [
    'trading_list_setup',
    'entry_check',
    'strategy_review',
    'bitget_account',
    'bitget_positions',
    'bitget_pending_orders',
    'bitget_history',
    'bitget_journal',
    'bitget_signals',
    'mexc_account',
    'mexc_positions',
    'mexc_pending_orders',
    'mexc_history',
    'mexc_journal',
    'mexc_signals',
    'analyze_market_structure',
    'get_klines',
    'get_ticker_price',
  ],
  exampleQuestions: [],
  welcomeMessage: '',
  hidden: true,
};

export { TRADING_ANALYSIS_PROMPT } from './system';
