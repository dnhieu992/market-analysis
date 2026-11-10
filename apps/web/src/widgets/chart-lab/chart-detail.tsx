'use client';

import { useEffect, useMemo, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ChartDirection, ChartSample, ChartSimilar, ChartTpSl } from '@web/shared/api/types';

import { ChartLabChat } from './chart-lab-chat';
import { DIR_LABEL, DirectionBadge, ResultBadge, fmtChartTime, fmtPct, pctClass } from './chart-lab-parts';
import s from './chart-lab.module.css';

const api = createApiClient();
const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'];
const VN_OFFSET_MS = 7 * 3_600_000;

/** ISO → value of <input type="datetime-local"> in Vietnam time, and back. */
const toVnInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 16) : '');
const fromVnInput = (v: string) => (v ? new Date(`${v}:00+07:00`).toISOString() : null);

type Form = {
  symbol: string;
  interval: string;
  chartTime: string;
  direction: ChartDirection | null;
  tpPct: string;
  slPct: string;
  note: string;
  tags: string[];
};

const formOf = (x: ChartSample): Form => ({
  symbol: x.symbol ?? '',
  interval: x.interval ?? '',
  chartTime: toVnInput(x.chartTime),
  direction: x.direction,
  tpPct: x.tpPct != null ? String(x.tpPct) : '',
  slPct: x.slPct != null ? String(x.slPct) : '',
  note: x.note ?? '',
  tags: x.tags,
});

