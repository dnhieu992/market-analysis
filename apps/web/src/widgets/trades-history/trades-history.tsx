'use client';

import { useState } from 'react';

import { TradeForm } from '@web/features/create-trade/create-trade-form';
import type { DashboardOrder } from '@web/shared/api/types';

import { TradesTable } from './trades-table';

type TradesHistoryProps = Readonly<{
  orders: DashboardOrder[];
}>;

export function TradesHistory({ orders }: TradesHistoryProps) {
  const [open, setOpen] = useState(false);

  return (
    <main className="dashboard-shell trades-shell">
      <TradesTable orders={orders} onAddTrade={() => setOpen(true)} />

      {open && (
        <div className="dialog-backdrop" onClick={() => setOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Add Manual Trade</span>
              <button className="dialog-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <TradeForm onSubmitted={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
