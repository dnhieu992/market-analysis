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
        setError(err instanceof Error ? err.message : 'Failed');
      }
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? 'Edit Item' : 'Add Item'}</h3>
        <form onSubmit={handleSubmit}>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as 'buy' | 'sell')}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <label>
            Target Price (USD)
            <input type="number" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} required min="0" step="any" />
          </label>
          <label>
            Amount {type === 'buy' ? '(USD)' : '(Coin)'}
            <input type="number" value={suggestedAmount} onChange={(e) => setSuggestedAmount(e.target.value)} required min="0" step="any" />
          </label>
          <label>
            Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={isPending}>{isPending ? 'Saving...' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
