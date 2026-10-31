'use client';

import { useCallback, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type {
  BitgetHistoryResponse,
  BitgetPositionsResponse,
  MexcHistoryResponse,
  MexcPositionsResponse,
} from '@web/shared/api/types';
import { TradingListAiChat } from './trading-list-ai-chat';
import { TradingListFeed } from './trading-list-feed';

import styles from './trading-list.module.css';

const api = createApiClient();

type Props = {
  bitgetPositions: BitgetPositionsResponse;
  bitgetHistory: BitgetHistoryResponse;
  mexcPositions: MexcPositionsResponse;
  mexcHistory: MexcHistoryResponse;
};

/**
 * /trading-list: the Bitget + MEXC coin list (setup, market/limit entries on
 * either exchange); the shared AI chat opens from the floating AI button. Open positions
 * and pending orders stay on /bitget and /mexc.
 */
export function TradingListView(props: Props) {
  const [snap, setSnap] = useState(props);
  const [reloadKey, setReloadKey] = useState(0);

  // After a card runs on an exchange, refetch the snapshots and remount the table on them.
  const reloadAfterAction = useCallback(async () => {
    const [bp, mp] = await Promise.all([
      api.fetchBitgetPositions().catch(() => null),
      api.fetchMexcPositions().catch(() => null),
    ]);
    setSnap((prev) => ({ ...prev, ...(bp ? { bitgetPositions: bp } : {}), ...(mp ? { mexcPositions: mp } : {}) }));
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <div className={`page ${styles.page}`}>
      <h1>Trading List · Bitget + MEXC</h1>
      <TradingListFeed
        key={reloadKey}
        bitgetHistory={snap.bitgetHistory}
        mexcHistory={snap.mexcHistory}
        bitgetPositions={snap.bitgetPositions}
        mexcPositions={snap.mexcPositions}
      />
      <TradingListAiChat onActionDone={() => { void reloadAfterAction(); }} />
    </div>
  );
}
