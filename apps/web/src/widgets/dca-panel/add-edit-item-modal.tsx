'use client';

import { useState, useTransition } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { DcaPlanItem } from '@web/shared/api/types';

type AddEditItemModalProps = {
  item: DcaPlanItem | null; // null = add mode
  planId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
};

const api = createApiClient();

export function AddEditItemModal({ item, planId, onClose, onDone }: AddEditItemModalProps) {
  const isEdit = item !== null;
  const [type, setType] = useState<'buy' | 'sell'>(item?.type ?? 'buy');
  const [targetPrice, setTargetPrice] = useState(item ? String(item.targetPrice) : '');
  const [suggestedAmount, setSuggestedAmount] = useState(item ? String(item.suggestedAmount) : '');
  const [note, setNote] = useState(item?.note ?? '');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (isEdit) {
          await api.editDcaPlanItem(planId, item.id, {
            type,
            targetPrice: Number(targetPrice),
            suggestedAmount: Number(suggestedAmount),
            note: note || undefined
          });
        } else {
          await api.addDcaPlanItem(planId, {
            type,
            targetPrice: Number(targetPrice),
            suggestedAmount: Number(suggestedAmount),
            note: note || undefined
          });
        }
        await onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save');
      }
    });
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">{isEdit ? 'Edit Plan Item' : 'Add Plan Item'}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="dialog-body">
          <form className="trade-form" onSubmit={handleSubmit}>
            {/* Buy / Sell tabs */}
            <div className="tx-type-tabs">
              <button
                type="button"
                className={`tx-type-tab${type === 'buy' ? ' tx-type-tab--buy' : ''}`}
                onClick={() => setType('buy')}
              >
                Buy
              </button>
              <button
                type="button"
                className={`tx-type-tab${type === 'sell' ? ' tx-type-tab--sell' : ''}`}
                onClick={() => setType('sell')}
              >
                Sell
              </button>
            </div>

            <label className="trade-field">
              <span>Target Price (USD)</span>
              <input
                type="number"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                required
                min="0"
                step="any"
                placeholder="95000"
              />
            </label>
            <label className="trade-field">
              <span>Amount ({type === 'buy' ? 'USD' : 'Coin qty'})</span>
              <input
                type="number"
                value={suggestedAmount}
                onChange={(e) => setSuggestedAmount(e.target.value)}
                required
                min="0"
                step="any"
                placeholder={type === 'buy' ? '500' : '0.005'}
              />
            </label>
            <label className="trade-field trade-field-wide">
              <span>Note (optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Reason for this zone…"
              />
            </label>
            {error && <p className="trade-form-error">{error}</p>}
            <button type="submit" className="trade-submit" disabled={isPending}>
              {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Item'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
