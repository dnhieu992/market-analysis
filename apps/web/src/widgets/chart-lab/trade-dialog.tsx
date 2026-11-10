'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import type { ChartRead, ChartSample, ChartSampleUpdate, ImageRef } from '@web/shared/api/types';
import { ImageUploader } from '@web/shared/ui/image-uploader/image-uploader';

import { fromLocalInput, parsePrice, priceStr, toLocalInput } from './chart-lab-utils';
import s from './chart-lab.module.css';

// Lazy like every other TipTap surface: the editor bundle only loads when the dialog opens.
const MarkdownEditor = dynamic(() => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor), { ssr: false });

const api = createApiClient();

type Form = {
  symbol: string;
  entryZone: string;
  tp: string;
  sl: string;
  openedAt: string;
  closedAt: string;
  reason: string;
  tags: string[];
};
type Field = keyof Form;

const legacyZone = (x: ChartSample) => (x.entryPrice == null ? '' : x.entryPriceTo != null ? `${x.entryPrice} - ${x.entryPriceTo}` : String(x.entryPrice));

const formOf = (x: ChartSample | null): Form => ({
  symbol: x?.symbol ?? '',
  entryZone: x ? (x.entryZone ?? legacyZone(x)) : '',
  tp: priceStr(x?.tpPrice),
  sl: priceStr(x?.slPrice),
  openedAt: x ? toLocalInput(x.chartTime) : '',
  closedAt: toLocalInput(x?.closedAt ?? null),
  reason: x?.note ?? '',
  tags: x?.tags ?? [],
});

/** Claude's read → form values, only for fields it actually saw. */
function fromRead(r: ChartRead): Partial<Form> {
  const out: Partial<Form> = {};
  if (r.symbol) out.symbol = r.symbol;
  if (r.entryZone) out.entryZone = r.entryZone;
  if (r.tp != null) out.tp = String(r.tp);
  if (r.sl != null) out.sl = String(r.sl);
  if (r.openedAt) out.openedAt = toLocalInput(r.openedAt);
  if (r.closedAt) out.closedAt = toLocalInput(r.closedAt);
  if (r.reason) out.reason = r.reason;
  if (r.tags.length) out.tags = r.tags;
  return out;
}

const toRefs = (x: ChartSample | null): ImageRef[] => (x?.images ?? []).map((i) => ({ url: i.url, key: i.key ?? i.url }));

type ReadState = { phase: 'idle' } | { phase: 'reading' } | { phase: 'done'; filled: number } | { phase: 'error'; message: string };

/**
 * Add / edit one trade. Screenshots come first: as soon as one is uploaded Claude reads it and fills the
 * fields below (only those the user has not typed in); everything stays editable.
 */
