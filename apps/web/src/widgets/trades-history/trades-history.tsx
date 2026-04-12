'use client';

import { useState } from 'react';

import { TradeForm } from '@web/features/create-trade/create-trade-form';
import { CreateMultipleTradesForm } from '@web/features/create-trade/create-multiple-trades-form';
import type { DashboardOrder } from '@web/shared/api/types';

import { TradesTable } from './trades-table';

type TradesHistoryProps = Readonly<{
  orders: DashboardOrder[];
}>;

export function TradesHistory({ orders }: TradesHistoryProps) {
  const [singleOpen, setSingleOpen] = useState(false);
  const [multiOpen, setMultiOpen] = useState(false);

  return (
    <main className="dashboard-shell trades-shell">
      <TradesTable
        orders={orders}
        onAddTrade={() => setSingleOpen(true)}
        onAddMultiple={() => setMultiOpen(true)}
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
