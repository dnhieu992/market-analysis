'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { StrategyPaperBoard as BoardData, StrategyPaperNote, StrategyPaperTrade } from '@web/shared/api/types';
import { ImageUpload, type ImageUploadValue } from '@web/shared/ui/image-upload/image-upload';

const apiClient = createApiClient();

/** The engine runs hourly; the board re-reads every 60s so open trades stay live-ish. */
const REFRESH_MS = 60_000;

const STATUS_LABEL: Record<StrategyPaperTrade['status'], string> = {
  OPEN: 'Đang mở',
  CLOSED_TP: 'Chạm chốt lời',
  CLOSED_SL: 'Dính cắt lỗ',
  CLOSED_EOD: 'Đóng cuối ngày',
};
const STATUS_COLOR: Record<StrategyPaperTrade['status'], string> = {
  OPEN: '#2563eb',
  CLOSED_TP: '#16a34a',
  CLOSED_SL: '#dc2626',
  CLOSED_EOD: '#6b7280',
};

function fmtUsd(n: number | null): string {
  if (n == null) return '—';
  const s = n > 0 ? '+' : '';
  return `${s}${n.toFixed(2)}$`;
}
function fmtR(n: number | null): string {
  if (n == null) return '—';
  const s = n > 0 ? '+' : '';
  return `${s}${n.toFixed(2)}R`;
}
function fmtPrice(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}
function pnlColor(n: number | null): string {
  if (n == null) return '#111827';
  return n > 0 ? '#16a34a' : n < 0 ? '#dc2626' : '#6b7280';
}

/** Minimal markdown → React (headings ##, **bold**, - bullets, blank lines). No HTML injection. */
function renderMarkdown(md: string): ReactNode {
  const lines = md.split('\n');
  const out: ReactNode[] = [];
  let bullets: ReactNode[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(<ul key={`ul-${out.length}`} style={{ margin: '4px 0 10px', paddingLeft: 20 }}>{bullets}</ul>);
      bullets = [];
    }
  };
  const inline = (text: string): ReactNode =>
    text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <span key={i}>{part}</span>,
    );
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '');
    if (/^#{1,6}\s/.test(line)) {
      flush();
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s/, '');
      out.push(
        <div key={`h-${idx}`} style={{ fontWeight: 700, fontSize: level <= 2 ? 16 : 14, margin: '14px 0 6px', color: '#111827' }}>
          {inline(text)}
        </div>,
      );
    } else if (/^\s*[-*]\s/.test(line)) {
      const indent = (line.match(/^\s*/)?.[0].length ?? 0) >= 2;
      bullets.push(
        <li key={`li-${idx}`} style={{ marginBottom: 3, marginLeft: indent ? 16 : 0, color: '#374151', lineHeight: 1.5 }}>
          {inline(line.replace(/^\s*[-*]\s/, ''))}
        </li>,
      );
    } else if (line.trim() === '') {
      flush();
    } else {
      flush();
      out.push(<p key={`p-${idx}`} style={{ margin: '4px 0', color: '#374151', lineHeight: 1.5 }}>{inline(line)}</p>);
    }
  });
  flush();
  return out;
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', minWidth: 130 }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? '#111827' }}>{value}</div>
    </div>
  );
}

function ChartLink({ url }: { url: string | null }) {
  if (!url) return <span style={{ fontSize: 12, color: '#9ca3af' }}>—</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#1d4ed8', textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>
      📈 Xem chart 1h
    </a>
  );
}

function DirBadge({ dir }: { dir: StrategyPaperTrade['direction'] }) {
  const long = dir === 'LONG';
  return (
    <span style={{ fontWeight: 700, fontSize: 12, padding: '2px 8px', borderRadius: 6, color: '#fff', background: long ? '#16a34a' : '#dc2626' }}>
      {long ? 'MUA' : 'BÁN'}
    </span>
  );
}

/** 1..5 star rating; onPick(0) clears. */
function Stars({ value, onPick }: { value: number | null; onPick: (v: number) => void }) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPick(value === n ? 0 : n)}
          title={`${n} sao`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0, color: (value ?? 0) >= n ? '#f59e0b' : '#d1d5db' }}
        >
          ★
        </button>
      ))}
    </span>
  );
}

