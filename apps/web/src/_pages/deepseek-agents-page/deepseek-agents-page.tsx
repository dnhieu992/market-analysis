import { createServerApiClient } from '@web/shared/auth/api-auth';
import { BtcDaytradeAgent } from '@web/widgets/deepseek/btc-daytrade-agent';
import type {
  DeepseekBtcDaytrade,
  DeepseekBtcDaytradeHistoryItem,
  DeepseekStatus,
} from '@web/shared/api/types';

/**
 * Falls back to "not configured" so the page still renders (and explains itself)
 * when the API is unreachable — the same contract the exchange pages use.
 */
const UNKNOWN_STATUS: DeepseekStatus = { configured: false, model: 'deepseek-v4-pro' };

/**
 * Status, today's stored analysis and the daily log, in one round of SSR.
 *
 * Loading today's record here is what makes re-opening the page free: the
 * analysis was already paid for in tokens this morning, so it should come back
 * without pressing Analyze again.
 */
async function loadPage(): Promise<{
  status: DeepseekStatus;
  today: DeepseekBtcDaytrade | null;
  history: DeepseekBtcDaytradeHistoryItem[];
}> {
  const api = createServerApiClient();
  const [status, today, history] = await Promise.all([
    api.fetchDeepseekStatus().catch(() => UNKNOWN_STATUS),
    api.fetchDeepseekBtcDaytradeToday().catch(() => null),
    api.fetchDeepseekBtcDaytradeHistory().catch(() => []),
  ]);
  return { status, today, history };
}

export default async function DeepseekAgentsPage() {
  const { status, today, history } = await loadPage();

  return (
    <div className="page ds-page">
      <h1>DeepSeek Agents</h1>
      <p className="ds-page-intro">
        Agent chạy trên DeepSeek. Dữ liệu thật được lấy trước rồi mới hỏi model — model không có dữ
        liệu thị trường của riêng nó, nên toàn bộ số liệu nó được đưa luôn hiển thị kèm để đối chiếu.
        Mỗi ngày lưu một bản phân tích; bấm lại trong ngày sẽ ghi đè bản ghi của ngày đó.
      </p>

      <BtcDaytradeAgent status={status} initial={today} history={history} />
    </div>
  );
}
