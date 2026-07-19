'use client';

import { useState } from 'react';

import { BitgetHistoryFeed } from '@web/widgets/bitget-history/bitget-history-feed';
import { BitgetPositionsFeed } from '@web/widgets/bitget-positions/bitget-positions-feed';
import { BitgetSetupFeed } from '@web/widgets/bitget/bitget-setup-feed';
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
          Vị thế đang mở
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={`bg-tab ${tab === 'history' ? 'bg-tab--active' : ''}`}
          onClick={() => setTab('history')}
        >
          Lịch sử &amp; PnL
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'setup'}
          className={`bg-tab ${tab === 'setup' ? 'bg-tab--active' : ''}`}
          onClick={() => setTab('setup')}
        >
          Setup
        </button>
      </div>

      {tab === 'positions' ? (
        <BitgetPositionsFeed initial={positions} embedded />
      ) : tab === 'history' ? (
        <BitgetHistoryFeed initial={history} embedded />
      ) : (
        <BitgetSetupFeed history={history} positions={positions} embedded />
      )}
    </div>
  );
}
