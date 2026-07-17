'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { TradingJournalEntry, TradingJournalRevision } from '@web/shared/api/types';

import { diffLines, diffStat } from './diff-lines';

// Lazy-load the TipTap editor so its bundle only loads on the journal page.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

/** The trader's clock — pinned so server and client render the same string (no hydration mismatch). */
const TZ = 'Asia/Ho_Chi_Minh';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Save time as HH:mm. Entries are keyed by UTC day, so a save can land on a different local
 * day than the entry it belongs to — show dd/MM too when that happens, rather than a bare
 * hour that looks wrong.
 */
function formatRevisionTime(iso: string, entryDate: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  const localDay = d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  if (localDay === entryDate) return time;
  return `${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', timeZone: TZ })} ${time}`;
}

/** First non-empty line of the markdown, for the list preview. */
function contentPreview(md: string): string {
  const line = md.split('\n').map((l) => l.replace(/[#>*`_-]/g, '').trim()).find((l) => l.length > 0);
  return line ? (line.length > 90 ? `${line.slice(0, 90)}…` : line) : '(chưa có nội dung)';
}

function truncate(s: string, max = 90): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** One row of the intra-day history: a save, and what it changed vs the save before it. */
function RevisionRow({
  revision,
  previous,
  entryDate,
  isLatest,
  expanded,
  onToggle,
  onRestore,
}: {
  revision: TradingJournalRevision;
  previous: TradingJournalRevision | null;
  entryDate: string;
  isLatest: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRestore: () => void;
}) {
  const prevContent = previous?.content ?? '';
  const stat = useMemo(() => diffStat(prevContent, revision.content), [prevContent, revision.content]);
  // Blank deleted lines are pure noise (and the first save "deletes" the empty previous content).
  const lines = useMemo(
    () => (expanded ? diffLines(prevContent, revision.content).filter((l) => l.type !== 'del' || l.text.trim() !== '') : []),
    [expanded, prevContent, revision.content],
  );

  const imagesAdded = revision.images.length - (previous?.images.length ?? 0);
  const tagsChanged = !sameList(revision.tags, previous?.tags ?? []);

  // Describe the save even when nothing textual changed, so no row reads as empty.
  const notes: string[] = [];
  if (imagesAdded > 0) notes.push(`🖼 +${imagesAdded}`);
  if (imagesAdded < 0) notes.push(`🖼 −${Math.abs(imagesAdded)}`);
  if (tagsChanged) notes.push('#tags');

  const preview =
    stat.firstAdded ??
    (notes.length > 0 ? 'chỉ đổi ảnh/tags' : stat.removed > 0 ? 'xoá bớt nội dung' : 'không đổi nội dung');

  return (
    <li className={`tj-hist-item ${expanded ? 'tj-hist-open' : ''}`}>
      <div className="tj-hist-head" onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <span className={`tj-hist-dot ${isLatest ? 'tj-hist-dot-now' : ''}`} aria-hidden />
        <span className="tj-hist-time">{formatRevisionTime(revision.createdAt, entryDate)}</span>
        {isLatest && <span className="tj-hist-now">hiện tại</span>}
        <span className="tj-hist-stat">
          {stat.added > 0 && <b className="tj-diff-plus">+{stat.added}</b>}
          {stat.removed > 0 && <b className="tj-diff-minus">−{stat.removed}</b>}
          {notes.map((n) => <span key={n} className="tj-hist-note">{n}</span>)}
        </span>
        <span className="tj-hist-preview">{truncate(preview)}</span>
        <span className="tj-hist-caret">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div className="tj-hist-body">
          <div className="tj-hist-diff">
            {lines.length === 0 ? (
              <p className="tj-muted">(trống)</p>
            ) : (
              lines.map((l, i) => (
                <div key={`${i}-${l.text}`} className={`tj-diff-line tj-diff-${l.type}`}>
                  <span className="tj-diff-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                  <span className="tj-diff-text">{l.text || ' '}</span>
                </div>
              ))
            )}
          </div>
          {revision.tags.length > 0 && (
            <div className="tj-item-tags">{revision.tags.map((t) => <span key={t} className="tj-chip tj-chip-sm">{t}</span>)}</div>
          )}
          {revision.images.length > 0 && (
            <div className="tj-thumbs">
              {revision.images.map((url) => (
                <div key={url} className="tj-thumb tj-thumb-sm">
                  <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="chart" /></a>
                </div>
              ))}
            </div>
          )}
          <div className="tj-row">
            <button type="button" className="tj-btn tj-btn-ghost tj-btn-sm" onClick={onRestore} disabled={isLatest}
              title={isLatest ? 'Đây đã là nội dung hiện tại' : 'Đưa bản này lên editor (chưa lưu)'}>
              ↩ Khôi phục bản này
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function TradingJournal({
  initialEntries,
  initialRevisions = [],
}: {
  initialEntries: TradingJournalEntry[];
  initialRevisions?: TradingJournalRevision[];
}) {
  // Memoised: a fresh client each render would re-trigger the revision effect forever.
  const api = useMemo(() => createApiClient(), []);
  const [entries, setEntries] = useState<TradingJournalEntry[]>(initialEntries);
  const [date, setDate] = useState<string>(todayIso());
  const [content, setContent] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [phase, setPhase] = useState<'idle' | 'formatting' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadedDate, setLoadedDate] = useState<string>('');
  const [revisions, setRevisions] = useState<TradingJournalRevision[]>(initialRevisions);
  const [revLoading, setRevLoading] = useState(false);
  const [expandedRev, setExpandedRev] = useState<string | null>(null);

  // Populate the editor from the entry for `date` the first time that date is shown.
  if (date !== loadedDate) {
    const entry = entries.find((e) => e.date === date);
    setContent(entry?.content ?? '');
    setTags(entry?.tags ?? []);
    setImages(entry?.images ?? []);
    setPendingFiles([]);
    setTagDraft('');
    setSaved(false);
    setWarning(null);
    setExpandedRev(null);
    setLoadedDate(date);
  }

  const currentEntry = entries.find((e) => e.date === date) ?? null;
  const currentEntryId = currentEntry?.id ?? null;
  const busy = phase !== 'idle';
  const pendingPreviews = useMemo(() => pendingFiles.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [pendingFiles]);

  // Which entry the `revisions` in state belong to — the server already sent today's.
  const loadedRevFor = useRef<string | null>(initialEntries.find((e) => e.date === todayIso())?.id ?? null);

  // Always the latest editor text, so save() can tell whether the user kept typing while the
  // reformat was in flight (see the guard in save()).
  const contentRef = useRef(content);
  contentRef.current = content;

  const loadRevisions = useCallback(async (entryId: string | null) => {
    loadedRevFor.current = entryId;
    if (!entryId) {
      setRevisions([]);
      setRevLoading(false);
      return;
    }
    setRevLoading(true);
    try {
      const rows = await api.fetchJournalRevisions(entryId);
      if (loadedRevFor.current === entryId) setRevisions(rows);
    } catch {
      if (loadedRevFor.current === entryId) setRevisions([]);
    } finally {
      if (loadedRevFor.current === entryId) setRevLoading(false);
    }
  }, [api]);

  // Load history when the shown day changes (skips the day the server preloaded).
  useEffect(() => {
    if (loadedRevFor.current !== currentEntryId) void loadRevisions(currentEntryId);
  }, [currentEntryId, loadRevisions]);

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

  /**
   * Save = format then persist. The reformat is skipped when the text is unchanged since the
   * last save (a tags/images-only update), so re-saving cannot churn the day's wording — and
   * with it the revision diffs — through the LLM for nothing.
   */
  async function save() {
    setError(null);
    setWarning(null);
    setSaved(false);

    const submitted = content;
    let finalContent = submitted;
    const textChanged = submitted !== (currentEntry?.content ?? '');
    if (submitted.trim() && textChanged) {
      setPhase('formatting');
      try {
        const formatted = await api.reformatJournal(submitted);
        if (formatted.trim()) finalContent = formatted;
      } catch {
        // Never lose the trader's writing because Claude is unreachable — save the raw text.
        setWarning('Không format lại được (Claude lỗi) — đã lưu nguyên văn bạn viết.');
      }
    }

    setPhase('saving');
    try {
      let allImages = images;
      if (pendingFiles.length) {
        const urls = await api.uploadImages(pendingFiles);
        allImages = [...images, ...urls];
      }
      const entry = await api.saveJournalEntry({ date, content: finalContent, images: allImages, tags });
      setEntries((prev) => {
        const rest = prev.filter((e) => e.id !== entry.id && e.date !== entry.date);
        return [entry, ...rest].sort((a, b) => b.date.localeCompare(a.date));
      });
      // The editor stays live during the (multi-second) reformat. If the trader kept typing,
      // their newer text must win — overwriting it with the formatted older text would silently
      // eat what they just wrote. It stays in the editor for the next save instead.
      if (contentRef.current === submitted) {
        setContent(finalContent);
      } else {
        setWarning('Bạn gõ thêm trong lúc đang lưu — phần vừa gõ chưa được lưu, bấm Cập nhật lần nữa.');
      }
      setImages(allImages);
      setPendingFiles([]);
      setSaved(true);
      await loadRevisions(entry.id);
    } catch {
      setError('Lưu nhật ký thất bại');
    } finally {
      setPhase('idle');
    }
  }

  function restoreRevision(rev: TradingJournalRevision) {
    if (!confirm('Đưa bản này lên editor? Nội dung đang soạn dở sẽ bị thay thế (chưa lưu vào DB).')) return;
    setContent(rev.content);
    setTags(rev.tags);
    setImages(rev.images);
    setPendingFiles([]);
    setSaved(false);
    setExpandedRev(null);
  }

  async function remove() {
    if (!currentEntry) return;
    if (!confirm(`Xoá nhật ký ngày ${date}? Toàn bộ lịch sử trong ngày cũng sẽ mất.`)) return;
    setPhase('saving');
    try {
      await api.deleteJournalEntry(currentEntry.id);
      setEntries((prev) => prev.filter((e) => e.id !== currentEntry.id));
      setContent('');
      setTags([]);
      setImages([]);
      setPendingFiles([]);
      loadedRevFor.current = null;
      setRevisions([]);
    } finally {
      setPhase('idle');
    }
  }

  return (
    <div className="tj-page">
      <header className="tj-header">
        <h1 className="tj-title">Trading Journal</h1>
        <p className="tj-sub">
          Ghi lại phân tích &amp; cảm xúc mỗi ngày, đính kèm ảnh mô hình trade. Mỗi ngày một nhật ký (mở lại để sửa);
          mỗi lần lưu được ghi lại thành một mốc trong <b>Lịch sử trong ngày</b> để bạn xem lại mình đã nghĩ gì lúc nào.
          Đây là kho dữ liệu để sau này huấn luyện một &ldquo;bản sao&rdquo; phong cách trade của bạn.
        </p>
      </header>

      {error && <div className="tj-error">{error}</div>}
      {warning && <div className="tj-warn">{warning}</div>}

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
          <div className="tj-row tj-between">
            <span className="tj-label">Nội dung</span>
            <span className="tj-hint">✨ Claude tự format lại khi bạn bấm {currentEntry ? 'Cập nhật' : 'Lưu nhật ký'}</span>
          </div>
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
              {phase === 'formatting'
                ? '✨ Đang format…'
                : phase === 'saving'
                  ? 'Đang lưu…'
                  : currentEntry
                    ? 'Cập nhật'
                    : 'Lưu nhật ký'}
            </button>
            {saved && <span className="tj-saved">✓ Đã format &amp; lưu</span>}
          </div>
          {currentEntry && <button className="tj-btn tj-btn-danger" onClick={remove} disabled={busy}>Xoá ngày này</button>}
        </div>
      </section>

      {/* Intra-day history */}
      <section className="tj-card">
        <div className="tj-row tj-between">
          <h2 className="tj-h2">Lịch sử trong ngày ({revisions.length})</h2>
          {revLoading && <span className="tj-muted">Đang tải…</span>}
        </div>
        {revisions.length === 0 ? (
          <p className="tj-muted">
            {currentEntry
              ? 'Chưa có mốc nào cho ngày này. Mỗi lần bấm Cập nhật sẽ tạo một mốc mới.'
              : 'Ngày này chưa có nhật ký. Lưu lần đầu sẽ tạo mốc đầu tiên.'}
          </p>
        ) : (
          <ul className="tj-hist">
            {revisions.map((rev, i) => (
              <RevisionRow
                key={rev.id}
                revision={rev}
                previous={revisions[i + 1] ?? null}
                entryDate={date}
                isLatest={i === 0}
                expanded={expandedRev === rev.id}
                onToggle={() => setExpandedRev((cur) => (cur === rev.id ? null : rev.id))}
                onRestore={() => restoreRevision(rev)}
              />
            ))}
          </ul>
        )}
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
