import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';

/** Assistant behind the 🤖 button on /mexc — reads the live account and proposes action cards. Hidden from /skills. */
export const mexcAiSkill: SkillDefinition = {
  id: 'mexc-ai',
  name: 'MEXC AI',
  description: 'Trả lời về tài khoản MEXC và đề xuất lệnh (mở / DCA / TP / đóng / huỷ) để người dùng xác nhận.',
  icon: '🤖',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: [
    'mexc_account',
    'mexc_positions',
    'mexc_pending_orders',
    'mexc_history',
    'mexc_setup',
    'mexc_journal',
    'mexc_charts',
    'mexc_signals',
    'analyze_market_structure',
    'get_klines',
    'get_ticker_price',
    'get_scalp_chart_data',
    'propose_mexc_action',
  ],
  exampleQuestions: [],
  welcomeMessage: '',
  hidden: true,
};