export function ChartDetail({
  sample,
  allTags,
  onClose,
  onChanged,
  onDeleted,
  onOpen,
}: {
  sample: ChartSample;
  allTags: string[];
  onClose: () => void;
  onChanged: (s: ChartSample) => void;
  onDeleted: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(sample));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [similar, setSimilar] = useState<ChartSimilar[] | null>(null);
  const [zoom, setZoom] = useState(false);
  const [tagInput, setTagInput] = useState('');
  // Don't spoil the result before the user has made a call.
  const [reveal, setReveal] = useState(sample.direction != null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (zoom) setZoom(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoom]);

  useEffect(() => {
    let cancelled = false;
    api
      .fetchSimilarCharts(sample.id, 6)
      .then((r) => !cancelled && setSimilar(r))
      .catch(() => !cancelled && setSimilar([]));
    return () => {
      cancelled = true;
    };
  }, [sample.id, sample.features]);

  const initial = useMemo(() => formOf(sample), [sample]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const suggestions = useMemo(() => {
    const fromAi = sample.aiRead?.suggestedTags ?? [];
    return Array.from(new Set([...fromAi, ...allTags])).filter((t) => !form.tags.includes(t)).slice(0, 14);
  }, [sample.aiRead, allTags, form.tags]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function addTag(raw: string) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/^#/, '');
    if (t && !form.tags.includes(t)) set('tags', [...form.tags, t].slice(0, 12));
    setTagInput('');
  }

  async function save(extra?: Partial<Form>) {
    const f = { ...form, ...extra };
    setSaving(true);
    setError(null);
    try {
      const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
      const patch = {
        ...(f.symbol !== initial.symbol ? { symbol: f.symbol || null } : {}),
        ...(f.interval !== initial.interval ? { interval: f.interval || null } : {}),
        ...(f.chartTime !== initial.chartTime ? { chartTime: fromVnInput(f.chartTime) } : {}),
        ...(f.direction !== initial.direction ? { direction: f.direction } : {}),
        ...(f.tpPct !== initial.tpPct ? { tpPct: num(f.tpPct) } : {}),
        ...(f.slPct !== initial.slPct ? { slPct: num(f.slPct) } : {}),
        ...(f.note !== initial.note ? { note: f.note || null } : {}),
        ...(JSON.stringify(f.tags) !== JSON.stringify(initial.tags) ? { tags: f.tags } : {}),
      };
      const updated = await api.updateChartSample(sample.id, patch);
      onChanged(updated);
      setForm(formOf(updated));
      setSavedAt(Date.now());
      if (updated.direction) setReveal(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deleteChartSample(sample.id);
      onDeleted(sample.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xoá thất bại');
    }
  }

  const o = sample.outcome;
  const segClass = (d: ChartDirection) => (form.direction === d ? (d === 'LONG' ? s.segOnLong : d === 'SHORT' ? s.segOnShort : s.segOnNone) : '');

  return (
    <>
      <div className={s.backdrop} onClick={onClose} />
      <aside className={s.drawer} role="dialog" aria-label={`Chart ${sample.symbol ?? ''}`}>
        <div className={s.detailCol}>
          <div className={s.detailHead}>
            <div className={s.detailTitle}>
              <span>
                {sample.symbol ?? '?'} <span className={s.muted}>{sample.interval ?? ''}</span>
              </span>
              <DirectionBadge direction={sample.direction} />
              <ResultBadge sample={sample} />
            </div>
            <button type="button" className={s.close} onClick={onClose} aria-label="Đóng">
              ✕
            </button>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={s.bigImg} src={sample.imageUrl} alt="chart" onClick={() => setZoom(true)} />

          <div className={s.section}>
            <h3 className={s.sectionTitle}>Nhận định của bạn</h3>
            <div className={s.seg} role="group" aria-label="Nhận định">
              {(['LONG', 'SHORT', 'NONE'] as const).map((d) => (
                <button key={d} type="button" className={`${s.segBtn} ${segClass(d)}`} onClick={() => set('direction', form.direction === d ? null : d)}>
                  {DIR_LABEL[d]}
                </button>
              ))}
            </div>
            <div className={s.section} style={{ marginTop: 10 }}>
              <div className={s.field}>
                Tag setup
                <div className={s.tagEditor}>
                  {form.tags.map((t) => (
                    <span key={t} className={s.tagChip}>
                      {t}
                      <button type="button" onClick={() => set('tags', form.tags.filter((x) => x !== t))} aria-label={`Bỏ tag ${t}`}>
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    className={s.input}
                    style={{ width: 150 }}
                    placeholder="thêm tag + Enter"
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
            </div>
            <div className={s.field} style={{ marginTop: 10 }}>
              Lý do / ghi chú (Claude học từ phần này)
              <textarea className={s.textarea} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Vd: test lại kháng cự H4 lần 3, RSI phân kỳ âm, volume giảm dần…" />
            </div>
          </div>

          <div className={s.section}>
            <h3 className={s.sectionTitle}>Dữ liệu chart</h3>
            <div className={s.formGrid}>
              <label className={s.field}>
                Coin
                <input className={s.input} value={form.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase())} placeholder="BTCUSDT" />
              </label>
              <label className={s.field}>
                Khung
                <select className={s.select} value={form.interval} onChange={(e) => set('interval', e.target.value)}>
                  <option value="">—</option>
                  {INTERVALS.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.field}>
                Nến cuối (giờ VN)
                <input className={s.input} type="datetime-local" value={form.chartTime} onChange={(e) => set('chartTime', e.target.value)} />
              </label>
              <div className={s.field}>
                Giá đóng nến cuối
                <span className={s.readonly}>{sample.entryPrice ?? '—'}</span>
              </div>
              <label className={s.field}>
                TP %
                <input className={s.input} inputMode="decimal" value={form.tpPct} onChange={(e) => set('tpPct', e.target.value)} />
              </label>
              <label className={s.field}>
                SL %
                <input className={s.input} inputMode="decimal" value={form.slPct} onChange={(e) => set('slPct', e.target.value)} />
              </label>
            </div>
            {sample.aiRead?.pinNote && <p className={s.muted} style={{ marginTop: 6 }}>📌 {sample.aiRead.pinNote}</p>}
            {sample.aiRead?.pinWarning && <p className={s.error}>⚠ {sample.aiRead.pinWarning}</p>}
            {sample.outcomeStatus === 'ERROR' && <p className={s.error}>⚠ {sample.outcomeError}</p>}
          </div>

          <div className={s.saveRow}>
            <button type="button" className={s.primaryBtn} onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
            {dirty && !saving && (
              <button type="button" className={s.secondaryBtn} onClick={() => setForm(initial)}>
                Huỷ thay đổi
              </button>
            )}
            {savedAt && !dirty && <span className={s.muted}>Đã lưu ✓</span>}
            <span style={{ flex: 1 }} />
            <button type="button" className={s.dangerBtn} onClick={() => void remove()} onBlur={() => setConfirmDelete(false)}>
              {confirmDelete ? 'Bấm lần nữa để xoá' : 'Xoá chart'}
            </button>
          </div>
          {error && <p className={s.error}>{error}</p>}

          <div className={s.section}>
            <h3 className={s.sectionTitle}>Kết quả thực tế</h3>
            {!o ? (
              <p className={s.muted}>{sample.outcomeStatus === 'ERROR' ? 'Chưa chấm được, cần sửa coin, khung hoặc thời điểm ở trên.' : 'Chưa có nến nào sau chart.'}</p>
            ) : !reveal ? (
              <div className={s.spoiler}>
                <span>Kết quả đang ẩn để không ảnh hưởng nhận định của bạn. Gắn LONG/SHORT trước rồi lưu, hoặc xem luôn.</span>
                <button type="button" className={s.secondaryBtn} onClick={() => setReveal(true)}>
                  Xem kết quả
                </button>
              </div>
            ) : (
              <OutcomeTable sample={sample} />
            )}
          </div>

          {sample.aiRead?.description && (
            <div className={s.section}>
              <h3 className={s.sectionTitle}>Claude đọc ảnh</h3>
              <div className={s.aiBox}>
                {sample.aiRead.description}
                {sample.aiRead.bias && (
                  <div className={s.muted} style={{ marginTop: 6 }}>
                    Thiên hướng Claude thấy: <strong>{DIR_LABEL[sample.aiRead.bias]}</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className={s.section}>
            <h3 className={s.sectionTitle}>Chart cũ giống nhất</h3>
            {similar == null ? (
              <p className={s.muted}>Đang tìm…</p>
            ) : similar.length === 0 ? (
              <p className={s.muted}>Chưa có chart nào khác có dữ liệu giá để so sánh.</p>
            ) : (
              <div className={s.simList}>
                {similar.map(({ sample: x, similarity }) => (
                  <button key={x.id} type="button" className={s.simItem} onClick={() => onOpen(x.id)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={x.imageUrl} alt="" loading="lazy" />
                    <div className={s.simBody}>
                      <div>
                        <strong>{x.symbol ?? '?'}</strong> <span className={s.muted}>{x.interval}</span> · giống {similarity}%
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <DirectionBadge direction={x.direction} />
                        <ResultBadge sample={x} />
                      </div>
                      <div className={s.muted}>
                        24 nến:{' '}
                        <span className={pctClass(x.outcome?.horizons['24']?.retPct)}>{fmtPct(x.outcome?.horizons['24']?.retPct)}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={s.chatCol}>
          <ChartLabChat sample={sample} />
        </div>
      </aside>
      {zoom && (
        <div className={s.lightbox} onClick={() => setZoom(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sample.imageUrl} alt="chart" />
        </div>
      )}
    </>
  );
}

function OutcomeTable({ sample }: { sample: ChartSample }) {
  const o = sample.outcome!;
  const tpSl = (r: ChartTpSl) =>
    r.result === 'OPEN' ? <span className={s.muted}>chưa chạm</span> : <span className={r.result === 'TP' ? s.pos : s.neg}>{r.result} sau {r.bars} nến</span>;
  return (
    <>
      {sample.side && (
        <div className={s.verdict}>
          Nhận định {DIR_LABEL[sample.direction!]} của bạn:{' '}
          {sample.side.tpSl.result === 'TP' ? (
            <span className={s.pos}>ĐÚNG, chạm TP trước</span>
          ) : sample.side.tpSl.result === 'SL' ? (
            <span className={s.neg}>SAI, chạm SL trước</span>
          ) : (
            <span className={s.muted}>chưa ngã ngũ</span>
          )}
        </div>
      )}
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Sau</th>
              <th>Giá đóng</th>
              <th>Cao nhất</th>
              <th>Thấp nhất</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(o.horizons).map(([h, x]) => (
              <tr key={h}>
                <td>{h} nến</td>
                {x ? (
                  <>
                    <td className={pctClass(x.retPct)}>{fmtPct(x.retPct)}</td>
                    <td className={s.pos}>{fmtPct(x.maxUpPct)}</td>
                    <td className={s.neg}>{fmtPct(x.maxDownPct)}</td>
                  </>
                ) : (
                  <td colSpan={3} className={s.muted}>
                    chưa đủ nến ({o.barsSeen} nến đã đóng)
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.muted} style={{ marginTop: 8 }}>
        Giá vào {o.entry} (đóng nến {fmtChartTime(sample.chartTime)}) · TP +{o.tpPct}% / SL −{o.slPct}%: LONG {tpSl(o.long)} · SHORT {tpSl(o.short)}
        {sample.outcomeStatus === 'PENDING' ? ' · tự cập nhật 10 phút/lần' : ''}
      </p>
    </>
  );
}
