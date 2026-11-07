import { bareSymbol, pairOf } from './tracking-setup-factory';

export const TRACKING_SKILL_ID = 'tracking-swing';

/**
 * Context appended to the /tracking-coins chat prompt (spot dip-buying, ~30% per leg):
 * the coin being analysed, or the watchlist-scan instruction. Swing setups / 1R / lessons
 * were dropped on 2026-11-07 when the page switched from swing trading to spot buying.
 */
export async function buildTrackingContext(symbol?: string | null): Promise<string> {
  const bare = symbol ? bareSymbol(symbol) : null;
  return bare
    ? `## Coin đang phân tích: ${bare} (${pairOf(bare)})\nChỉ lên kế hoạch mua spot cho coin này, trừ khi người dùng hỏi coin khác.`
    : '## Chế độ quét danh sách\nGọi get_tracking_coins, lọc ra tối đa 3 coin đáng mua spot nhất (còn dư địa ≥ +30%, đang ở / gần vùng mua), phân tích chi tiết từng coin rồi đưa kế hoạch mua.';
}
