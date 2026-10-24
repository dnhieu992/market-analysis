import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';

/** Swing analyst behind the coin panel on /tracking-coins — hidden from the /skills page. */
export const trackingSwingSkill: SkillDefinition = {
  id: 'tracking-swing',
  name: 'Swing Tracking',
  description: 'Phân tích swing 1W/1D/4H cho một coin trong danh sách theo dõi và đề xuất setup để theo dõi / đặt lệnh paper.',
  icon: '🧭',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['analyze_market_structure', 'get_klines', 'get_ticker_price', 'get_tracking_coins', 'propose_swing_setup'],
  exampleQuestions: [],
  welcomeMessage: '',
  hidden: true,
};
