import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';
import { EXAMPLE_QUESTIONS } from './examples';

export const shortBtcDailySkill: SkillDefinition = {
  id: 'short-btc-daily',
  name: 'Short BTC Intraday',
  description: 'Tìm setup short BTC trong ngày — limit entry zone, stop loss, TP1/TP2 với risk score cụ thể. Không giữ qua đêm. Phân tích trên 4H + 1H + 15min.',
  icon: '🐻',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['get_klines', 'get_ticker_price', 'analyze_market_structure'],
  exampleQuestions: EXAMPLE_QUESTIONS,
  welcomeMessage: 'Xin chào! Tôi tìm setup short BTC trong ngày — không giữ qua đêm. Tôi sẽ phân tích 4H (context) + 1H (setup) + 15min (entry confirmation), chấm điểm rủi ro 0–10, và đưa ra entry zone cụ thể với limit order, stop loss, và TP1/TP2. Bạn muốn phân tích ngay không?',
};
