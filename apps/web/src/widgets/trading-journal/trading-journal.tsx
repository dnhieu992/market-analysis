'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState, type ChangeEvent } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { TradingJournalEntry } from '@web/shared/api/types';

// Lazy-load the TipTap editor so its bundle only loads on the journal page.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

/** First non-empty line of the markdown, for the list preview. */
function contentPreview(md: string): string {
  const line = md.split('\n').map((l) => l.replace(/[#>*`_-]/g, '').trim()).find((l) => l.length > 0);
  return line ? (line.length > 90 ? `${line.slice(0, 90)}…` : line) : '(chưa có nội dung)';
}

export function TradingJournal({ initialEntries }: { initialEntries: TradingJournalEntry[] }) {
  const api = createApiClient();
  const [entries, setEntries] = useState<TradingJournalEntry[]>(initialEntries);
  const [date, setDate] = useState<string>(todayIso());
  const [content, setContent] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadedDate, setLoadedDate] = useState<string>('');

  // Populate the editor from the entry for `date` the first time that date is shown.
  if (date !== loadedDate) {
    const entry = entries.find((e) => e.date === date);
    setContent(entry?.content ?? '');
    setTags(entry?.tags ?? []);
    setImages(entry?.images ?? []);
    setPendingFiles([]);
    setTagDraft('');
    setSaved(false);
    setLoadedDate(date);
  }

  const currentEntry = entries.find((e) => e.date === date) ?? null;
  const pendingPreviews = useMemo(() => pendingFiles.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [pendingFiles]);

  function addTagFromDraft() {
    const t = tagDraft.trim().replace(/,+$/, '').trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagDraft('');
  }

  function onFilesPicked(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      let allImages = images;
      if (pendingFiles.length) {
        const urls = await api.uploadImages(pendingFiles);
        allImages = [...images, ...urls];
      }
      const entry = await api.saveJournalEntry({ date, content, images: allImages, tags });
      setEntries((prev) => {
        const rest = prev.filter((e) => e.id !== entry.id && e.date !== entry.date);
        return [entry, ...rest].sort((a, b) => b.date.localeCompare(a.date));
      });
      setImages(allImages);
      setPendingFiles([]);
      setSaved(true);
    } catch {
      setError('Lưu nhật ký thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!currentEntry) return;
    if (!confirm(`Xoá nhật ký ngày ${date}?`)) return;
    setBusy(true);
    try {
      await api.deleteJournalEntry(currentEntry.id);
      setEntries((prev) => prev.filter((e) => e.id !== currentEntry.id));
      setContent('');
      setTags([]);
      setImages([]);
      setPendingFiles([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tj-page">
      <header className="tj-header">
        <h1 className="tj-title">Trading Journal</h1>
        <p className="tj-sub">
          Ghi lại phân tích &amp; cảm xúc mỗi ngày, đính kèm ảnh mô hình trade. Mỗi ngày một nhật ký (mở lại để sửa).
          Đây là kho dữ liệu để sau này huấn luyện một &ldquo;bản sao&rdquo; phong cách trade của bạn.
        </p>
      </header>

      {error && <div className="tj-error">{error}</div>}

      {/* Editor */}
      <section className="tj-card tj-editor">
        <div className="tj-row tj-between">
          <label className="tj-datefield">
            <span>Ngày</span>
            <input className="tj-input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <span className="tj-datelabel">{formatDate(date)}</span>
        </div>

        <div className="tj-field">
          <span className="tj-label">Nội dung</span>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            placeholder="Hôm nay thị trường thế nào? Bạn phân tích gì, vào/không vào lệnh nào, cảm xúc ra sao (FOMO, sợ, tự tin…)?"
            minHeight={260}
          />
        </div>

        {/* Tags */}
        <div className="tj-field">
          <span className="tj-label">Tags</span>
          <div className="tj-chips">
            {tags.map((t) => (
              <span key={t} className="tj-chip">
                {t}
                <button className="tj-chip-x" onClick={() => setTags((prev) => prev.filter((x) => x !== t))} title="Xoá">×</button>
              </span>
            ))}
            <input
              className="tj-tag-input"
              placeholder="Thêm tag (Enter)"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagFromDraft(); }
              }}
              onBlur={addTagFromDraft}
            />
          </div>
        </div>

        {/* Images */}
        <div className="tj-field">
          <span className="tj-label">Ảnh mô hình trade</span>
          <div className="tj-thumbs">
            {images.map((url) => (
              <div key={url} className="tj-thumb">
                <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="chart" /></a>
                <button className="tj-thumb-x" onClick={() => setImages((prev) => prev.filter((u) => u !== url))} title="Xoá ảnh">×</button>
              </div>
            ))}
            {pendingPreviews.map((p, i) => (
              <div key={p.url} className="tj-thumb tj-thumb-pending">
                <img src={p.url} alt={p.name} />
                <button className="tj-thumb-x" onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))} title="Bỏ">×</button>
                <span className="tj-thumb-tag">mới</span>
              </div>
            ))}
            <label className="tj-upload">
              + Ảnh
              <input type="file" accept="image/*" multiple hidden onChange={onFilesPicked} />
            </label>
          </div>
        </div>

        <div className="tj-row tj-between">
          <div className="tj-row">
            <button className="tj-btn tj-btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Đang lưu…' : currentEntry ? 'Cập nhật' : 'Lưu nhật ký'}
            </button>
            {saved && <span className="tj-saved">✓ Đã lưu</span>}
          </div>
          {currentEntry && <button className="tj-btn tj-btn-danger" onClick={remove} disabled={busy}>Xoá ngày này</button>}
        </div>
      </section>

      {/* Past entries */}
      <section className="tj-card">
        <h2 className="tj-h2">Nhật ký đã ghi ({entries.length})</h2>
        {entries.length === 0 ? (
          <p className="tj-muted">Chưa có nhật ký nào. Bắt đầu ghi cho hôm nay ở trên.</p>
        ) : (
          <ul className="tj-list">
            {entries.map((e) => (
              <li key={e.id} className={`tj-item ${e.date === date ? 'tj-item-active' : ''}`} onClick={() => setDate(e.date)}>
                <div className="tj-item-head">
                  <b>{formatDate(e.date)}</b>
                  {e.images.length > 0 && <span className="tj-item-imgs">🖼 {e.images.length}</span>}
                </div>
                <div className="tj-item-preview">{contentPreview(e.content)}</div>
                {e.tags.length > 0 && (
                  <div className="tj-item-tags">{e.tags.map((t) => <span key={t} className="tj-chip tj-chip-sm">{t}</span>)}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
