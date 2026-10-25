import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';

/** Assistant behind the 🤖 button on /bitget — reads the live account and proposes action cards. Hidden from /skills. */
export const bitgetAiSkill: SkillDefinition = {
  id: 'bitget-ai',
  name: 'Bitget AI',
  description: 'Trả lời về tài khoản Bitget và đề xuất lệnh (mở / DCA / TP / đóng / huỷ) để người dùng xác nhận.',
  icon: '🤖',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: [
    'bitget_account',
    'bitget_positions',
    'bitget_pending_orders',
    'bitget_history',
    'bitget_setup',
    'bitget_journal',
    'bitget_charts',
    'bitget_signals',
    'analyze_market_structure',
    'get_klines',
    'get_ticker_price',
    'propose_bitget_action',
  ],
  exampleQuestions: [],
  welcomeMessage: '',
  hidden: true,
};