function FeedbackCell({ trade, onSaved }: { trade: StrategyPaperTrade; onSaved: (t: StrategyPaperTrade) => void }) {
  const [rating, setRating] = useState<number | null>(trade.feedbackRating);
  const [note, setNote] = useState<string>(trade.feedbackNote ?? '');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const dirty = rating !== trade.feedbackRating || note !== (trade.feedbackNote ?? '');

  const save = async () => {
    setSaving(true);
    try {
      const updated = await apiClient.saveStrategyPaperFeedback(trade.id, { rating: rating ?? null, note });
      onSaved(updated);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const summary = trade.feedbackRating
    ? `${'★'.repeat(trade.feedbackRating)}${trade.feedbackNote ? ' · ' + (trade.feedbackNote.length > 24 ? trade.feedbackNote.slice(0, 24) + '…' : trade.feedbackNote) : ''}`
    : 'Thêm nhận xét';

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ background: 'none', border: '1px dashed #cbd5e1', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 12, color: trade.feedbackRating ? '#b45309' : '#6b7280' }}>
        {summary}
      </button>
    );
  }
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ marginBottom: 4 }}><Stars value={rating} onPick={(v) => setRating(v === 0 ? null : v)} /></div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Nhận xét lệnh này…"
        rows={2}
        style={{ width: '100%', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, padding: 6, resize: 'vertical', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button type="button" onClick={save} disabled={saving || !dirty} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 6, border: 'none', background: dirty ? '#2563eb' : '#93c5fd', color: '#fff', cursor: dirty ? 'pointer' : 'default' }}>
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
          Đóng
        </button>
      </div>
    </div>
  );
}

