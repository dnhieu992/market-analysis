'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { CreateCompoundPortfolioForm } from '@web/features/create-compound-portfolio/create-compound-portfolio-form';
import { EditCompoundPortfolioForm } from '@web/features/edit-compound-portfolio/edit-compound-portfolio-form';
import { createApiClient } from '@web/shared/api/client';
import type { CompoundPortfolio } from '@web/shared/api/types';

type CompoundPortfoliosListProps = Readonly<{
  portfolios: CompoundPortfolio[];
}>;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function IconEdit() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

export function CompoundPortfoliosList({ portfolios }: CompoundPortfoliosListProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editPortfolio, setEditPortfolio] = useState<CompoundPortfolio | null>(null);
  const [deletePortfolioId, setDeletePortfolioId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleConfirmDelete() {
    if (!deletePortfolioId) return;
    try {
      await createApiClient().deleteCompoundPortfolio(deletePortfolioId);
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
            <h2>My Compound Portfolios</h2>
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
                      <Link href={`/compound-interest/${portfolio.id}`} className="tt-symbol-btn">
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
                          data-tooltip="Edit"
                        >
                          <IconEdit />
                        </button>
                        <button
                          className="tt-btn tt-btn--danger"
                          onClick={() => setDeletePortfolioId(portfolio.id)}
                          aria-label="Delete portfolio"
                          data-tooltip="Delete"
                        >
                          <IconTrash />
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

      {createOpen && (
        <div className="dialog-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">New Portfolio</span>
              <button className="dialog-close" onClick={() => setCreateOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <CreateCompoundPortfolioForm onSubmitted={() => setCreateOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {editPortfolio && (
        <div className="dialog-backdrop" onClick={() => setEditPortfolio(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Edit Portfolio</span>
              <button className="dialog-close" onClick={() => setEditPortfolio(null)} aria-label="Close">✕</button>
            </div>
            <div className="dialog-body">
              <EditCompoundPortfolioForm portfolio={editPortfolio} onSubmitted={() => setEditPortfolio(null)} />
            </div>
          </div>
        </div>
      )}

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
