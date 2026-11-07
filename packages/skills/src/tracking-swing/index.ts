import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';

/**
 * Spot dip-buying analyst behind the coin panel on /tracking-coins (target ~30% per leg) —
 * hidden from the /skills page. The id stays 'tracking-swing' so existing conversations keep working.
 */
export const trackingSwingSkill: SkillDefinition = {
  id: 'tracking-swing',
  name: 'Spot Tracking',
  description: 'Mua lướt spot cho coin trong danh sách theo dõi: tìm vùng mua, chia 3 phần, mục tiêu ~+30% mỗi nhịp.',
  icon: '🧭',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['analyze_market_structure', 'get_klines', 'get_ticker_price', 'get_tracking_coins'],
  exampleQuestions: [],
  welcomeMessage: '',
  hidden: true,
};
