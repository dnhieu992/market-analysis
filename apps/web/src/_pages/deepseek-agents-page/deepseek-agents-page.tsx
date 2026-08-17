import { createServerApiClient } from '@web/shared/auth/api-auth';
import { MarketTodayAgent } from '@web/widgets/deepseek/market-today-agent';
import type { DeepseekStatus } from '@web/shared/api/types';

/**
 * Falls back to "not configured" so the page still renders (and explains itself)
 * when the API is unreachable — the same contract the exchange pages use.
 */
const UNKNOWN_STATUS: DeepseekStatus = { configured: false, model: 'deepseek-chat' };

async function loadStatus(): Promise<DeepseekStatus> {
  try {
    return await createServerApiClient().fetchDeepseekStatus();
  } catch {
    return UNKNOWN_STATUS;
  }
}

export default async function DeepseekAgentsPage() {
  const status = await loadStatus();

  return (
    <div className="page ds-page">
      <h1>DeepSeek Agents</h1>
      <p className="ds-page-intro">
        Các agent chạy trên DeepSeek. Mỗi agent tự lấy dữ liệu thật rồi mới hỏi model — model không
        có dữ liệu thị trường của riêng nó, nên phần số liệu luôn được hiển thị kèm để đối chiếu.
      </p>

      <MarketTodayAgent status={status} />
    </div>
  );
}
