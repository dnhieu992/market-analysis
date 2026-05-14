'use client';

import { useState } from 'react';

import type { DcaPlanItem } from '@web/shared/api/types';
import { createApiClient } from '@web/shared/api/client';
import { ExecuteModal } from './execute-modal';
import { AddEditItemModal } from './add-edit-item-modal';

type PlanItemsTableProps = {
  planId: string;
  items: DcaPlanItem[];
  coin: string;
  onRefresh: () => Promise<void>;
};

const api = createApiClient();

function sourceBadge(item: DcaPlanItem): string {
  if (item.source === 'user') return 'user';
  if (item.userModified) return 'llm ✎';
  return 'llm';
}

export function PlanItemsTable({ planId, items, coin, onRefresh }: PlanItemsTableProps) {
  const [executeItem, setExecuteItem] = useState<DcaPlanItem | null>(null);
  const [editItem, setEditItem] = useState<DcaPlanItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const handleSkip = async (itemId: string) => {
    await api.skipDcaPlanItem(planId, itemId);
    await onRefresh();
  };

  const handleDelete = async (itemId: string) => {
    await api.deleteDcaPlanItem(planId, itemId);
    await onRefresh();
  };

  return (
    <div className="dca-items">
      <table className="dca-items-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Target Price</th>
            <th>Amount</th>
            <th>Note</th>
            <th>Source</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={`dca-item dca-item--${item.status}`}>
              <td data-label="Type">
                <span className={`dca-type dca-type--${item.type}`}>{item.type.toUpperCase()}</span>
              </td>
              <td data-label="Target">${item.targetPrice.toLocaleString()}</td>
              <td data-label="Amount">
                {item.type === 'buy'
                  ? `$${item.suggestedAmount.toLocaleString()}`
                  : `${item.suggestedAmount} ${coin}`}
              </td>
              <td data-label="Note">{item.note || '—'}</td>
              <td data-label="Source">
                <span className="dca-source-badge">{sourceBadge(item)}</span>
              </td>
              <td data-label="Status">{item.status}</td>
              <td data-label="Actions">
                {item.status === 'pending' && (
                  <div className="dca-item-actions">
                    <button onClick={() => setExecuteItem(item)} title="Execute">✓</button>
                    <button onClick={() => setEditItem(item)} title="Edit">✎</button>
                    <button onClick={() => handleSkip(item.id)} title="Skip">⏭</button>
                    <button onClick={() => handleDelete(item.id)} title="Delete">✕</button>
                  </div>
                )}
                {item.status === 'executed' && (
                  <span title={`Executed at $${item.executedPrice}`}>✓ ${item.executedPrice?.toLocaleString()}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="dca-add-item-btn" onClick={() => setShowAdd(true)}>+ Add item</button>

      {executeItem && (
        <ExecuteModal
          item={executeItem}
          coin={coin}
          planId={planId}
          onClose={() => setExecuteItem(null)}
          onDone={async () => { setExecuteItem(null); await onRefresh(); }}
        />
      )}

      {(editItem || showAdd) && (
        <AddEditItemModal
          item={editItem}
          planId={planId}
          onClose={() => { setEditItem(null); setShowAdd(false); }}
          onDone={async () => { setEditItem(null); setShowAdd(false); await onRefresh(); }}
        />
      )}
    </div>
  );
}
