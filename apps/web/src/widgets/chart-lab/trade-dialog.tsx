'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import type { ChartImage, ChartSample, ChartSampleUpdate, ChartTradeResult } from '@web/shared/api/types';
import { ImageUpload, type ImageUploadValue } from '@web/shared/ui/image-upload/image-upload';

import { fromLocalInput, parsePrice, priceStr, toLocalInput } from './chart-lab-utils';
import s from './chart-lab.module.css';

// Lazy like every other TipTap surface: the editor bundle only loads when the dialog opens.
const MarkdownEditor = dynamic(() => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor), { ssr: false });

const api = createApiClient();

type Form = {
  symbol: string;
  entryFrom: string;
  entryTo: string;
  tp: string;
  sl: string;
  openedAt: string;
  closedAt: string;
  result: ChartTradeResult | '';
  reason: string;
  tags: string[];
};

const formOf = (x: ChartSample | null): Form => ({
  symbol: x?.symbol ?? '',
  entryFrom: priceStr(x?.entryPrice),
  entryTo: priceStr(x?.entryPriceTo),
  tp: priceStr(x?.tpPrice),
  sl: priceStr(x?.slPrice),
  openedAt: x ? toLocalInput(x.chartTime) : toLocalInput(new Date().toISOString()),
  closedAt: toLocalInput(x?.closedAt ?? null),
  result: x?.result ?? '',
  reason: x?.note ?? '',
  tags: x?.tags ?? [],
});

/** Add (sample = null) or edit one collected trade: screenshots + entry zone, TP, SL, dates, reason, tags, result. */
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
  const [keptUrls, setKeptUrls] = useState<string[]>(() => sample?.images.map((i) => i.url) ?? []);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const suggestions = useMemo(() => allTags.filter((t) => !form.tags.includes(t)).slice(0, 12), [allTags, form.tags]);

  function addTag(raw: string) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/^#/, '');
    if (t && !form.tags.includes(t)) set('tags', [...form.tags, t].slice(0, 12));
    setTagInput('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.symbol.trim()) return setError('Nhập tên coin');
    const entryFrom = parsePrice(form.entryFrom);
    const entryTo = parsePrice(form.entryTo);
    if (form.entryFrom.trim() && entryFrom == null) return setError('Vùng vào lệnh không hợp lệ');
    if (form.openedAt && form.closedAt && form.closedAt < form.openedAt) return setError('Ngày đóng phải sau ngày mở');
    setSaving(true);
    setError(null);
    try {
      // Upload first: a trade saved without its charts is the worse outcome.
      const uploaded = newFiles.length ? await api.uploadImagesR2(newFiles) : [];
      const kept = (sample?.images ?? []).filter((i) => keptUrls.includes(i.url));
      const images: ChartImage[] = [...kept, ...uploaded.map((u) => ({ url: u.url, key: u.key }))];
      const [lo, hi] = entryFrom != null && entryTo != null && entryTo < entryFrom ? [entryTo, entryFrom] : [entryFrom, entryTo];
      const input: ChartSampleUpdate = {
        symbol: form.symbol.trim(),
        entryPrice: lo,
        entryPriceTo: lo != null && hi != null && hi !== lo ? hi : null,
        tpPrice: parsePrice(form.tp),
        slPrice: parsePrice(form.sl),
        chartTime: fromLocalInput(form.openedAt),
        closedAt: fromLocalInput(form.closedAt),
        result: form.result || null,
        note: form.reason.trim() || null,
        tags: form.tags,
        images,
      };
      onSaved(sample ? await api.updateChartSample(sample.id, input) : await api.createChartSample(input));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu thất bại');
      setSaving(false);
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={() => !saving && onClose()}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">{sample ? `Edit Trade · ${sample.symbol ?? ''}` : 'Add Trade'}</span>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close" disabled={saving}>
            ✕
          </button>
        </div>

        <div className="dialog-body">
          <form className="trade-form" style={{ marginTop: 0 }} onSubmit={(e) => void submit(e)}>
            <label className="trade-field">
              <span>Coin</span>
              <input value={form.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase())} placeholder="BTCUSDT" autoFocus={!sample} required />
            </label>

            <label className="trade-field">
              <span>Result</span>
              <select value={form.result} onChange={(e) => set('result', e.target.value as Form['result'])}>
                <option value="">— chưa đóng —</option>
                <option value="TP">TP</option>
                <option value="SL">SL</option>
              </select>
            </label>

            <div className="trade-field trade-field-wide">
              <span>Vùng vào lệnh</span>
              <div className={s.zone}>
                <input inputMode="decimal" value={form.entryFrom} onChange={(e) => set('entryFrom', e.target.value)} placeholder="Từ" />
                <em>–</em>
                <input inputMode="decimal" value={form.entryTo} onChange={(e) => set('entryTo', e.target.value)} placeholder="Đến (tuỳ chọn)" />
              </div>
            </div>

            <label className="trade-field">
              <span>TP</span>
              <input inputMode="decimal" value={form.tp} onChange={(e) => set('tp', e.target.value)} placeholder="0.00" />
            </label>

            <label className="trade-field">
              <span>SL</span>
              <input inputMode="decimal" value={form.sl} onChange={(e) => set('sl', e.target.value)} placeholder="0.00" />
            </label>

            <label className="trade-field">
              <span>Opened At</span>
              <input type="datetime-local" value={form.openedAt} onChange={(e) => set('openedAt', e.target.value)} />
            </label>

            <label className="trade-field">
              <span>Closed At</span>
              <input type="datetime-local" value={form.closedAt} onChange={(e) => set('closedAt', e.target.value)} />
            </label>

            <div className="trade-field trade-field-wide">
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

            <div className="trade-field trade-field-wide">
              <span>Lý do vào lệnh</span>
              <MarkdownEditor value={form.reason} onChange={(v) => set('reason', v)} placeholder="Setup gì, vì sao vào ở vùng này, TP/SL đặt theo đâu…" minHeight={160} />
            </div>

            <div className="trade-field trade-field-wide">
              <span>Screenshots</span>
              <ImageUpload
                existingUrls={keptUrls}
                onChange={(v: ImageUploadValue) => {
                  setKeptUrls(v.existingUrls);
                  setNewFiles(v.newFiles);
                }}
                uploading={saving}
              />
            </div>

            {error ? <p className="trade-form-error">{error}</p> : null}

            <button type="submit" className="trade-submit" disabled={saving}>
              {saving ? (newFiles.length ? 'Uploading images...' : 'Saving...') : sample ? 'Save Trade' : 'Add Trade'}
            </button>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
