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

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function sourceBadge(item: DcaPlanItem): string {
  if (item.source === 'user') return 'user';
  if (item.userModified) return 'llm ✎';
  return 'llm';
}

function IconCheck() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  );
}

function IconSkip() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M4.555 5.168A1 1 0 003 6v8a1 1 0 001.555.832L10 11.202V14a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4A1 1 0 0010 6v2.798L4.555 5.168z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function StatusPill({ status }: { status: DcaPlanItem['status'] }) {
  const cls =
    status === 'executed' ? 'tt-status-pill tt-status-pill--closed' :
    status === 'skipped' ? 'tt-status-pill' :
    'tt-status-pill tt-status-pill--opening';
  return <span className={cls}>{status}</span>;
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
    <div>
      <div className="tt-wrap">
        <table className="tt">
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
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="tt-muted" style={{ textAlign: 'center', padding: '1.25rem' }}>
                  No plan items yet.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.id} style={{ opacity: item.status === 'skipped' ? 0.45 : 1 }}>
                <td data-label="Type">
                  <span style={{
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    color: item.type === 'buy' ? '#16a34a' : '#dc2626'
                  }}>
                    {item.type.toUpperCase()}
                  </span>
                </td>
                <td data-label="Target Price">{formatUsd(item.targetPrice)}</td>
                <td data-label="Amount">
                  {item.type === 'buy'
                    ? formatUsd(item.suggestedAmount)
                    : `${item.suggestedAmount} ${coin}`}
                </td>
                <td data-label="Note" className="tt-muted" style={{ maxWidth: 200, fontSize: '0.82rem' }}>
                  {item.note || '—'}
                </td>
                <td data-label="Source">
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: 6,
                    background: 'rgba(0,0,0,0.07)',
                    color: 'var(--muted)'
                  }}>
                    {sourceBadge(item)}
                  </span>
                </td>
                <td data-label="Status">
                  <StatusPill status={item.status} />
                </td>
                <td data-label="Actions">
                  {item.status === 'pending' ? (
                    <div className="tt-actions">
                      <button
                        className="tt-btn tt-btn--success"
                        onClick={() => setExecuteItem(item)}
                        data-tooltip="Execute"
                        aria-label="Execute"
                      >
                        <IconCheck />
                      </button>
                      <button
                        className="tt-btn"
                        onClick={() => setEditItem(item)}
                        data-tooltip="Edit"
                        aria-label="Edit"
                      >
                        <IconEdit />
                      </button>
                      <button
                        className="tt-btn"
                        onClick={() => handleSkip(item.id)}
                        data-tooltip="Skip"
                        aria-label="Skip"
                      >
                        <IconSkip />
                      </button>
                      <button
                        className="tt-btn tt-btn--danger"
                        onClick={() => handleDelete(item.id)}
                        data-tooltip="Delete"
                        aria-label="Delete"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  ) : item.status === 'executed' ? (
                    <span className="tt-muted" style={{ fontSize: '0.82rem' }}>
                      {item.executedPrice != null ? formatUsd(item.executedPrice) : '—'}
                    </span>
                  ) : (
                    <span className="tt-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12 }}>
        <button className="btn btn--secondary" onClick={() => setShowAdd(true)}>+ Add item</button>
      </div>

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
