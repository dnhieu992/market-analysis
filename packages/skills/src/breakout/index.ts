import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';
import { EXAMPLE_QUESTIONS } from './examples';

export const breakoutSkill: SkillDefinition = {
  id: 'breakout',
  name: 'Breakout Scanner',
  description: 'Phát hiện các setup breakout xác suất cao — vùng tích lũy, compression pattern, và xác nhận volume trước khi giá phá vỡ.',
  icon: '🚀',
  category: 'analysis',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['analyze_market_structure', 'get_klines', 'get_ticker_price', 'get_24h_ticker'],
  exampleQuestions: EXAMPLE_QUESTIONS,
  welcomeMessage: 'Xin chào! Tôi chuyên tìm kiếm và đánh giá setup breakout. Cho tôi biết coin bạn quan tâm và tôi sẽ phân tích pattern, xác suất breakout, và điểm entry/exit cụ thể.'
};