export function TradeDialog({
  sample,
  allTags,
  onSaved,
  onClose,
}: {
  sample: ChartSample | null;
  allTags: string[];
  onSaved: (s: ChartSample) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(sample));
  const [images, setImages] = useState<ImageRef[]>(() => toRefs(sample));
  const [touched, setTouched] = useState<Set<Field>>(() => new Set());
  const [aiFilled, setAiFilled] = useState<Set<Field>>(() => new Set());
  const [read, setRead] = useState<ReadState>({ phase: 'idle' });
  const [pasting, setPasting] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readGen = useRef(0);
  const touchedRef = useRef(touched);
  touchedRef.current = touched;

  /** A user edit: the field is theirs now — Claude will not overwrite it. */
  const set = <K extends Field>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setTouched((t) => (t.has(k) ? t : new Set(t).add(k)));
    setAiFilled((a) => {
      if (!a.has(k)) return a;
      const n = new Set(a);
      n.delete(k);
      return n;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  useEffect(
    () => () => {
      readGen.current += 1;
    },
    [],
  );

  async function readImages(list: ImageRef[], overwriteAll = false) {
    if (!list.length) return;
    const gen = ++readGen.current;
    setRead({ phase: 'reading' });
    try {
      const r = await api.readChartImages(list.slice(-4).map((i) => i.url));
      if (gen !== readGen.current) return;
      const values = fromRead(r);
      const keys = (Object.keys(values) as Field[]).filter((k) => overwriteAll || !touchedRef.current.has(k));
      setForm((f) => {
        const next = { ...f };
        for (const k of keys) (next as Record<Field, unknown>)[k] = values[k];
        return next;
      });
      if (overwriteAll) setTouched(new Set());
      setAiFilled(new Set(keys));
      setRead({ phase: 'done', filled: keys.length });
    } catch (e) {
      if (gen !== readGen.current) return;
      setRead({ phase: 'error', message: e instanceof Error ? e.message : 'Claude không đọc được ảnh' });
    }
  }

  function onImages(next: ImageRef[]) {
    const added = next.some((n) => !images.some((o) => o.url === n.url));
    setImages(next);
    if (added) void readImages(next);
  }

  /** Ctrl/⌘+V a screenshot anywhere in the dialog. */
  async function onPaste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    setPasting(true);
    try {
      onImages([...images, ...(await api.uploadImagesR2(files))]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload ảnh thất bại');
    } finally {
      setPasting(false);
    }
  }

  const suggestions = useMemo(() => allTags.filter((t) => !form.tags.includes(t)).slice(0, 12), [allTags, form.tags]);

  function addTag(raw: string) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/^#/, '');
    if (t && !form.tags.includes(t)) set('tags', [...form.tags, t].slice(0, 12));
    setTagInput('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.symbol.trim()) return setError('Nhập tên coin');
    if (form.openedAt && form.closedAt && form.closedAt < form.openedAt) return setError('Closed At phải sau Opened At');
    setSaving(true);
    setError(null);
    try {
      const input: ChartSampleUpdate = {
        symbol: form.symbol.trim(),
        entryZone: form.entryZone.trim() || null,
        tpPrice: parsePrice(form.tp),
        slPrice: parsePrice(form.sl),
        chartTime: fromLocalInput(form.openedAt) ?? (sample ? null : new Date().toISOString()),
        closedAt: fromLocalInput(form.closedAt),
        note: form.reason.trim() || null,
        tags: form.tags,
        images: images.map((i) => ({ url: i.url, key: i.key === i.url ? null : i.key })),
      };
      onSaved(sample ? await api.updateChartSample(sample.id, input) : await api.createChartSample(input));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu thất bại');
      setSaving(false);
    }
  }

  const ai = (k: Field) => (aiFilled.has(k) ? s.aiField : '');
  const reading = read.phase === 'reading';

  return createPortal(
    <div className="dialog-backdrop" onClick={() => !saving && onClose()}>
      <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()} onPaste={(e) => void onPaste(e)}>
        <div className="dialog-header">
          <span className="dialog-title">{sample ? `Edit Trade · ${sample.symbol ?? ''}` : 'Add Trade'}</span>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close" disabled={saving}>
            ✕
          </button>
        </div>

        <div className="dialog-body">
          <form className="trade-form" style={{ marginTop: 0 }} onSubmit={(e) => void submit(e)}>
            <div className="trade-field trade-field-wide">
              <span>Ảnh lệnh</span>
              <div className={s.uploadBox}>
                <ImageUploader value={images} onChange={onImages} label={pasting ? 'Đang dán ảnh…' : 'Upload ảnh'} />
                <p className={s.uploadHint}>Upload hoặc dán (Ctrl/⌘+V) ảnh chart / ảnh lệnh — Claude sẽ đọc và điền sẵn các ô bên dưới, bạn sửa lại nếu cần.</p>
              </div>
              {read.phase !== 'idle' && (
                <div className={`${s.readBar} ${read.phase === 'error' ? s.readBarError : ''}`} role="status">
                  {reading ? (
                    <>
                      <span className={s.spinner} aria-hidden /> Claude đang đọc ảnh… (khoảng 10–30 giây, bạn vẫn nhập tay được)
                    </>
                  ) : read.phase === 'done' ? (
                    <span>
                      {read.filled ? `✨ Claude đã điền ${read.filled} ô (viền xanh) — kiểm tra lại trước khi lưu.` : 'Claude không thấy thông số nào mới trong ảnh.'}
                    </span>
                  ) : (
                    <span>⚠ {read.phase === 'error' ? read.message : ''}</span>
                  )}
                  {!reading && images.length > 0 && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void readImages(images, true)}>
                      Đọc lại
                    </button>
                  )}
                </div>
              )}
              {read.phase === 'idle' && images.length > 0 && (
                <div className={s.readBar}>
                  <span>Muốn Claude điền lại từ ảnh?</span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => void readImages(images, true)}>
                    ✨ Claude đọc ảnh
                  </button>
                </div>
              )}
            </div>

            <label className={`trade-field ${ai('symbol')}`}>
              <span>Coin</span>
              <input value={form.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase())} placeholder="BTCUSDT" required />
            </label>

            <label className={`trade-field ${ai('entryZone')}`}>
              <span>Vùng vào lệnh</span>
              <input value={form.entryZone} onChange={(e) => set('entryZone', e.target.value)} placeholder="vd 64,200 - 64,500" maxLength={120} />
            </label>

            <label className={`trade-field ${ai('tp')}`}>
              <span>TP</span>
              <input inputMode="decimal" value={form.tp} onChange={(e) => set('tp', e.target.value)} placeholder="0.00" />
            </label>

            <label className={`trade-field ${ai('sl')}`}>
              <span>SL</span>
              <input inputMode="decimal" value={form.sl} onChange={(e) => set('sl', e.target.value)} placeholder="0.00" />
            </label>

            <label className={`trade-field ${ai('openedAt')}`}>
              <span>Opened At</span>
              <input type="datetime-local" value={form.openedAt} onChange={(e) => set('openedAt', e.target.value)} />
            </label>

            <label className={`trade-field ${ai('closedAt')}`}>
              <span>Closed At</span>
              <input type="datetime-local" value={form.closedAt} onChange={(e) => set('closedAt', e.target.value)} />
            </label>

            <div className={`trade-field trade-field-wide ${ai('tags')}`}>
              <span>Tags</span>
              <div className={s.tagBox}>
                {form.tags.map((t) => (
                  <span key={t} className={s.tag}>
                    {t}
                    <button type="button" onClick={() => set('tags', form.tags.filter((x) => x !== t))} aria-label={`Bỏ tag ${t}`}>
                      ×
                    </button>
                  </span>
                ))}
                <input
                  className={s.tagInput}
                  value={tagInput}
                  placeholder={form.tags.length ? '' : 'Gõ tag rồi Enter'}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag(tagInput);
                    }
                  }}
                  onBlur={() => tagInput && addTag(tagInput)}
                />
              </div>
              {suggestions.length > 0 && (
                <div className={s.suggest}>
                  {suggestions.map((t) => (
                    <button key={t} type="button" onClick={() => addTag(t)}>
                      + {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={`trade-field trade-field-wide ${ai('reason')}`}>
              <span>Lý do vào lệnh</span>
              <MarkdownEditor value={form.reason} onChange={(v) => v !== form.reason && set('reason', v)} placeholder="Setup gì, vì sao vào ở vùng này, TP/SL đặt theo đâu…" minHeight={160} />
            </div>

            {error ? <p className="trade-form-error">{error}</p> : null}

            <button type="submit" className="trade-submit" disabled={saving || pasting}>
              {saving ? 'Saving...' : sample ? 'Save Trade' : 'Add Trade'}
            </button>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
