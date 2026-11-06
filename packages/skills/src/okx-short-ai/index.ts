import type { SkillDefinition } from '../types/skill';
import { BACKTEST_TOOLS } from '../backtest';
import { DEFAULT_ANALYSIS_SKILL, SYSTEM_PROMPT } from './system';

export { DEFAULT_ANALYSIS_SKILL as OKX_SHORT_DEFAULT_ANALYSIS_SKILL } from './system';

/**
 * Short-only assistant of /trades on the OKX account. The analysis part of the prompt is
 * editable at runtime (chat_skill_versions); see ./system.ts. Hidden from /skills.
 */
export const okxShortAiSkill: SkillDefinition = {
  id: 'okx-short-ai',
  name: 'OKX Short AI',
  description: 'Phân tích và đề xuất lệnh SHORT trên OKX (thẻ xác nhận), ghi note vào lệnh, sửa skill phân tích từ chat.',
  icon: '🐻',
  category: 'strategy',
  systemPrompt: `${SYSTEM_PROMPT}\n\n${DEFAULT_ANALYSIS_SKILL}`,
  tools: [
    'okx_account',
    'okx_positions',
    'okx_pending_orders',
    'okx_trades',
    'okx_order_notes',
    'add_order_note',
    'get_short_skill',
    'update_short_skill',
    'propose_okx_short',
    'analyze_market_structure',
    'get_klines',
    'get_ticker_price',
    'get_24h_ticker',
    'get_scalp_chart_data',
    'scan_junk_shorts',
    ...BACKTEST_TOOLS,
  ],
  exampleQuestions: [],
  welcomeMessage: '',
  hidden: true,
};

export { SYSTEM_PROMPT as OKX_SHORT_SYSTEM_PROMPT } from './system';
