import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';
import { EXAMPLE_QUESTIONS } from './examples';

export const priceActionSkill: SkillDefinition = {
  id: 'price-action',
  name: 'Price Action Analysis',
  description: 'Phân tích cấu trúc giá thuần túy — swing highs/lows, vùng hỗ trợ/kháng cự, và xu hướng thị trường mà không dùng indicator.',
  icon: '📊',
  category: 'analysis',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['analyze_market_structure', 'get_ticker_price', 'get_24h_ticker'],
  exampleQuestions: EXAMPLE_QUESTIONS,
  welcomeMessage: 'Xin chào! Tôi là chuyên gia phân tích Price Action. Hãy cho tôi biết coin bạn muốn phân tích (ví dụ: BTC, ETH, SOL) và tôi sẽ đọc cấu trúc giá cho bạn.'
};
