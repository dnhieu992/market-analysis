import { createServerApiClient } from '@web/shared/auth/api-auth';
import { TradingJournal } from '@web/widgets/trading-journal/trading-journal';
import type { TradingJournalEntry } from '@web/shared/api/types';

async function loadEntries(): Promise<TradingJournalEntry[]> {
  const client = createServerApiClient();
  return client.fetchJournalEntries().catch(() => [] as TradingJournalEntry[]);
}

export default async function JournalPage() {
  const entries = await loadEntries();
  return <TradingJournal initialEntries={entries} />;
}
