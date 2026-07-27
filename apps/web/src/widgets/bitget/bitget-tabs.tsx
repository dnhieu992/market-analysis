'use client';

import { useCallback, useState } from 'react';

import { BitgetHistoryFeed } from '@web/widgets/bitget-history/bitget-history-feed';
import { BitgetPositionsFeed } from '@web/widgets/bitget-positions/bitget-positions-feed';
import { BitgetSetupFeed, setupSymbols } from '@web/widgets/bitget/bitget-setup-feed';
import type { BitgetHistoryResponse, BitgetPositionsResponse } from '@web/shared/api/types';

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
export function BitgetTabs({ positions, history, initialTab = 'positions' }: Props) {
  const [tab, setTab] = useState<BitgetTab>(initialTab);
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
        <BitgetPositionsFeed initial={positions} embedded onCount={setPositionsCount} />
      ) : tab === 'history' ? (
        <BitgetHistoryFeed initial={history} embedded onCount={setHistoryCount} />
      ) : (
        <BitgetSetupFeed
          history={history}
          positions={positions}
          embedded
          onCount={setSetupCount}
        />
      )}
    </div>
  );
}
