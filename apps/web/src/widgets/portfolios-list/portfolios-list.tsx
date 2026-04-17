'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { CreatePortfolioForm } from '@web/features/create-portfolio/create-portfolio-form';
import { EditPortfolioForm } from '@web/features/edit-portfolio/edit-portfolio-form';
import { createApiClient } from '@web/shared/api/client';
import type { Portfolio } from '@web/shared/api/types';

type PortfoliosListProps = Readonly<{
  portfolios: Portfolio[];
}>;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function PortfoliosList({ portfolios }: PortfoliosListProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editPortfolio, setEditPortfolio] = useState<Portfolio | null>(null);
  const [deletePortfolioId, setDeletePortfolioId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleConfirmDelete() {
    if (!deletePortfolioId) return;
    try {
      await createApiClient().deletePortfolio(deletePortfolioId);
      setDeletePortfolioId(null);
      startTransition(() => { window.location.reload(); });
    } catch {
      // ignore — user can retry
    }
  }

  return (
    <main className="dashboard-shell trades-shell">
      <article className="panel">
        <div className="table-header">
          <div>
            <h2>My Portfolios</h2>
            <p>{portfolios.length === 0 ? 'No portfolios yet.' : `${portfolios.length} portfolio${portfolios.length === 1 ? '' : 's'}`}</p>
          </div>
          <div className="table-actions">
            <button className="btn btn--primary" onClick={() => setCreateOpen(true)}>+ New Portfolio</button>
          </div>
        </div>

        {portfolios.length > 0 && (
          <div className="tt-wrap">
            <table className="tt">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {portfolios.map((portfolio) => (
                  <tr key={portfolio.id}>
                    <td>
                      <Link href={`/portfolio/${portfolio.id}`} className="tt-symbol-btn">
                        {portfolio.name}
                      </Link>
                    </td>
                    <td className="tt-muted">{portfolio.description ?? '-'}</td>
                    <td className="tt-muted">{formatDate(portfolio.createdAt)}</td>
                    <td>
                      <div className="tt-actions">
                        <button
                          className="tt-btn"
                          onClick={() => setEditPortfolio(portfolio)}
                          aria-label="Edit portfolio"
                        >
                          Edit
                        </button>
                        <button
                          className="tt-btn tt-btn--danger"
                          onClick={() => setDeletePortfolioId(portfolio.id)}
                          aria-label="Delete portfolio"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {/* Create portfolio dialog */}
      {createOpen && (
        <div className="dialog-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">New Portfolio</span>
              <button className="dialog-close" onClick={() => setCreateOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <CreatePortfolioForm onSubmitted={() => setCreateOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Edit portfolio dialog */}
      {editPortfolio && (
        <div className="dialog-backdrop" onClick={() => setEditPortfolio(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Edit Portfolio</span>
              <button className="dialog-close" onClick={() => setEditPortfolio(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <EditPortfolioForm portfolio={editPortfolio} onSubmitted={() => setEditPortfolio(null)} />
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deletePortfolioId && (
        <div className="dialog-backdrop" onClick={() => setDeletePortfolioId(null)}>
          <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Delete Portfolio</span>
              <button className="dialog-close" onClick={() => setDeletePortfolioId(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <p className="dialog-confirm-text">Are you sure you want to delete this portfolio? All holdings and transactions will be removed.</p>
              <div className="dialog-confirm-actions">
                <button className="btn btn--secondary" onClick={() => setDeletePortfolioId(null)}>Cancel</button>
                <button className="btn btn--danger" onClick={handleConfirmDelete} disabled={isPending}>
                  {isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
