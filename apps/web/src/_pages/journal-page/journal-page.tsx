import { createServerApiClient } from '@web/shared/auth/api-auth';
import { TradingJournal } from '@web/widgets/trading-journal/trading-journal';
import type { TradingJournalEntry, TradingJournalRevision } from '@web/shared/api/types';

/** Same UTC-based "today" the editor defaults to, so the history panel matches on first paint. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function JournalPage() {
  const client = createServerApiClient();
  const entries = await client.fetchJournalEntries().catch(() => [] as TradingJournalEntry[]);
  const todayEntry = entries.find((e) => e.date === todayIso());
  const revisions = todayEntry
    ? await client.fetchJournalRevisions(todayEntry.id).catch(() => [] as TradingJournalRevision[])
    : [];

  return <TradingJournal initialEntries={entries} initialRevisions={revisions} />;
}
