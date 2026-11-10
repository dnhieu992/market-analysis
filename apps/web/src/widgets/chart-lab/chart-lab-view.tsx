'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ChartSample } from '@web/shared/api/types';

import { fmtDate, fmtPrice, fmtZone } from './chart-lab-utils';
import s from './chart-lab.module.css';
import { ChartViewerDialog } from './chart-viewer-dialog';
import { ReasonDialog } from './reason-dialog';
import { TradeDialog } from './trade-dialog';

const api = createApiClient();

const byOpenDesc = (a: ChartSample, b: ChartSample) => (b.chartTime ?? b.createdAt).localeCompare(a.chartTime ?? a.createdAt);

function IconNotes() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ResultPill({ result }: { result: ChartSample['result'] }) {
  if (result === 'TP') return <span className="tt-side tt-side--long">TP</span>;
  if (result === 'SL') return <span className="tt-side tt-side--short">SL</span>;
  return <span className="tt-status-pill tt-status-pill--opening">Opening</span>;
}

/** /chart-lab: journal of collected trades — same shell / table / dialog styles as /trades. */
export function ChartLabView() {
  const [rows, setRows] = useState<ChartSample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChartSample | 'new' | null>(null);
  const [reading, setReading] = useState<ChartSample | null>(null);
  const [viewing, setViewing] = useState<ChartSample | null>(null);
  const [deleting, setDeleting] = useState<ChartSample | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await api.fetchChartSamples()).sort(byOpenDesc));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được danh sách');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allTags = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of rows ?? []) for (const t of r.tags) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [rows]);

  const summary = useMemo(() => {
    const list = rows ?? [];
    const tp = list.filter((r) => r.result === 'TP').length;
    const sl = list.filter((r) => r.result === 'SL').length;
    return { total: list.length, tp, sl, open: list.length - tp - sl, rate: tp + sl ? Math.round((tp / (tp + sl)) * 100) : null };
  }, [rows]);

  function saved(x: ChartSample) {
    setRows((prev) => [x, ...(prev ?? []).filter((r) => r.id !== x.id)].sort(byOpenDesc));
    setEditing(null);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      await api.deleteChartSample(deleting.id);
      setRows((prev) => (prev ?? []).filter((r) => r.id !== deleting.id));
      setDeleting(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xoá thất bại');
    } finally {
      setBusyDelete(false);
    }
  }

  return (
    <main className="dashboard-shell trades-shell">
      <article className="panel">
        <div className="table-header">
          <div>
            <h2>Chart Lab</h2>
            <p>{summary.total === 0 ? 'Chưa có lệnh nào.' : `${summary.total} lệnh · ${summary.open} chưa đóng`}</p>
          </div>
          <div className="table-actions">
            <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
              + Add Trade
            </button>
          </div>
        </div>

        {summary.total > 0 && (
          <div className="tt-summary-bar">
            <div className="tt-pnl-card">
              <span className="tt-pnl-card__label">Win rate</span>
              <span
                className={`tt-pnl-card__value ${summary.rate == null ? '' : summary.rate >= 50 ? 'tt-pnl-card__value--positive' : 'tt-pnl-card__value--negative'}`}
              >
                {summary.rate == null ? '–' : `${summary.rate}%`}
              </span>
              <span className="tt-pnl-card__note">Trên các lệnh đã đóng</span>
            </div>
            <div className="tt-pnl-card">
              <span className="tt-pnl-card__label">TP / SL</span>
              <span className="tt-pnl-card__value">
                <span className="tt-pnl-positive">{summary.tp}</span> / <span className="tt-pnl-negative">{summary.sl}</span>
              </span>
              <span className="tt-pnl-card__note">{summary.open} lệnh chưa đóng</span>
            </div>
          </div>
        )}

        {error && <p className="trade-form-error">{error}</p>}

        {rows == null ? (
          <p className="tt-muted" style={{ marginTop: 20 }}>
            Đang tải…
          </p>
        ) : rows.length === 0 ? (
          <p className="tt-muted" style={{ marginTop: 20 }}>
            Bấm “+ Add Trade” để thêm lệnh đầu tiên.
          </p>
        ) : (
          <div className="tt-wrap tt-card-wrap">
            <table className="tt tt-card">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Open</th>
                  <th>Close</th>
                  <th>Vùng vào</th>
                  <th>TP</th>
                  <th>SL</th>
                  <th>Chart</th>
                  <th>Lý do</th>
                  <th>Result</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Name" data-full="">
                      <div className="tt-name">
                        <button className="tt-symbol-btn" onClick={() => setEditing(r)}>
                          {r.symbol ?? '?'}
                        </button>
                      </div>
                    </td>
                    <td data-label="Open">{fmtDate(r.chartTime)}</td>
                    <td data-label="Close">{r.closedAt ? fmtDate(r.closedAt) : <span className="tt-muted">-</span>}</td>
                    <td data-label="Vùng vào">{fmtZone(r)}</td>
                    <td data-label="TP">{r.tpPrice != null ? <span className="tt-pnl-positive">{fmtPrice(r.tpPrice)}</span> : <span className="tt-muted">-</span>}</td>
                    <td data-label="SL">{r.slPrice != null ? <span className="tt-pnl-negative">{fmtPrice(r.slPrice)}</span> : <span className="tt-muted">-</span>}</td>
                    <td data-label="Chart">
                      {r.images[0] ? (
                        <button type="button" className={s.thumbBtn} onClick={() => setViewing(r)} aria-label="Xem chart" title="Xem chart">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.images[0].url} alt="" loading="lazy" />
                          {r.images.length > 1 && <span>+{r.images.length - 1}</span>}
                        </button>
                      ) : (
                        <span className="tt-muted">-</span>
                      )}
                    </td>
                    <td data-label="Lý do">
                      <button className="tt-btn tt-btn--notes" data-tooltip="Lý do vào lệnh" aria-label="Lý do vào lệnh" onClick={() => setReading(r)}>
                        <IconNotes />
                      </button>
                    </td>
                    <td data-label="Result">
                      <ResultPill result={r.result} />
                    </td>
                    <td data-label="Actions" data-full="">
                      <div className="tt-actions">
                        <button className="tt-btn tt-btn--journal" data-tooltip="Edit" aria-label="Edit" onClick={() => setEditing(r)}>
                          <IconEdit />
                        </button>
                        <button className="tt-btn tt-btn--danger" data-tooltip="Delete" aria-label="Delete" onClick={() => setDeleting(r)}>
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

      {editing && <TradeDialog sample={editing === 'new' ? null : editing} allTags={allTags} onSaved={saved} onClose={() => setEditing(null)} />}
      {viewing && <ChartViewerDialog sample={viewing} onClose={() => setViewing(null)} />}
      {reading && (
        <ReasonDialog
          sample={reading}
          onClose={() => setReading(null)}
          onEdit={() => {
            setEditing(reading);
            setReading(null);
          }}
        />
      )}
      {deleting && (
        <div className="dialog-backdrop" onClick={() => !busyDelete && setDeleting(null)}>
          <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <span className="dialog-title">Delete Trade</span>
              <button className="dialog-close" onClick={() => setDeleting(null)} aria-label="Close" disabled={busyDelete}>
                ✕
              </button>
            </div>
            <div className="dialog-body">
              <p className="dialog-confirm-text">
                Xoá lệnh <strong>{deleting.symbol ?? '?'}</strong> mở {fmtDate(deleting.chartTime)}? Ảnh đính kèm cũng bị xoá.
              </p>
              <div className="dialog-confirm-actions">
                <button type="button" className="btn btn--secondary" onClick={() => setDeleting(null)} disabled={busyDelete}>
                  Huỷ
                </button>
                <button type="button" className="btn btn--danger" onClick={() => void confirmDelete()} disabled={busyDelete}>
                  {busyDelete ? 'Đang xoá…' : 'Xoá'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
