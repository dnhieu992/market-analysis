'use client';

import { useCallback, useState } from 'react';

import { MexcHistoryFeed } from '@web/widgets/mexc-history/mexc-history-feed';
import { MexcPositionsFeed } from '@web/widgets/mexc-positions/mexc-positions-feed';
import { MexcSetupFeed, setupSymbols } from '@web/widgets/mexc/mexc-setup-feed';
import { MexcAiChat } from '@web/widgets/mexc/mexc-ai-chat';
import { createApiClient } from '@web/shared/api/client';
import type { MexcHistoryResponse, MexcPositionsResponse } from '@web/shared/api/types';

const api = createApiClient();

const TAB_LABEL: Record<'positions' | 'history' | 'setup', string> = {
  positions: 'Vị thế đang mở',
  history: 'Lịch sử & PnL',
  setup: 'Setup',
};

export type MexcTab = 'positions' | 'history' | 'setup';

type Props = {
  positions: MexcPositionsResponse;
  history: MexcHistoryResponse;
  initialTab?: MexcTab;
};

/**
 * Merged MEXC dashboard: open positions + closed-trade history under one page,
 * switched by tabs instead of two separate routes. Each feed keeps its own
 * live refresh loop — mounting/unmounting on tab switch starts/stops it.
 */
export function MexcTabs({ positions: initialPositions, history: initialHistory, initialTab = 'positions' }: Props) {
  const [tab, setTab] = useState<MexcTab>(initialTab);
  // After an AI chat action runs on the exchange, refetch both snapshots and
  // remount the feeds on them so the change shows without waiting for a poll.
  const [positions, setPositions] = useState(initialPositions);
  const [history, setHistory] = useState(initialHistory);
  const [reloadKey, setReloadKey] = useState(0);
  const reloadAfterAction = useCallback(async () => {
    const [p, h] = await Promise.all([
      api.fetchMexcPositions().catch(() => null),
      api.fetchMexcHistory({ limit: 200 }).catch(() => null),
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
      <h1>MEXC · USDT Futures</h1>
      <div className="bg-tabs" role="tablist" aria-label="MEXC views">
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
        <MexcPositionsFeed key={reloadKey} initial={positions} embedded onCount={setPositionsCount} />
      ) : tab === 'history' ? (
        <MexcHistoryFeed key={reloadKey} initial={history} embedded onCount={setHistoryCount} />
      ) : (
        <MexcSetupFeed
          key={reloadKey}
          history={history}
          positions={positions}
          embedded
          onCount={setSetupCount}
        />
      )}

      <MexcAiChat tabLabel={TAB_LABEL[tab]} onActionDone={() => { void reloadAfterAction(); }} />
    </div>
  );
}
