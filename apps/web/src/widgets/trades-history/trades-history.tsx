'use client';

import { useEffect, useState, useTransition } from 'react';

import { TradeForm } from '@web/features/create-trade/create-trade-form';
import { CreateMultipleTradesForm } from '@web/features/create-trade/create-multiple-trades-form';
import { CloseTradeForm } from '@web/features/close-trade/close-trade-form';
import { EditTradeForm } from '@web/features/edit-trade/edit-trade-form';
import { createApiClient } from '@web/shared/api/client';
import type { DashboardOrder } from '@web/shared/api/types';

import { TradesTable, NotesDialog } from './trades-table';
import { ChatbotWidget } from '@web/widgets/chatbot/chatbot-widget';

type TradesHistoryProps = Readonly<{
  orders: DashboardOrder[];
}>;

export function TradesHistory({ orders }: TradesHistoryProps) {
  const [singleOpen, setSingleOpen] = useState(false);
  const [multiOpen, setMultiOpen] = useState(false);
  const [closeTradeOrder, setCloseTradeOrder] = useState<DashboardOrder | null>(null);
  const [closeDefaultPrice, setCloseDefaultPrice] = useState<number | undefined>(undefined);
  const [editOrder, setEditOrder] = useState<DashboardOrder | null>(null);
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);
  const [notesOrder, setNotesOrder] = useState<DashboardOrder | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!closeTradeOrder) {
      setCloseDefaultPrice(undefined);
      return;
    }
    async function fetchCurrentPrice(symbol: string) {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`);
        const data = await res.json() as { price?: string };
        if (data.price) setCloseDefaultPrice(Number(data.price));
      } catch {
        // fallback: leave undefined so user types manually
      }
    }
    void fetchCurrentPrice(closeTradeOrder.symbol);
  }, [closeTradeOrder]);

  async function handleConfirmDelete() {
    if (!deleteOrderId) return;
    try {
      await createApiClient().deleteOrder(deleteOrderId);
      setDeleteOrderId(null);
      startTransition(() => { window.location.reload(); });
    } catch {
      // ignore — page will stay open so user can retry
    }
  }

  return (
    <main className="dashboard-shell trades-shell">
      <TradesTable
        orders={orders}
        onAddTrade={() => setSingleOpen(true)}
        onAddMultiple={() => setMultiOpen(true)}
        onCloseTrade={(order) => setCloseTradeOrder(order)}
        onEditTrade={(order) => setEditOrder(order)}
        onRemoveTrade={(orderId) => setDeleteOrderId(orderId)}
        onViewNotes={(order) => setNotesOrder(order)}
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
      {closeTradeOrder && (
        <div className="dialog-backdrop" onClick={() => setCloseTradeOrder(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Close Trade — {closeTradeOrder.symbol}</span>
              <button className="dialog-close" onClick={() => setCloseTradeOrder(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <CloseTradeForm
                orderId={closeTradeOrder.id}
                status="open"
                defaultClosePrice={closeDefaultPrice}
                entryPrice={closeTradeOrder.entryPrice}
                quantity={closeTradeOrder.quantity}
                side={closeTradeOrder.side}
                onSubmitted={() => setCloseTradeOrder(null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Edit trade dialog */}
      {editOrder && (
        <div className="dialog-backdrop" onClick={() => setEditOrder(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Edit Trade</span>
              <button className="dialog-close" onClick={() => setEditOrder(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <EditTradeForm order={editOrder} onSubmitted={() => setEditOrder(null)} />
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteOrderId && (
        <div className="dialog-backdrop" onClick={() => setDeleteOrderId(null)}>
          <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Delete Trade</span>
              <button className="dialog-close" onClick={() => setDeleteOrderId(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <p className="dialog-confirm-text">Are you sure you want to delete this trade? This action cannot be undone.</p>
              <div className="dialog-confirm-actions">
                <button className="btn btn--secondary" onClick={() => setDeleteOrderId(null)}>Cancel</button>
                <button className="btn btn--danger" onClick={handleConfirmDelete} disabled={isPending}>
                  {isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes & screenshots dialog */}
      {notesOrder && (
        <NotesDialog
          order={notesOrder}
          onClose={() => setNotesOrder(null)}
          onImageDeleted={(url) =>
            setNotesOrder((prev) =>
              prev ? { ...prev, images: (prev.images ?? []).filter((u) => u !== url) } : null
            )
          }
        />
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

      <ChatbotWidget pinned />
    </main>
  );
}
