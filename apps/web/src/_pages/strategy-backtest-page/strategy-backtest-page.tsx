import { createServerApiClient } from '@web/shared/auth/api-auth';
import { StrategyBacktestBoard } from '@web/widgets/strategy-backtest/strategy-backtest-board';
import { TradingJournal } from '@web/widgets/trading-journal/trading-journal';
import type {
  StrategyBacktestBoard as BoardData,
  TradingJournalEntry,
  TradingJournalRevision,
} from '@web/shared/api/types';

const EMPTY_BOARD: BoardData = { price: null, symbol: 'BTCUSDT', setups: [] };

/** Its own corpus, kept apart from the general /journal (see JournalService scopes). */
const JOURNAL_SCOPE = 'STRATEGY_BACKTEST';

const JOURNAL_SUBTITLE = (
  <>
    Ghi lại <b>quá trình phân tích &amp; ra quyết định setup mỗi ngày</b> — vì sao vào/không vào, đọc chart
    thế nào, theo dõi lệnh ra sao. Mỗi ngày một bản, mỗi lần lưu là một mốc trong <b>Lịch sử trong ngày</b>.
    Đây là kho dữ liệu để sau này Claude học và <b>bắt chước cách bạn phân tích &amp; theo dõi lệnh</b>.
  </>
);

/** Same UTC-based "today" the editor defaults to, so the history panel matches on first paint. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function StrategyBacktestPage() {
  const client = createServerApiClient();

  const [board, entries] = await Promise.all([
    client.fetchStrategyBacktestBoard().catch(() => EMPTY_BOARD),
    client.fetchJournalEntries(JOURNAL_SCOPE).catch(() => [] as TradingJournalEntry[]),
  ]);

  const todayEntry = entries.find((e) => e.date === todayIso());
  const revisions = todayEntry
    ? await client.fetchJournalRevisions(todayEntry.id).catch(() => [] as TradingJournalRevision[])
    : [];

  return (
    <>
      <StrategyBacktestBoard initialBoard={board} />
      <TradingJournal
        initialEntries={entries}
        initialRevisions={revisions}
        scope={JOURNAL_SCOPE}
        title="Nhật ký phân tích setup"
        subtitle={JOURNAL_SUBTITLE}
        placeholder="Hôm nay đọc chart thế nào? Vì sao vào/không vào setup nào, quản lý & theo dõi lệnh ra sao?"
      />
    </>
  );
}
