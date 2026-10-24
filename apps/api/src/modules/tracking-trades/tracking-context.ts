import { createTrackingSetupRepository, TRACKING_ACTIVE_STATUSES } from '@app/db';

import { fmtPx, type Target } from './tracking-engine';
import { bareSymbol, pairOf } from './tracking-setup-factory';

export const TRACKING_SKILL_ID = 'tracking-swing';

const STATUS_VI: Record<string, string> = { PROPOSED: 'đề xuất', WATCHING: 'theo dõi', PENDING: 'chờ khớp', OPEN: 'đang mở' };

/**
 * Context appended to the tracking-swing prompt: the coin being analysed, setups already alive
 * (so Claude doesn't duplicate or contradict them), a short track record, and approved lessons.
 * Lessons only exist once a batch of closed setups was reviewed and approved by the user.
 */
export async function buildTrackingContext(symbol?: string | null): Promise<string> {
  const repo = createTrackingSetupRepository();
  const bare = symbol ? bareSymbol(symbol) : null;
  const [active, closed, lessons, config] = await Promise.all([
    repo.list({ ...(bare ? { symbol: bare } : {}), statuses: TRACKING_ACTIVE_STATUSES }, 100),
    repo.listClosed(),
    repo.approvedLessons(),
    repo.getConfig(),
  ]);

  const parts: string[] = [];
  parts.push(
    bare
      ? `## Coin đang phân tích: ${bare} (${pairOf(bare)})\nChỉ đề xuất setup cho coin này, trừ khi người dùng hỏi coin khác.`
      : '## Chế độ quét danh sách\nGọi get_tracking_coins, chọn tối đa 3 coin đáng chú ý nhất, phân tích chúng rồi đề xuất setup (nếu đạt chuẩn).',
  );
  parts.push(`1R = $${config.riskUsd} mỗi lệnh (khối lượng tự tính từ khoảng cách SL).`);

  const activeLines = active.map((s) => {
    const t = (s.targets as Target[]).map((x, i) => `TP${i + 1} ${fmtPx(x.price)}`).join(' ');
    return `- ${s.symbol} ${s.direction} ${s.orderType} @ ${fmtPx(s.entryPrice)} SL ${fmtPx(s.currentStop ?? s.stopLoss)} ${t} — ${STATUS_VI[s.status] ?? s.status}${s.setupType ? `, ${s.setupType}` : ''} (tạo ${s.createdAt.toISOString().slice(0, 10)})`;
  });
  parts.push(`## Setup đang có${bare ? ` của ${bare}` : ''}\n${activeLines.join('\n') || '(không có)'}`);

  const mine = bare ? closed.filter((s) => s.symbol === bare) : closed;
  if (mine.length) {
    const total = mine.reduce((a, s) => a + (s.rMultiple ?? 0), 0);
    const wins = mine.filter((s) => (s.rMultiple ?? 0) > 0).length;
    parts.push(`## Lệnh đã đóng${bare ? ` của ${bare}` : ''}: ${mine.length} lệnh, thắng ${wins}, tổng ${total.toFixed(2)}R.`);
  }

  if (lessons.length) {
    const text = lessons.map((l) => l.content ?? l.draft).join('\n\n---\n\n').slice(0, 8000);
    parts.push(`## Bài học đã duyệt từ các lệnh trước (áp dụng khi phân tích)\n${text}`);
  }
  return parts.join('\n\n');
}
