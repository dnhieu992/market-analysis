import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';

/** Assistant of /trading-list — reads both the Bitget and the MEXC account and proposes action cards on either. Hidden from /skills. */
export const tradingListAiSkill: SkillDefinition = {
  id: 'trading-list-ai',
  name: 'Trading List AI',
  description: 'Trả lời về cả 2 tài khoản Bitget + MEXC và đề xuất lệnh (mở / DCA / TP / đóng / huỷ) trên đúng sàn người dùng chỉ định để xác nhận.',
  icon: '🤖',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: [
    'trading_list_setup',
    'bitget_account',
    'bitget_positions',
    'bitget_pending_orders',
    'bitget_history',
    'bitget_journal',
    'bitget_charts',
    'bitget_signals',
    'mexc_account',
    'mexc_positions',
    'mexc_pending_orders',
    'mexc_history',
    'mexc_journal',
    'mexc_charts',
    'mexc_signals',
    'analyze_market_structure',
    'get_klines',
    'get_ticker_price',
    'get_scalp_chart_data',
    'propose_bitget_action',
    'propose_mexc_action',
  ],
  exampleQuestions: [],
  welcomeMessage: '',
  hidden: true,
};
