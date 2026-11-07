import type { SkillDefinition } from '../types/skill';
import { SYSTEM_PROMPT } from './system';
import { EXAMPLE_QUESTIONS } from './examples';

export const shortJunkSkill: SkillDefinition = {
  id: 'short-junk',
  name: 'Short Coin Rác',
  description:
    'Scan danh sách coin rác của bạn (quản lý trên trang /short-junk) và tìm lệnh short theo 2 quy luật đã backtest: xả sau pump ≥50%/3 ngày và hồi EMA trong downtrend. Coin không đạt tiêu chí nghiên cứu (vốn hoá $20–500M trước pump, ≥50% dưới ATH, list ≥ 90 ngày) vẫn được scan nhưng bị cảnh báo. Vào lệnh chia 3 tầng, có stop cứng.',
  icon: '🗑️',
  category: 'strategy',
  systemPrompt: SYSTEM_PROMPT,
  tools: ['scan_junk_shorts', 'get_klines', 'get_24h_ticker', 'get_ticker_price', 'analyze_market_structure'],
  exampleQuestions: EXAMPLE_QUESTIONS,
  welcomeMessage:
    'Tôi chỉ scan các coin trong danh sách coin rác của bạn (nút 🗑️ Coin rác để thêm / sửa / xoá) và tìm lệnh short theo quy luật đã backtest trên 350 coin: (A) xả sau pump ≥ +50% trong 3 ngày, (B) hồi EMA20 trong downtrend khi BTC yếu. Mỗi lệnh có kế hoạch 3 tầng + stop cứng. Coin nào trong danh sách không đạt tiêu chí của nghiên cứu (vốn hoá trước pump $20–500M, giảm ≥ 50% từ đỉnh, list ≥ 90 ngày) sẽ bị gắn cờ đỏ. Tôi cũng cho biết con nào trong danh sách đang tăng mạnh và sắp thành setup. Scan ngay nhé?',
};
