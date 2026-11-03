import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';
import { EXAMPLE_QUESTIONS } from './examples';

export const shortJunkSkill: SkillDefinition = {
  id: 'short-junk',
  name: 'Short Coin Rác',
  description:
    'Scan coin rác Binance (list spot + futures, vốn hoá trước pump $20–500M, đã giảm ≥50% từ ATH) và tìm lệnh short theo 2 quy luật đã backtest: xả sau pump ≥50%/3 ngày và hồi EMA trong downtrend. Đọc cả top tăng 24h của Binance. Vào lệnh chia 3 tầng, có stop cứng.',
  icon: '🗑️',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['scan_junk_shorts', 'get_klines', 'get_24h_ticker', 'get_ticker_price', 'analyze_market_structure'],
  exampleQuestions: EXAMPLE_QUESTIONS,
  welcomeMessage:
    'Tôi scan toàn bộ coin rác (đã list spot + futures Binance ≥ 90 ngày, vốn hoá trước pump $20–500M, giá đã giảm ≥ 50% từ đỉnh) và tìm lệnh short theo quy luật đã backtest trên 350 coin: (A) xả sau pump ≥ +50% trong 3 ngày, (B) hồi EMA20 trong downtrend khi BTC yếu. Mỗi lệnh có kế hoạch 3 tầng + stop cứng. Tôi đọc cả top tăng 24h của Binance (coin rác hay nằm ở đây) và cho biết con nào sắp thành setup. Scan ngay nhé?',
};
