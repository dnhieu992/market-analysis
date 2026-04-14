'use client';

import { useState } from 'react';

import { TradeForm } from '@web/features/create-trade/create-trade-form';
import { CreateMultipleTradesForm } from '@web/features/create-trade/create-multiple-trades-form';
import { CloseTradeForm } from '@web/features/close-trade/close-trade-form';
import type { DashboardOrder } from '@web/shared/api/types';

import { TradesTable } from './trades-table';

type TradesHistoryProps = Readonly<{
  orders: DashboardOrder[];
}>;

export function TradesHistory({ orders }: TradesHistoryProps) {
  const [singleOpen, setSingleOpen] = useState(false);
  const [multiOpen, setMultiOpen] = useState(false);
  const [closeTradeOrderId, setCloseTradeOrderId] = useState<string | null>(null);

  return (
    <main className="dashboard-shell trades-shell">
      <TradesTable
        orders={orders}
        onAddTrade={() => setSingleOpen(true)}
        onAddMultiple={() => setMultiOpen(true)}
        onCloseTrade={(orderId) => setCloseTradeOrderId(orderId)}
      />

      {/* Single trade dialog */}
      {singleOpen && (
        <div className="dialog-backdrop" onClick={() => setSingleOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Add Manual Trade</span>
              <button className="dialog-close" onClick={() => setSingleOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <TradeForm onSubmitted={() => setSingleOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Close trade dialog */}
      {closeTradeOrderId && (
        <div className="dialog-backdrop" onClick={() => setCloseTradeOrderId(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Close Trade</span>
              <button className="dialog-close" onClick={() => setCloseTradeOrderId(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <CloseTradeForm orderId={closeTradeOrderId} status="open" onSubmitted={() => setCloseTradeOrderId(null)} />
            </div>
          </div>
        </div>
      )}

      {/* Multiple trades dialog */}
      {multiOpen && (
        <div className="dialog-backdrop" onClick={() => setMultiOpen(false)}>
          <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Add Multiple Orders</span>
              <button className="dialog-close" onClick={() => setMultiOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <CreateMultipleTradesForm onSubmitted={() => setMultiOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