function StrategyDialog({ initialDoc, onClose, onSaved }: { initialDoc: string; onClose: () => void; onSaved: (doc: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialDoc);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiClient.updateStrategyPaperDoc({ docMarkdown: draft });
      onSaved(res.docMarkdown);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'auto', padding: 24, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Chi tiết chiến lược</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {!editing && <button type="button" onClick={() => { setDraft(initialDoc); setEditing(true); }} style={{ fontSize: 13, padding: '4px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>✏️ Sửa</button>}
            <button type="button" onClick={onClose} style={{ fontSize: 13, padding: '4px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>Đóng</button>
          </div>
        </div>
        {editing ? (
          <>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 6px' }}>Viết bằng markdown đơn giản: <code>## Tiêu đề</code>, <code>**in đậm**</code>, <code>- gạch đầu dòng</code>.</p>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={20} style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, padding: 10, boxSizing: 'border-box', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" onClick={save} disabled={saving} style={{ fontSize: 14, padding: '6px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' }}>{saving ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
              <button type="button" onClick={() => setEditing(false)} style={{ fontSize: 14, padding: '6px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>Huỷ</button>
            </div>
          </>
        ) : (
          <div>{renderMarkdown(initialDoc || '_(chưa có nội dung — bấm Sửa để thêm)_')}</div>
        )}
      </div>
    </div>
  );
}

function fmtNoteTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Free-text trading log: a preview list on top, a common note+image composer below. */
function NotesDialog({ onClose }: { onClose: () => void }) {
  const [notes, setNotes] = useState<StrategyPaperNote[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [body, setBody] = useState('');
  const [images, setImages] = useState<ImageUploadValue>({ existingUrls: [], newFiles: [] });
  const [uploaderKey, setUploaderKey] = useState(0); // bump to reset ImageUpload after a save
  const [saving, setSaving] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiClient
      .fetchStrategyPaperNotes()
      .then((rows) => alive && setNotes(rows))
      .catch(() => alive && (setNotes([]), setLoadError(true)));
    return () => {
      alive = false;
    };
  }, []);

  const canSave = body.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      let imageUrls: string[] = [];
      if (images.newFiles.length > 0) {
        imageUrls = await apiClient.uploadImages(images.newFiles, 'BTCUSDT');
      }
      const created = await apiClient.createStrategyPaperNote({ body: body.trim(), images: imageUrls });
      setNotes((prev) => [created, ...(prev ?? [])]);
      setBody('');
      setImages({ existingUrls: [], newFiles: [] });
      setUploaderKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const prev = notes;
    setNotes((cur) => (cur ?? []).filter((n) => n.id !== id));
    try {
      await apiClient.deleteStrategyPaperNote(id);
    } catch {
      setNotes(prev); // restore on failure
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'auto', padding: 24, boxShadow: '0 10px 40px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Ghi chú</h2>
          <button type="button" onClick={onClose} style={{ fontSize: 13, padding: '4px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>Đóng</button>
        </div>

        {/* Preview: saved notes, newest first */}
        <div>
          {notes == null ? (
            <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Đang tải…</p>
          ) : notes.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
              {loadError ? 'Không tải được ghi chú. Thử lại sau.' : 'Chưa có ghi chú nào. Thêm ghi chú đầu tiên bên dưới.'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notes.map((n) => (
                <div key={n.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fafafa' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{fmtNoteTime(n.createdAt)}</span>
                    <button type="button" onClick={() => remove(n.id)} title="Xoá ghi chú" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#9ca3af', padding: 0 }}>🗑️</button>
                  </div>
                  <div style={{ fontSize: 14, color: '#111827', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{n.body}</div>
                  {n.images.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                      {n.images.map((url) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={url} src={url} alt="note attachment" onClick={() => setLightboxUrl(url)} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', cursor: 'zoom-in' }} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Composer: common textarea + image upload + save */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 14 }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Thêm ghi chú mới…"
            rows={3}
            style={{ width: '100%', fontSize: 14, border: '1px solid #d1d5db', borderRadius: 8, padding: 10, boxSizing: 'border-box', resize: 'vertical' }}
          />
          <div style={{ marginTop: 8 }}>
            <ImageUpload key={uploaderKey} onChange={setImages} uploading={saving} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" onClick={save} disabled={!canSave} style={{ fontSize: 14, padding: '7px 18px', borderRadius: 8, border: 'none', background: canSave ? '#2563eb' : '#93c5fd', color: '#fff', cursor: canSave ? 'pointer' : 'default', fontWeight: 600 }}>
              {saving ? 'Đang lưu…' : 'Lưu ghi chú'}
            </button>
          </div>
        </div>
      </div>

      {lightboxUrl && (
        <div onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }} className="lightbox-backdrop">
          <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }} aria-label="Close">✕</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="preview" className="lightbox-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

export function StrategyBoard({ initialBoard }: { initialBoard: BoardData }) {
  const [board, setBoard] = useState<BoardData>(initialBoard);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await apiClient.fetchStrategyPaperBoard();
      setBoard(next);
    } catch {
      /* keep last board on a transient error */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const scanNow = async () => {
    setBusy(true);
    try {
      await apiClient.runStrategyPaperScan();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onTradeUpdated = (t: StrategyPaperTrade) => {
    setBoard((b) => ({
      ...b,
      openTrades: b.openTrades.map((x) => (x.id === t.id ? t : x)),
      history: b.history.map((x) => (x.id === t.id ? t : x)),
    }));
  };

  const { config, stats, levels } = board;

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 16px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#111827' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{config.name}</h1>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            {config.symbol} · khung {config.timeframe} · rủi ro {config.riskUsd}$/lệnh · chốt lời {config.rrPlanned}R · <b>backtest chạy giả, không nối sàn</b>
            {!config.enabled && <span style={{ color: '#dc2626', marginLeft: 8 }}>● đang tắt</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={() => setDialogOpen(true)} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', fontWeight: 600 }}>
            📖 Chi tiết chiến lược
          </button>
          <button type="button" onClick={() => setNotesOpen(true)} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>
            📝 Ghi chú
          </button>
          <button type="button" onClick={scanNow} disabled={busy} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
            {busy ? 'Đang quét…' : '↻ Quét ngay'}
          </button>
        </div>
      </div>

      {/* Live context */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#374151', marginBottom: 16 }}>
        <span>Giá hiện tại: <b>{fmtPrice(board.price)}</b></span>
        {levels && (
          <>
            <span>Đỉnh hôm qua (mua khi vượt): <b style={{ color: '#16a34a' }}>{fmtPrice(levels.pdh)}</b></span>
            <span>Đáy hôm qua (bán khi thủng): <b style={{ color: '#dc2626' }}>{fmtPrice(levels.pdl)}</b></span>
            <span style={{ color: '#9ca3af' }}>(ngày {levels.day})</span>
          </>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatTile label="Đang mở" value={String(board.openTrades.length)} color="#2563eb" />
        <StatTile label="Lệnh đã đóng" value={String(stats.closedCount)} />
        <StatTile label="Tỷ lệ thắng" value={stats.winRate == null ? '—' : `${stats.winRate.toFixed(0)}%`} />
        <StatTile label="Tổng R" value={fmtR(stats.totalR)} color={pnlColor(stats.totalR)} />
        <StatTile label="Tổng lãi/lỗ" value={fmtUsd(stats.totalPnlUsd)} color={pnlColor(stats.totalPnlUsd)} />
      </div>

      {/* Open trades */}
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Lệnh đang mở ({board.openTrades.length})</h2>
      {board.openTrades.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 14, margin: '0 0 20px' }}>Chưa có lệnh nào đang mở. Máy quét mỗi giờ; khi giá phá đỉnh/đáy hôm qua sẽ tự vào lệnh.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {board.openTrades.map((t) => (
            <div key={t.id} style={{ border: '1px solid #bfdbfe', background: '#f8fbff', borderRadius: 10, padding: 14 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <DirBadge dir={t.direction} />
                <span style={{ fontSize: 13 }}>Vào <b>{fmtPrice(t.entryPrice)}</b></span>
                <span style={{ fontSize: 13, color: '#dc2626' }}>Cắt lỗ {fmtPrice(t.stopLoss)}</span>
                <span style={{ fontSize: 13, color: '#16a34a' }}>Chốt lời {fmtPrice(t.takeProfit)}</span>
                <span style={{ fontSize: 13 }}>Đang lời/lỗ: <b style={{ color: pnlColor(t.unrealizedR) }}>{fmtR(t.unrealizedR)} ({fmtUsd(t.unrealizedPnlUsd)})</b></span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>Mở lúc {fmtTime(t.openedAt)}</span>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>Mốc ngày hôm qua: đỉnh {fmtPrice(t.pdh)} / đáy {fmtPrice(t.pdl)} · rủi ro {t.riskUsd}$</span>
                <ChartLink url={t.chartUrl} />
                <FeedbackCell trade={t} onSaved={onTradeUpdated} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* History */}
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Lịch sử lệnh ({board.history.length})</h2>
      {board.history.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 14 }}>Chưa có lệnh nào đã đóng.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '8px 10px' }}>Ngày</th>
                <th style={{ padding: '8px 10px' }}>Chiều</th>
                <th style={{ padding: '8px 10px' }}>Vào</th>
                <th style={{ padding: '8px 10px' }}>Cắt lỗ</th>
                <th style={{ padding: '8px 10px' }}>Chốt lời</th>
                <th style={{ padding: '8px 10px' }}>Thoát</th>
                <th style={{ padding: '8px 10px' }}>Kết quả</th>
                <th style={{ padding: '8px 10px' }}>Trạng thái</th>
                <th style={{ padding: '8px 10px' }}>Chart</th>
                <th style={{ padding: '8px 10px' }}>Nhận xét</th>
              </tr>
            </thead>
            <tbody>
              {board.history.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{t.tradeDate}</td>
                  <td style={{ padding: '8px 10px' }}><DirBadge dir={t.direction} /></td>
                  <td style={{ padding: '8px 10px' }}>{fmtPrice(t.entryPrice)}</td>
                  <td style={{ padding: '8px 10px', color: '#dc2626' }}>{fmtPrice(t.stopLoss)}</td>
                  <td style={{ padding: '8px 10px', color: '#16a34a' }}>{fmtPrice(t.takeProfit)}</td>
                  <td style={{ padding: '8px 10px' }}>{fmtPrice(t.exitPrice)}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 700, color: pnlColor(t.rMultiple) }}>{fmtR(t.rMultiple)}<br /><span style={{ fontWeight: 400, fontSize: 12 }}>{fmtUsd(t.pnlUsd)}</span></td>
                  <td style={{ padding: '8px 10px' }}><span style={{ color: STATUS_COLOR[t.status], fontWeight: 600, fontSize: 12 }}>{STATUS_LABEL[t.status]}</span></td>
                  <td style={{ padding: '8px 10px' }}><ChartLink url={t.chartUrl} /></td>
                  <td style={{ padding: '8px 10px' }}><FeedbackCell trade={t} onSaved={onTradeUpdated} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && (
        <StrategyDialog
          initialDoc={config.docMarkdown}
          onClose={() => setDialogOpen(false)}
          onSaved={(doc) => setBoard((b) => ({ ...b, config: { ...b.config, docMarkdown: doc } }))}
        />
      )}

      {notesOpen && <NotesDialog onClose={() => setNotesOpen(false)} />}
    </div>
  );
}
