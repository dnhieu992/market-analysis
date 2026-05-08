import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';
import { EXAMPLE_QUESTIONS } from './examples';

export const swingSkill: SkillDefinition = {
  id: 'swing',
  name: 'Swing Trading',
  description: 'Tìm kiếm setup swing trade đa khung thời gian — entry zone, stop loss, take profit với R:R tối thiểu 2:1, aligned với xu hướng weekly.',
  icon: '🎯',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['analyze_market_structure', 'get_klines', 'get_ticker_price'],
  exampleQuestions: EXAMPLE_QUESTIONS,
  welcomeMessage: 'Xin chào! Tôi chuyên phân tích swing trade theo đa khung thời gian. Cho tôi biết coin bạn muốn trade và tôi sẽ tìm setup với entry zone, stop loss, và take profit cụ thể.'
};
