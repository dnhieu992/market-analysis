'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import type { ChartSample } from '@web/shared/api/types';

import { fmtDate, fmtPrice, fmtZone } from './chart-lab-utils';
import s from './chart-lab.module.css';
import { ReasonDialog } from './reason-dialog';
import { TradeDialog } from './trade-dialog';

const api = createApiClient();

const byOpenDesc = (a: ChartSample, b: ChartSample) => (b.chartTime ?? b.createdAt).localeCompare(a.chartTime ?? a.createdAt);

/** /chart-lab: a journal of collected trades — Add opens the form, the table lists them with edit / delete. */
export function ChartLabView() {
  const [rows, setRows] = useState<ChartSample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChartSample | 'new' | null>(null);
  const [reading, setReading] = useState<ChartSample | null>(null);
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
    <article className="panel">
      <div className="table-header">
        <div>
          <h2>Chart Lab</h2>
          <p>
            {summary.total} lệnh · TP {summary.tp} · SL {summary.sl} · chưa đóng {summary.open}
            {summary.rate != null ? ` · tỉ lệ thắng ${summary.rate}%` : ''}
          </p>
        </div>
        <div className="table-actions">
          <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
            + Add
          </button>
        </div>
      </div>

      {error && <p className={s.error}>{error}</p>}

      {rows == null ? (
        <p className="tt-muted">Đang tải…</p>
      ) : rows.length === 0 ? (
        <p className="tt-muted">Chưa có lệnh nào. Bấm “+ Add” để thêm lệnh đầu tiên.</p>
      ) : (
        <div className="tt-wrap tt-card-wrap">
          <table className="tt tt-card">
            <thead>
              <tr>
                <th>Open date</th>
                <th>Closed date</th>
                <th>Coin</th>
                <th>Vùng vào</th>
                <th>TP</th>
                <th>SL</th>
                <th>Lý do</th>
                <th>Kết quả</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Open date">{fmtDate(r.chartTime)}</td>
                  <td data-label="Closed date">{fmtDate(r.closedAt)}</td>
                  <td data-label="Coin">
                    <strong>{r.symbol ?? '?'}</strong>
                  </td>
                  <td data-label="Vùng vào">{fmtZone(r)}</td>
                  <td data-label="TP">{fmtPrice(r.tpPrice)}</td>
                  <td data-label="SL">{fmtPrice(r.slPrice)}</td>
                  <td data-label="Lý do">
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => setReading(r)}>
                      Xem{r.images.length ? ` · ${r.images.length} ảnh` : ''}
                    </button>
                  </td>
                  <td data-label="Kết quả">
                    {r.result ? <span className={r.result === 'TP' ? s.badgeTp : s.badgeSl}>{r.result}</span> : <span className="tt-muted">chưa đóng</span>}
                  </td>
                  <td data-label="">
                    <div className={s.actions}>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(r)}>
                        Sửa
                      </button>
                      <button type="button" className={`btn btn--ghost btn--sm ${s.danger}`} onClick={() => setDeleting(r)}>
                        Xoá
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <TradeDialog sample={editing === 'new' ? null : editing} allTags={allTags} onSaved={saved} onClose={() => setEditing(null)} />}
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
      {deleting &&
        createPortal(
          <div className="dialog-backdrop" onClick={() => !busyDelete && setDeleting(null)}>
            <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
              <div className="dialog-header">
                <span className="dialog-title">Xoá lệnh</span>
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
          </div>,
          document.body,
        )}
    </article>
  );
}
