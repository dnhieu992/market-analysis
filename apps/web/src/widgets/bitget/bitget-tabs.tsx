'use client';

import { useCallback, useState } from 'react';

import { BitgetHistoryFeed } from '@web/widgets/bitget-history/bitget-history-feed';
import { BitgetPositionsFeed } from '@web/widgets/bitget-positions/bitget-positions-feed';
import { BitgetSetupFeed, setupSymbols } from '@web/widgets/bitget/bitget-setup-feed';
import { BitgetAiChat } from '@web/widgets/bitget/bitget-ai-chat';
import { createApiClient } from '@web/shared/api/client';
import type { BitgetHistoryResponse, BitgetPositionsResponse } from '@web/shared/api/types';

const api = createApiClient();

const TAB_LABEL: Record<'positions' | 'history' | 'setup', string> = {
  positions: 'Vị thế đang mở',
  history: 'Lịch sử & PnL',
  setup: 'Setup',
};

export type BitgetTab = 'positions' | 'history' | 'setup';

type Props = {
  positions: BitgetPositionsResponse;
  history: BitgetHistoryResponse;
  initialTab?: BitgetTab;
};

/**
 * Merged Bitget dashboard: open positions + closed-trade history under one page,
 * switched by tabs instead of two separate routes. Each feed keeps its own
 * live refresh loop — mounting/unmounting on tab switch starts/stops it.
 */
export function BitgetTabs({ positions: initialPositions, history: initialHistory, initialTab = 'positions' }: Props) {
  const [tab, setTab] = useState<BitgetTab>(initialTab);
  // After an AI chat action runs on the exchange, refetch both snapshots and
  // remount the feeds on them so the change shows without waiting for a poll.
  const [positions, setPositions] = useState(initialPositions);
  const [history, setHistory] = useState(initialHistory);
  const [reloadKey, setReloadKey] = useState(0);
  const reloadAfterAction = useCallback(async () => {
    const [p, h] = await Promise.all([
      api.fetchBitgetPositions().catch(() => null),
      api.fetchBitgetHistory({ limit: 'all' }).catch(() => null),
    ]);
    if (p) setPositions(p);
    if (h) setHistory(h);
    setReloadKey((k) => k + 1);
  }, []);
  // Row counts shown next to each tab label. Seeded from the server snapshot so
  // they are right on first paint, then kept live by the mounted feed's
  // `onCount` — an unmounted tab keeps the last count it reported.
  const [counts, setCounts] = useState({
    positions: positions.positions.length,
    history: history.trades.length,
    setup: setupSymbols(history.trades).length,
  });

  const setPositionsCount = useCallback(
    (n: number) => setCounts((prev) => (prev.positions === n ? prev : { ...prev, positions: n })),
    [],
  );
  const setHistoryCount = useCallback(
    (n: number) => setCounts((prev) => (prev.history === n ? prev : { ...prev, history: n })),
    [],
  );
  const setSetupCount = useCallback(
    (n: number) => setCounts((prev) => (prev.setup === n ? prev : { ...prev, setup: n })),
    [],
  );

  return (
    <div className="page">
      <h1>Bitget · USDT Futures</h1>
      <div className="bg-tabs" role="tablist" aria-label="Bitget views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'positions'}
          className={`bg-tab ${tab === 'positions' ? 'bg-tab--active' : ''}`}
          onClick={() => setTab('positions')}
        >
          Vị thế đang mở <span className="bg-tab-count">({counts.positions})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={`bg-tab ${tab === 'history' ? 'bg-tab--active' : ''}`}
          onClick={() => setTab('history')}
        >
          Lịch sử &amp; PnL <span className="bg-tab-count">({counts.history})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'setup'}
          className={`bg-tab ${tab === 'setup' ? 'bg-tab--active' : ''}`}
          onClick={() => setTab('setup')}
        >
          Setup <span className="bg-tab-count">({counts.setup})</span>
        </button>
      </div>

      {tab === 'positions' ? (
        <BitgetPositionsFeed key={reloadKey} initial={positions} embedded onCount={setPositionsCount} />
      ) : tab === 'history' ? (
        <BitgetHistoryFeed key={reloadKey} initial={history} embedded onCount={setHistoryCount} />
      ) : (
        <BitgetSetupFeed
          key={reloadKey}
          history={history}
          positions={positions}
          embedded
          onCount={setSetupCount}
        />
      )}

      <BitgetAiChat tabLabel={TAB_LABEL[tab]} onActionDone={() => { void reloadAfterAction(); }} />
    </div>
  );
}
