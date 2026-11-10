'use client';

import { useEffect, useMemo, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ChartSample, ChartSimilar, ChartTpSl } from '@web/shared/api/types';

import { ChartForm, formOf, toPatch, type ChartFormValue } from './chart-form';
import { ChartLabChat } from './chart-lab-chat';
import { DIR_LABEL, DirectionBadge, ResultBadge, fmtChartTime, fmtPct, pctClass } from './chart-lab-parts';
import s from './chart-lab.module.css';

const api = createApiClient();

/** One chart: the user's analysis (editable), the real result, similar charts, and the Claude panel (Analyze). */
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
  const [form, setForm] = useState<ChartFormValue>(() => formOf(sample));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [similar, setSimilar] = useState<ChartSimilar[] | null>(null);
  const [zoom, setZoom] = useState(false);

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
  const patch = toPatch(form, initial);
  const dirty = Object.keys(patch).length > 0;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateChartSample(sample.id, patch);
      onChanged(updated);
      setForm(formOf(updated));
      setSavedAt(Date.now());
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
            <h3 className={s.sectionTitle}>Phân tích của bạn</h3>
            <ChartForm value={form} onChange={setForm} allTags={allTags} />
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
          </div>

          <div className={s.section}>
            <h3 className={s.sectionTitle}>Kết quả thật (Binance)</h3>
            {sample.outcomeStatus === 'ERROR' ? (
              <p className={s.muted}>⚠ {sample.outcomeError}</p>
            ) : !sample.outcome ? (
              <p className={s.muted}>Chưa có nến nào sau thời điểm chart.</p>
            ) : (
              <OutcomeTable sample={sample} />
            )}
          </div>

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
                        24 nến: <span className={pctClass(x.outcome?.horizons['24']?.retPct)}>{fmtPct(x.outcome?.horizons['24']?.retPct)}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={s.chatCol}>
          <ChartLabChat sample={sample} onAnalyzed={onChanged} dirty={dirty} />
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
  const lv = sample.levels;
  const tpSl = (r: ChartTpSl) =>
    r.result === 'OPEN' ? (
      <span className={s.muted}>chưa chạm</span>
    ) : (
      <span className={r.result === 'TP' ? s.pos : s.neg}>
        {r.result} sau {r.bars} nến
      </span>
    );
  return (
    <>
      {sample.side ? (
        <div className={s.verdict}>
          Lệnh {DIR_LABEL[sample.direction!]} của bạn:{' '}
          {sample.side.tpSl.result === 'TP' ? (
            <span className={s.pos}>ĐÚNG, chạm TP trước</span>
          ) : sample.side.tpSl.result === 'SL' ? (
            <span className={s.neg}>SAI, chạm SL trước</span>
          ) : (
            <span className={s.muted}>chưa chạm TP/SL</span>
          )}
        </div>
      ) : (
        <p className={s.muted} style={{ marginTop: 0 }}>
          Chọn hướng LONG/SHORT để chấm đúng/sai.
        </p>
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
        Giá vào {o.entry}
        {sample.entryPrice ? '' : ' (giá đóng nến)'} lúc {fmtChartTime(sample.chartTime)} · TP {o.tpPct}%{lv && !lv.tpFromUser ? ' (mặc định)' : ''} / SL {o.slPct}%
        {lv && !lv.slFromUser ? ' (mặc định)' : ''}: LONG {tpSl(o.long)} · SHORT {tpSl(o.short)}
        {sample.outcomeStatus === 'PENDING' ? ' · tự cập nhật 10 phút/lần' : ''}
      </p>
    </>
  );
}
