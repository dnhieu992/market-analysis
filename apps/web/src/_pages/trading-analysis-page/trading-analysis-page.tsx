import { createServerApiClient } from '@web/shared/auth/api-auth';
import { TradingJournal } from '@web/widgets/trading-journal/trading-journal';
import type { TradingJournalEntry, TradingJournalRevision } from '@web/shared/api/types';

// Kept as its own corpus, distinct from the general /journal (see JournalService scopes).
// The value stays 'STRATEGY_BACKTEST' so notes written before this page was renamed are preserved.
const JOURNAL_SCOPE = 'STRATEGY_BACKTEST';

const JOURNAL_SUBTITLE = (
  <>
    Ghi lại <b>quá trình phân tích &amp; ra quyết định giao dịch mỗi ngày</b> — đọc chart thế nào, vì sao
    vào/không vào lệnh, quản lý &amp; theo dõi lệnh ra sao. Mỗi ngày một bản, mỗi lần lưu là một mốc trong{' '}
    <b>Lịch sử trong ngày</b>. Đây là kho dữ liệu để sau này Claude học và{' '}
    <b>bắt chước cách bạn phân tích &amp; theo dõi lệnh</b>.
  </>
);

/** Same UTC-based "today" the editor defaults to, so the history panel matches on first paint. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function TradingAnalysisPage() {
  const client = createServerApiClient();

  const entries = await client
    .fetchJournalEntries(JOURNAL_SCOPE)
    .catch(() => [] as TradingJournalEntry[]);

  const todayEntry = entries.find((e) => e.date === todayIso());
  const revisions = todayEntry
    ? await client.fetchJournalRevisions(todayEntry.id).catch(() => [] as TradingJournalRevision[])
    : [];

  return (
    <TradingJournal
      initialEntries={entries}
      initialRevisions={revisions}
      scope={JOURNAL_SCOPE}
      title="Trading Analysis"
      subtitle={JOURNAL_SUBTITLE}
      placeholder="Hôm nay đọc chart thế nào? Vì sao vào/không vào lệnh nào, quản lý & theo dõi lệnh ra sao?"
    />
  );
}
