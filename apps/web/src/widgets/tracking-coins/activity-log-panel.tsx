'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';

import { createApiClient } from '@web/shared/api/client';
import { renderMarkdown } from '@web/shared/lib/markdown';
import type { TrackingCoinActivityLog } from '@web/shared/api/types';

// Lazy-load the TipTap editor so its bundle only loads when the tab is opened.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function fmtPrice(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

function fmtPct(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
}

/**
 * Activity logs tab for a tracked coin — the timeline model from the Bitget trade
 * journal, reduced to what a DCA position needs: manual markdown notes interleaved
 * with read-only system lines the API writes on each buy and on close. No time-based
 * tracking: nothing is logged unless the user buys, sells, or writes.
 */
export function ActivityLogPanel({ symbol }: { symbol: string }) {
  const api = useMemo(() => createApiClient(), []);

  const [logs, setLogs] = useState<TrackingCoinActivityLog[] | null>(null);
  const [content, setContent] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'formatting' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLogs(null);
    api
      .fetchCoinActivityLogs(symbol)
      .then((rows) => { if (alive) setLogs(rows); })
      .catch(() => { if (alive) { setLogs([]); setError('Không tải được nhật ký của coin này.'); } });
    return () => { alive = false; };
  }, [api, symbol]);

  const pendingPreviews = useMemo(
    () => pendingFiles.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    [pendingFiles],
  );

  const busy = phase !== 'idle';

  function resetEditor() {
    setContent('');
    setPendingFiles([]);
    setExistingImages([]);
    setEditingId(null);
    setWarning(null);
  }

  function onFilesPicked(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  }

  function editNote(note: TrackingCoinActivityLog) {
    setEditingId(note.id);
    setContent(note.content);
    setExistingImages(note.images);
    setPendingFiles([]);
    setWarning(null);
    setError(null);
  }

  async function save() {
    if (!content.trim() && pendingFiles.length === 0 && existingImages.length === 0) return;
    setError(null);
    setWarning(null);

    let finalContent = content;
    if (content.trim()) {
      setPhase('formatting');
      try {
        const formatted = await api.reformatJournal(content);
        if (formatted.trim()) finalContent = formatted;
      } catch {
        setWarning('Không format lại được (Claude lỗi) — đã lưu nguyên văn.');
      }
    }

    setPhase('saving');
    try {
      let images = existingImages;
      if (pendingFiles.length) {
        const urls = await api.uploadImages(pendingFiles, symbol);
        images = [...existingImages, ...urls];
      }

      if (editingId) {
        const updated = await api.updateCoinActivityLog(editingId, { content: finalContent, images });
        setLogs((prev) => (prev ?? []).map((n) => (n.id === updated.id ? updated : n)));
      } else {
        const created = await api.addCoinActivityLog(symbol, { content: finalContent, images });
        setLogs((prev) => [...(prev ?? []), created]);
      }
      resetEditor();
    } catch {
      setError('Lưu ghi chú thất bại. Thử lại sau.');
    } finally {
      setPhase('idle');
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Xoá ghi chú này?')) return;
    try {
      await api.deleteCoinActivityLog(id);
      setLogs((prev) => (prev ?? []).filter((n) => n.id !== id));
      if (editingId === id) resetEditor();
    } catch {
      setError('Xoá thất bại. Thử lại sau.');
    }
  }

  return (
    <div className="tc-activity">
      {error && <div className="bg-alert bg-alert--error">{error}</div>}
      {warning && <div className="bg-alert">{warning}</div>}

      {/* Timeline */}
      <div className="bgj-timeline tc-activity__timeline">
        {logs === null ? (
          <div className="ord-loading"><span className="ord-loading__spinner" /><span>Đang tải…</span></div>
        ) : logs.length === 0 ? (
          <p className="bgj-muted">
            Chưa có hoạt động nào. Log hệ thống tự ghi khi bạn gom một lớp hoặc đóng vị thế — hoặc viết
            ghi chú đầu tiên bên dưới.
          </p>
        ) : (
          <ul className="bgj-notes">
            {logs.map((n) => {
              const system = n.kind === 'system';
              const snap = n.snapshot;
              return (
                <li
                  key={n.id}
                  className={`bgj-note ${system ? 'bgj-note--system' : ''} ${editingId === n.id ? 'bgj-note--editing' : ''}`}
                >
                  <div className="bgj-note-head">
                    <span className="bgj-note-time">{fmtTime(n.createdAt)}</span>
                    {snap && !system && (
                      <span className="bgj-note-snap">
                        {snap.price != null && fmtPrice(snap.price)}
                        {snap.pnlPct != null && (
                          <>
                            {' · '}
                            <span className={snap.pnlPct >= 0 ? 'bg-pnl--up' : 'bg-pnl--down'}>
                              {fmtPct(snap.pnlPct)}
                            </span>
                          </>
                        )}
                        {snap.layers != null && ` · ${snap.layers}L`}
                      </span>
                    )}
                    {!system && (
                      <span className="bgj-note-actions">
                        <button className="bgj-link" onClick={() => editNote(n)} disabled={busy}>Sửa</button>
                        <button className="bgj-link bgj-link--danger" onClick={() => remove(n.id)} disabled={busy}>Xoá</button>
                      </span>
                    )}
                  </div>
                  {n.content.trim() && (
                    <div className="bgj-note-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(n.content) }} />
                  )}
                  {n.images.length > 0 && (
                    <div className="bgj-thumbs">
                      {n.images.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer" className="bgj-thumb">
                          <img src={url} alt="chart" />
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Composer */}
      <div className="bgj-composer tc-activity__composer">
        <div className="bgj-composer-head">
          <span className="bgj-label">{editingId ? 'Sửa ghi chú' : 'Ghi chú mới'}</span>
          <span className="bgj-hint">✨ Claude tự format lại khi lưu</span>
        </div>
        <MarkdownEditor
          value={content}
          onChange={setContent}
          placeholder="Vì sao gom lúc này? Kế hoạch, mốc giá theo dõi, điều kiện nào thì sai…"
          minHeight={120}
        />

        <div className="bgj-thumbs bgj-thumbs--compose">
          {existingImages.map((url) => (
            <div key={url} className="bgj-thumb bgj-thumb--edit">
              <img src={url} alt="chart" />
              <button className="bgj-thumb-x" onClick={() => setExistingImages((prev) => prev.filter((u) => u !== url))} title="Xoá ảnh">×</button>
            </div>
          ))}
          {pendingPreviews.map((p, i) => (
            <div key={p.url} className="bgj-thumb bgj-thumb--edit">
              <img src={p.url} alt={p.name} />
              <button className="bgj-thumb-x" onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))} title="Bỏ">×</button>
            </div>
          ))}
          <label className="bgj-upload">
            + Ảnh
            <input type="file" accept="image/*" multiple hidden onChange={onFilesPicked} />
          </label>
        </div>

        <div className="bgj-composer-actions">
          <button className="bgj-btn bgj-btn--primary" onClick={save} disabled={busy}>
            {phase === 'formatting' ? '✨ Đang format…' : phase === 'saving' ? 'Đang lưu…' : editingId ? 'Cập nhật' : 'Lưu ghi chú'}
          </button>
          {editingId && (
            <button className="bgj-btn bgj-btn--ghost" onClick={resetEditor} disabled={busy}>
              Huỷ sửa
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
