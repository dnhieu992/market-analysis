'use client';

import { useMemo, useState } from 'react';

import type { ChartDirection, ChartSample, ChartSampleUpdate } from '@web/shared/api/types';

import { DIR_LABEL } from './chart-lab-parts';
import s from './chart-lab.module.css';

export const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];
const VN_OFFSET_MS = 7 * 3_600_000;

/** ISO → value of <input type="datetime-local"> in Vietnam time, and back. */
const toVnInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 16) : '');
const fromVnInput = (v: string) => (v ? new Date(`${v}:00+07:00`).toISOString() : null);
const numStr = (n: number | null | undefined) => (n != null ? String(n) : '');
const parseNum = (v: string) => {
  const t = v.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export type ChartFormValue = {
  symbol: string;
  interval: string;
  chartTime: string;
  direction: ChartDirection | null;
  entryPrice: string;
  tpPrice: string;
  slPrice: string;
  note: string;
  tags: string[];
};

export const EMPTY_FORM: ChartFormValue = { symbol: '', interval: '1h', chartTime: '', direction: null, entryPrice: '', tpPrice: '', slPrice: '', note: '', tags: [] };

export const formOf = (x: ChartSample): ChartFormValue => ({
  symbol: x.symbol ?? '',
  interval: x.interval ?? '',
  chartTime: toVnInput(x.chartTime),
  direction: x.direction,
  entryPrice: numStr(x.entryPrice),
  tpPrice: numStr(x.tpPrice),
  slPrice: numStr(x.slPrice),
  note: x.note ?? '',
  tags: x.tags,
});

/** Whole form → API input (create). */
export const toInput = (f: ChartFormValue): ChartSampleUpdate => ({
  symbol: f.symbol.trim() || null,
  interval: f.interval || null,
  chartTime: fromVnInput(f.chartTime),
  direction: f.direction,
  entryPrice: parseNum(f.entryPrice),
  tpPrice: parseNum(f.tpPrice),
  slPrice: parseNum(f.slPrice),
  note: f.note.trim() || null,
  tags: f.tags,
});

/** Only the changed fields (edit). */
export function toPatch(f: ChartFormValue, initial: ChartFormValue): ChartSampleUpdate {
  const a = toInput(f);
  const b = toInput(initial);
  const out: ChartSampleUpdate = {};
  for (const k of Object.keys(a) as Array<keyof ChartSampleUpdate>) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) (out as Record<string, unknown>)[k] = a[k];
  }
  return out;
}

/** % of TP / SL from the entry, signed for the chosen side (LONG: TP above, SL below). */
function pctHint(level: string, entry: string, direction: ChartDirection | null, kind: 'tp' | 'sl'): { text: string; bad: boolean } | null {
  const l = parseNum(level);
  const e = parseNum(entry);
  if (!l || !e) return null;
  const pct = ((l - e) / e) * 100;
  const bad = direction === 'LONG' ? (kind === 'tp' ? pct <= 0 : pct >= 0) : direction === 'SHORT' ? (kind === 'tp' ? pct >= 0 : pct <= 0) : false;
  return { text: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`, bad };
}

/** The user's analysis of a chart: coin, timeframe, time, direction, entry / TP / SL, tags, note. */
export function ChartForm({ value, onChange, allTags }: { value: ChartFormValue; onChange: (v: ChartFormValue) => void; allTags: string[] }) {
  const [tagInput, setTagInput] = useState('');
  const set = <K extends keyof ChartFormValue>(k: K, v: ChartFormValue[K]) => onChange({ ...value, [k]: v });
  const suggestions = useMemo(() => allTags.filter((t) => !value.tags.includes(t)).slice(0, 14), [allTags, value.tags]);

  function addTag(raw: string) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/^#/, '');
    if (t && !value.tags.includes(t)) set('tags', [...value.tags, t].slice(0, 12));
    setTagInput('');
  }

  const segClass = (d: ChartDirection) => (value.direction === d ? (d === 'LONG' ? s.segOnLong : d === 'SHORT' ? s.segOnShort : s.segOnNone) : '');
  const tpHint = pctHint(value.tpPrice, value.entryPrice, value.direction, 'tp');
  const slHint = pctHint(value.slPrice, value.entryPrice, value.direction, 'sl');

  return (
    <div className={s.formStack}>
      <div className={s.formGrid}>
        <label className={s.field}>
          Coin *
          <input className={s.input} value={value.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase())} placeholder="BTCUSDT" />
        </label>
        <label className={s.field}>
          Khung *
          <select className={s.select} value={value.interval} onChange={(e) => set('interval', e.target.value)}>
            <option value="">—</option>
            {INTERVALS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          Thời điểm (giờ VN)
          <input className={s.input} type="datetime-local" value={value.chartTime} onChange={(e) => set('chartTime', e.target.value)} />
          <span className={s.hint}>Để trống = nến vừa đóng gần nhất</span>
        </label>
      </div>

      <div className={s.field}>
        Hướng
        <div className={s.seg} role="group" aria-label="Hướng">
          {(['LONG', 'SHORT', 'NONE'] as const).map((d) => (
            <button key={d} type="button" className={`${s.segBtn} ${segClass(d)}`} onClick={() => set('direction', value.direction === d ? null : d)}>
              {DIR_LABEL[d]}
            </button>
          ))}
        </div>
      </div>

      <div className={s.formGrid}>
        <label className={s.field}>
          Giá vào
          <input className={s.input} inputMode="decimal" value={value.entryPrice} onChange={(e) => set('entryPrice', e.target.value)} placeholder="trống = giá đóng nến" />
        </label>
        <label className={s.field}>
          TP
          <input className={s.input} inputMode="decimal" value={value.tpPrice} onChange={(e) => set('tpPrice', e.target.value)} placeholder="giá chốt lời" />
          {tpHint && <span className={tpHint.bad ? s.hintBad : s.hint}>{tpHint.text}{tpHint.bad ? ' · sai phía so với hướng' : ''}</span>}
        </label>
        <label className={s.field}>
          SL
          <input className={s.input} inputMode="decimal" value={value.slPrice} onChange={(e) => set('slPrice', e.target.value)} placeholder="giá cắt lỗ" />
          {slHint && <span className={slHint.bad ? s.hintBad : s.hint}>{slHint.text}{slHint.bad ? ' · sai phía so với hướng' : ''}</span>}
        </label>
      </div>

      <div className={s.field}>
        Tag setup
        <div className={s.tagEditor}>
          {value.tags.map((t) => (
            <span key={t} className={s.tagChip}>
              {t}
              <button type="button" onClick={() => set('tags', value.tags.filter((x) => x !== t))} aria-label={`Bỏ tag ${t}`}>
                ×
              </button>
            </span>
          ))}
          <input
            className={s.input}
            style={{ width: 160 }}
            placeholder="gõ tag + Enter"
            value={tagInput}
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
          <div className={s.tagEditor} style={{ marginTop: 4 }}>
            {suggestions.map((t) => (
              <button key={t} type="button" className={s.tagSuggest} onClick={() => addTag(t)}>
                + {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <label className={s.field}>
        Phân tích của bạn
        <textarea
          className={s.textarea}
          value={value.note}
          onChange={(e) => set('note', e.target.value)}
          placeholder="Vd: test lại kháng cự H4 lần 3, RSI phân kỳ âm, volume giảm dần → short, SL trên đỉnh cũ…"
        />
      </label>
    </div>
  );
}
