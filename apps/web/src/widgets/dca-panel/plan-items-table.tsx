'use client';

import { Fragment, useState } from 'react';

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

function ProbabilityBadge({ probability }: { probability: number | null }) {
  if (probability === null) return null;
  const level = probability >= 70 ? 'high' : probability >= 40 ? 'med' : 'low';
  const colors: Record<'high' | 'med' | 'low', { bg: string; color: string }> = {
    high: { bg: 'rgba(22,163,74,0.12)', color: '#16a34a' },
    med: { bg: 'rgba(202,138,4,0.12)', color: '#b45309' },
    low: { bg: 'rgba(220,38,38,0.12)', color: '#dc2626' }
  };
  const { bg, color } = colors[level];
  return (
    <span style={{
      display: 'inline-block',
      fontSize: '0.75rem',
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 6,
      background: bg,
      color
    }}>
      {probability}%
    </span>
  );
}

function StatusPill({ status }: { status: DcaPlanItem['status'] }) {
  const cls =
    status === 'executed' ? 'tt-status-pill tt-status-pill--closed' :
    status === 'skipped' ? 'tt-status-pill' :
    'tt-status-pill tt-status-pill--opening';
  return <span className={cls}>{status}</span>;
}

function ZoneTable({
  items,
  coin,
  planId,
  type,
  onRefresh
}: {
  items: DcaPlanItem[];
  coin: string;
  planId: string;
  type: 'buy' | 'sell';
  onRefresh: () => Promise<void>;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [executeItem, setExecuteItem] = useState<DcaPlanItem | null>(null);
  const [editItem, setEditItem] = useState<DcaPlanItem | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSkip = async (itemId: string) => {
    setLoadingId(itemId);
    setInlineError(null);
    try {
      await api.skipDcaPlanItem(planId, itemId);
      await onRefresh();
    } catch {
      setInlineError('Failed to skip item');
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (itemId: string) => {
    setLoadingId(itemId);
    setInlineError(null);
    try {
      await api.deleteDcaPlanItem(planId, itemId);
      await onRefresh();
    } catch {
      setInlineError('Failed to delete item');
    } finally {
      setLoadingId(null);
    }
  };

  if (items.length === 0) {
    return (
      <p className="tt-muted" style={{ padding: '0.4rem 0', fontSize: '0.85rem' }}>
        No {type} zones.
      </p>
    );
  }

  return (
    <>
      <div className="tt-wrap">
        <table className="tt">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Price</th>
              <th>{type === 'buy' ? 'USD Amount' : `${coin} Amount`}</th>
              <th>Probability</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <Fragment key={item.id}>
                <tr
                  style={{
                    opacity: item.status === 'skipped' ? 0.45 : 1,
                    cursor: item.note ? 'pointer' : 'default'
                  }}
                  onClick={() => item.note && toggleExpand(item.id)}
                >
                  <td data-label="#" style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                    {idx + 1}
                  </td>
                  <td data-label="Price" style={{ fontWeight: 600 }}>
                    {formatUsd(item.targetPrice)}
                  </td>
                  <td data-label="Amount">
                    {type === 'buy'
                      ? formatUsd(item.suggestedAmount)
                      : `${item.suggestedAmount} ${coin}`}
                  </td>
                  <td data-label="Probability">
                    <ProbabilityBadge probability={item.probability} />
                  </td>
                  <td data-label="Status">
                    <StatusPill status={item.status} />
                  </td>
                  <td data-label="Actions" onClick={(e) => e.stopPropagation()}>
                    {item.status === 'pending' ? (
                      <div className="tt-actions">
                        <button
                          className="tt-btn tt-btn--success"
                          onClick={() => setExecuteItem(item)}
                          aria-label="Execute"
                          data-tooltip="Execute"
                        >
                          <IconCheck />
                        </button>
                        <button
                          className="tt-btn"
                          onClick={() => setEditItem(item)}
                          aria-label="Edit"
                          data-tooltip="Edit"
                        >
                          <IconEdit />
                        </button>
                        <button
                          className="tt-btn"
                          onClick={() => handleSkip(item.id)}
                          aria-label="Skip"
                          data-tooltip="Skip"
                          disabled={loadingId === item.id}
                        >
                          <IconSkip />
                        </button>
                        <button
                          className="tt-btn tt-btn--danger"
                          onClick={() => handleDelete(item.id)}
                          aria-label="Delete"
                          data-tooltip="Delete"
                          disabled={loadingId === item.id}
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
                {expandedIds.has(item.id) && item.note && (
                  <tr onClick={(e) => e.stopPropagation()}>
                    <td
                      colSpan={6}
                      style={{
                        padding: '0.5rem 1rem 0.75rem',
                        fontSize: '0.84rem',
                        color: 'var(--muted)',
                        lineHeight: 1.65,
                        background: 'rgba(0,0,0,0.025)',
                        borderTop: 'none'
                      }}
                    >
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        marginRight: 8,
                        opacity: 0.6
                      }}>
                        {item.source === 'llm' ? (item.userModified ? 'llm ✎' : 'llm') : 'user'}
                      </span>
                      {item.note}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {inlineError && (
        <p className="trade-form-error" style={{ marginTop: 8, fontSize: '0.82rem' }}>{inlineError}</p>
      )}

      {executeItem && (
        <ExecuteModal
          item={executeItem}
          coin={coin}
          planId={planId}
          onClose={() => setExecuteItem(null)}
          onDone={async () => { setExecuteItem(null); await onRefresh(); }}
        />
      )}
      {editItem && (
        <AddEditItemModal
          item={editItem}
          planId={planId}
          onClose={() => setEditItem(null)}
          onDone={async () => { setEditItem(null); await onRefresh(); }}
        />
      )}
    </>
  );
}

export function PlanItemsTable({ planId, items, coin, onRefresh }: PlanItemsTableProps) {
  const [showAdd, setShowAdd] = useState(false);

  const buyItems = items.filter((i) => i.type === 'buy');
  const sellItems = items.filter((i) => i.type === 'sell');

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: '#16a34a',
          marginBottom: '0.6rem'
        }}>
          Buy Zones ({buyItems.length})
        </div>
        <ZoneTable items={buyItems} coin={coin} planId={planId} type="buy" onRefresh={onRefresh} />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <div style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: '#dc2626',
          marginBottom: '0.6rem'
        }}>
          Sell Zones ({sellItems.length})
        </div>
        <ZoneTable items={sellItems} coin={coin} planId={planId} type="sell" onRefresh={onRefresh} />
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn btn--secondary" onClick={() => setShowAdd(true)}>+ Add item</button>
      </div>

      {showAdd && (
        <AddEditItemModal
          item={null}
          planId={planId}
          onClose={() => setShowAdd(false)}
          onDone={async () => { setShowAdd(false); await onRefresh(); }}
        />
      )}
    </div>
  );
}
