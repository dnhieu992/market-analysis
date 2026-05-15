import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';
import { EXAMPLE_QUESTIONS } from './examples';

export const shortBtcDailySkill: SkillDefinition = {
  id: 'short-btc-daily',
  name: 'Short BTC Daily',
  description: 'Phân tích BTCUSDT daily để tìm setup short (bearish) — cấu trúc swing, vùng S/R weekly, Fibonacci, và setup cụ thể với entry, SL, TP.',
  icon: '🐻',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['get_klines', 'get_ticker_price', 'analyze_market_structure'],
  exampleQuestions: EXAMPLE_QUESTIONS,
  welcomeMessage: 'Xin chào! Tôi chuyên phân tích BTC daily để tìm cơ hội short. Tôi sẽ fetch dữ liệu live từ Binance, phân tích cấu trúc swing, vùng S/R weekly, và tìm setup bearish với entry zone, stop loss, take profit cụ thể. Bạn muốn phân tích ngay không?',
};
