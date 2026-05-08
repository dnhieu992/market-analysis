import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';
import { EXAMPLE_QUESTIONS } from './examples';

export const riskManagementSkill: SkillDefinition = {
  id: 'risk-management',
  name: 'Risk Management',
  description: 'Tính toán position size, đánh giá rủi ro danh mục, và đưa ra khuyến nghị quản lý vốn cụ thể để bảo vệ tài khoản.',
  icon: '🛡️',
  category: 'education',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['get_ticker_price', 'get_24h_ticker'],
  exampleQuestions: EXAMPLE_QUESTIONS,
  welcomeMessage: 'Xin chào! Tôi chuyên tư vấn quản lý rủi ro và vốn. Cho tôi biết quy mô tài khoản, lệnh bạn đang xem xét, hoặc danh mục hiện tại — tôi sẽ tính toán position size và đánh giá mức độ rủi ro cụ thể.'
};
