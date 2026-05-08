import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';
import { EXAMPLE_QUESTIONS } from './examples';

export const dcaSkill: SkillDefinition = {
  id: 'dca',
  name: 'DCA Strategy',
  description: 'Lập kế hoạch tích lũy dài hạn theo vùng giá — xác định zone mua DCA, phân bổ vốn theo đợt, và điều kiện dừng DCA dựa trên cấu trúc thị trường.',
  icon: '💰',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['analyze_market_structure', 'get_ticker_price', 'get_24h_ticker'],
  exampleQuestions: EXAMPLE_QUESTIONS,
  welcomeMessage: 'Xin chào! Tôi chuyên tư vấn chiến lược DCA dài hạn. Cho tôi biết coin bạn muốn tích lũy và ngân sách dự kiến, tôi sẽ xây dựng kế hoạch DCA với các vùng mua cụ thể.'
};
