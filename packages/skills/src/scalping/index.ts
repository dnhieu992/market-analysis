import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';
import { EXAMPLE_QUESTIONS } from './examples';

export const scalpingSkill: SkillDefinition = {
  id: 'scalping',
  name: 'Scalping',
  description: 'Đọc đủ nến 30m / 15m / 5m như nhìn chart để tìm lệnh scalp ngay — LONG hay SHORT, entry, stop loss, TP1/TP2 cụ thể, R:R đã tính phí.',
  icon: '⚡',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['get_scalp_chart_data', 'get_ticker_price'],
  exampleQuestions: EXAMPLE_QUESTIONS,
  welcomeMessage: 'Xin chào! Tôi phân tích scalping trên 30m (bias) + 15m (setup) + 5m (trigger) từ dữ liệu nến thật, rồi đưa ra kế hoạch cụ thể: LONG/SHORT, loại lệnh, entry, SL, TP1/TP2 và R:R sau phí. Bạn muốn scalp coin nào?'
};
