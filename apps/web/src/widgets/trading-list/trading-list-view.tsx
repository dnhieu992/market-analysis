'use client';

import { useCallback, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type {
  BitgetHistoryResponse,
  BitgetPositionsResponse,
  MexcHistoryResponse,
  MexcPositionsResponse,
} from '@web/shared/api/types';
import type { ExchangeFilter } from './exchanges';
import { TradingListAiChat } from './trading-list-ai-chat';
import { TradingListFeed, tradingListSymbols } from './trading-list-feed';
import { TradingListHistory } from './trading-list-history';
import { TradingListPositions } from './trading-list-positions';

import styles from './trading-list.module.css';

const api = createApiClient();

type Tab = 'positions' | 'history' | 'setup';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'positions', label: 'Vị thế đang mở' },
  { id: 'history', label: 'Lịch sử & PnL' },
  { id: 'setup', label: 'Setup' },
];

type Props = {
  bitgetPositions: BitgetPositionsResponse;
  bitgetHistory: BitgetHistoryResponse;
  mexcPositions: MexcPositionsResponse;
  mexcHistory: MexcHistoryResponse;
};

/**
 * /trading-list: Bitget + MEXC under the same three tabs as /bitget and /mexc
 * (Vị thế · Lịch sử · Setup). Each tab keeps its own exchange filter; the
 * shared AI chat opens from the floating AI button.
 */
export function TradingListView(props: Props) {
  const [snap, setSnap] = useState(props);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>('positions');
  const [filters, setFilters] = useState<Record<Tab, ExchangeFilter>>({ positions: 'all', history: 'all', setup: 'all' });
  // Seeded from the server snapshot, then kept live by the mounted tab's `onCount`.
  const [counts, setCounts] = useState<Record<Tab, number>>(() => ({
    positions: props.bitgetPositions.positions.length + props.mexcPositions.positions.length,
    history: props.bitgetHistory.trades.length + props.mexcHistory.trades.length,
    setup: tradingListSymbols([...props.bitgetHistory.trades, ...props.mexcHistory.trades]).length,
  }));

  const onPositionsCount = useCallback(
    (n: number) => setCounts((prev) => (prev.positions === n ? prev : { ...prev, positions: n })),
    [],
  );
  const onHistoryCount = useCallback(
    (n: number) => setCounts((prev) => (prev.history === n ? prev : { ...prev, history: n })),
    [],
  );
  const onSetupCount = useCallback(
    (n: number) => setCounts((prev) => (prev.setup === n ? prev : { ...prev, setup: n })),
    [],
  );
  const setFilter = (id: Tab) => (next: ExchangeFilter) => setFilters((prev) => ({ ...prev, [id]: next }));

  // After a card runs on an exchange, refetch the snapshots and remount the tabs on them.
  const reloadAfterAction = useCallback(async () => {
    const [bp, mp, bh, mh] = await Promise.all([
      api.fetchBitgetPositions().catch(() => null),
      api.fetchMexcPositions().catch(() => null),
      api.fetchBitgetHistory({ limit: 'all' }).catch(() => null),
      api.fetchMexcHistory({ limit: 500 }).catch(() => null),
    ]);
    setSnap((prev) => ({
      ...prev,
      ...(bp ? { bitgetPositions: bp } : {}),
      ...(mp ? { mexcPositions: mp } : {}),
      ...(bh ? { bitgetHistory: bh } : {}),
      ...(mh ? { mexcHistory: mh } : {}),
    }));
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <div className={`page ${styles.page}`}>
      <h1>Trading List · Bitget + MEXC</h1>
      <div className="bg-tabs" role="tablist" aria-label="Trading List views">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`bg-tab ${tab === id ? 'bg-tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label} <span className="bg-tab-count">({counts[id]})</span>
          </button>
        ))}
      </div>

      {tab === 'positions' ? (
        <TradingListPositions
          key={reloadKey}
          bitgetPositions={snap.bitgetPositions}
          mexcPositions={snap.mexcPositions}
          filter={filters.positions}
          onFilterChange={setFilter('positions')}
          onCount={onPositionsCount}
        />
      ) : tab === 'history' ? (
        <TradingListHistory
          key={reloadKey}
          bitgetHistory={snap.bitgetHistory}
          mexcHistory={snap.mexcHistory}
          filter={filters.history}
          onFilterChange={setFilter('history')}
          onCount={onHistoryCount}
        />
      ) : (
        <TradingListFeed
          key={reloadKey}
          bitgetHistory={snap.bitgetHistory}
          mexcHistory={snap.mexcHistory}
          bitgetPositions={snap.bitgetPositions}
          mexcPositions={snap.mexcPositions}
          filter={filters.setup}
          onFilterChange={setFilter('setup')}
          onCount={onSetupCount}
        />
      )}

      <TradingListAiChat onActionDone={() => { void reloadAfterAction(); }} />
    </div>
  );
}
