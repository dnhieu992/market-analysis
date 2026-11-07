import { prisma } from '@app/db';

import { describePosition } from '../chat/tools/spot-analytic.tools';
import { conversationUserId } from '../tracking-coins/spot-portfolio';
import { bareSymbol, pairOf } from './tracking-setup-factory';

export const TRACKING_SKILL_ID = 'tracking-swing';

/**
 * Context appended to the /tracking-coins (Spot Analytic) chat prompt: the coin being analysed
 * with its star rating and its position in the user's portfolios, or the watchlist-scan instruction.
 */
export async function buildTrackingContext(symbol?: string | null, conversationId?: string | null): Promise<string> {
  const bare = symbol ? bareSymbol(symbol) : null;
  if (!bare) {
    return '## Chế độ quét danh sách\nGọi get_tracking_coins, lọc ra tối đa 3 coin đáng mua spot nhất (còn dư địa ≥ +30%, đang ở / gần vùng mua), phân tích chi tiết từng coin rồi đưa kế hoạch mua.';
  }
  const userId = await conversationUserId(conversationId);
  const [coin, position] = await Promise.all([
    prisma.trackingCoin.findUnique({ where: { symbol: bare }, select: { rating: true } }),
    describePosition(userId, bare).catch(() => '(không đọc được portfolio)'),
  ]);
  return [
    `## Coin đang phân tích: ${bare} (${pairOf(bare)})\nChỉ lên kế hoạch mua spot cho coin này, trừ khi người dùng hỏi coin khác.`,
    `Đánh giá của người dùng: ${coin?.rating ? `${coin.rating}/5 sao` : 'chưa chấm sao'}.`,
    `## Vị thế hiện tại trong portfolio (số thật, gồm cả lệnh nhập ở trang Portfolio)\n${position}`,
  ].join('\n\n');
}
