'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { TrackingGroupStat, TrackingLessonBatch, TrackingOverview, TrackingSetup } from '@web/shared/api/types';

import { STATUS_LABEL, SetupCard, SetupFormModal, StatusBadge, fmtDateTime, fmtPx, fmtR, rClass } from './setup-card';
import styles from './tracking.module.css';

const api = createApiClient();
const REFRESH_MS = 30_000;

type StatusFilter = 'active' | 'closed' | 'all';
const ACTIVE = new Set(['PROPOSED', 'WATCHING', 'PENDING', 'OPEN']);

/** "Lệnh & nhật ký": every swing setup, the stats that teach, lesson batches and the 1R setting. */
export function TradesTab({
  symbols,
  onOpenCoin,
  onScan,
  reloadKey,
  onChanged,
}: {
  symbols: string[];
  onOpenCoin: (symbol: string) => void;
  onScan: () => void;
  reloadKey: number;
  onChanged: () => void;
}) {
  const [data, setData] = useState<TrackingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [coinFilter, setCoinFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TrackingSetup | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.fetchTrackingOverview());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu');
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load, reloadKey]);

  const changed = (s: TrackingSetup) => {
    setData((d) => (d ? { ...d, setups: d.setups.some((x) => x.id === s.id) ? d.setups.map((x) => (x.id === s.id ? s : x)) : [s, ...d.setups] } : d));
    void load();
    onChanged();
  };

  const rows = useMemo(() => {
    const list = data?.setups ?? [];
    return list.filter(
      (s) =>
        (statusFilter === 'all' || (statusFilter === 'active' ? ACTIVE.has(s.status) : !ACTIVE.has(s.status))) &&
        (!coinFilter || s.symbol === coinFilter) &&
        (!sourceFilter || s.source === sourceFilter),
    );
  }, [data, statusFilter, coinFilter, sourceFilter]);

  const coinsWithSetups = useMemo(() => [...new Set((data?.setups ?? []).map((s) => s.symbol))].sort(), [data]);
  const sel = data?.setups.find((s) => s.id === selected) ?? null;

  if (!data) return <p className={styles.hint}>{error ?? 'Đang tải…'}</p>;
  const st = data.stats;

  return (
    <>
      <div className={styles.row}>
        <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="active">Đang chạy</option>
          <option value="closed">Đã kết thúc</option>
          <option value="all">Tất cả</option>
        </select>
        <select className={styles.select} value={coinFilter} onChange={(e) => setCoinFilter(e.target.value)}>
          <option value="">Mọi coin</option>
          {coinsWithSetups.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={styles.select} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">Mọi nguồn</option>
          <option value="CLAUDE">Claude</option>
          <option value="MANUAL">Tự nhập</option>
        </select>
        <span className={styles.spacer} />
        <button type="button" className={styles.btn} onClick={onScan}>🧭 Quét cả danh sách</button>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setCreating(true)}>+ Setup tay</button>
      </div>

      <div className={styles.section}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Coin</th>
                <th>Hướng</th>
                <th>Trạng thái</th>
                <th>Setup</th>
                <th className={styles.numCell}>Entry</th>
                <th className={styles.numCell}>SL</th>
                <th className={styles.numCell}>Giá</th>
                <th className={styles.numCell}>R</th>
                <th>Nguồn</th>
                <th>Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={10} className={styles.muted}>Không có setup nào khớp bộ lọc.</td></tr>
              )}
              {rows.map((s) => {
                const r = s.status === 'CLOSED' ? s.rMultiple : s.unrealizedR;
                return (
                  <tr key={s.id} className={styles.clickRow} onClick={() => setSelected(selected === s.id ? null : s.id)}>
                    <td>
                      <button type="button" className={styles.btn} style={{ padding: '1px 7px' }} onClick={(e) => { e.stopPropagation(); onOpenCoin(s.symbol); }} title="Mở panel coin">
                        {s.symbol}
                      </button>
                    </td>
                    <td className={s.direction === 'LONG' ? styles.long : styles.short}>{s.direction} <span className={styles.muted}>{s.orderType}</span></td>
                    <td>
                      <StatusBadge status={s.status} />
                      {s.manualIntervention && <span className={styles.muted}> ✋</span>}
                    </td>
                    <td className={styles.muted}>{s.setupType ?? '—'}</td>
                    <td className={styles.numCell}>{fmtPx(s.fillPrice ?? s.entryPrice)}</td>
                    <td className={styles.numCell}>{fmtPx(s.currentStop ?? s.stopLoss)}</td>
                    <td className={styles.numCell}>{fmtPx(s.lastPrice)}</td>
                    <td className={`${styles.numCell} ${rClass(r)}`}>{fmtR(r)}</td>
                    <td className={styles.muted}>{s.source === 'CLAUDE' ? 'Claude' : 'Tự nhập'}</td>
                    <td className={styles.muted}>{fmtDateTime(s.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sel && (
          <div style={{ marginTop: 10 }}>
            <SetupCard setup={sel} onChange={changed} onEdit={setEditing} showSymbol />
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Thống kê lệnh đã đóng</h3>
        <div className={styles.kpis}>
          <Kpi label="Số lệnh" value={String(st.closed)} />
          <Kpi label="Win rate" value={st.winRate != null ? `${Math.round(st.winRate * 100)}%` : '—'} />
          <Kpi label="Tổng R" value={fmtR(st.totalR)} cls={rClass(st.totalR)} />
          <Kpi label="R trung bình" value={fmtR(st.avgR)} cls={rClass(st.avgR)} />
          <Kpi label="Tự chấm TB" value={st.avgRating != null ? `${st.avgRating}/5` : '—'} />
          <Kpi label="1R" value={`$${data.config.riskUsd}`} />
        </div>
        {st.closed > 0 && (
          <div className={styles.grid2} style={{ marginTop: 12 }}>
            <GroupTable title="Theo loại setup" rows={st.bySetupType} />
            <GroupTable title="Theo coin" rows={st.bySymbol} />
            <GroupTable title="Theo hướng" rows={st.byDirection} />
            <GroupTable title="Theo nguồn" rows={st.bySource} />
            <GroupTable title="Can thiệp tay" rows={st.byIntervention} />
            <GroupTable title="Lý do đóng" rows={st.byCloseReason} />
          </div>
        )}
      </div>

      <Lessons lessons={data.lessons} onChanged={() => void load()} />
      <RiskConfig riskUsd={data.config.riskUsd} onSaved={() => void load()} />

      {creating && <SetupFormModal symbols={symbols} onClose={() => setCreating(false)} onSaved={changed} />}
      {editing && <SetupFormModal symbols={symbols} initial={editing} onClose={() => setEditing(null)} onSaved={changed} />}
    </>
  );
}

function Kpi({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} ${cls ?? ''}`}>{value}</div>
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: TrackingGroupStat[] }) {
  return (
    <div>
      <div className={styles.hint} style={{ marginBottom: 4 }}>{title}</div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Nhóm</th><th className={styles.numCell}>Lệnh</th><th className={styles.numCell}>Win</th><th className={styles.numCell}>Tổng R</th><th className={styles.numCell}>TB</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.group}>
                <td>{STATUS_LABEL[r.group as TrackingSetup['status']] ?? r.group}</td>
                <td className={styles.numCell}>{r.trades}</td>
                <td className={styles.numCell}>{Math.round(r.winRate * 100)}%</td>
                <td className={`${styles.numCell} ${rClass(r.totalR)}`}>{fmtR(r.totalR)}</td>
                <td className={`${styles.numCell} ${rClass(r.avgR)}`}>{fmtR(r.avgR)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Lessons({ lessons, onChanged }: { lessons: TrackingOverview['lessons']; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      await api.trackingAction('/lessons/draft');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tạo được bản nháp');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Bài học</h3>
      <p className={styles.hint}>
        Mỗi {lessons.batchSize} lệnh đóng, Claude viết nháp bài học; bạn sửa rồi duyệt — chỉ bài học đã duyệt mới được đưa vào các lần phân tích sau.
        Hiện có {lessons.unbatched}/{lessons.batchSize} lệnh đóng chưa vào đợt nào.
      </p>
      {lessons.canDraft && (
        <button type="button" className={styles.btn} disabled={busy} onClick={() => void draft()}>{busy ? 'Claude đang viết…' : 'Viết nháp bài học'}</button>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <div style={{ marginTop: 10 }}>
        {lessons.batches.map((b) => <LessonBatch key={b.id} batch={b} onSaved={onChanged} />)}
      </div>
    </div>
  );
}

function LessonBatch({ batch, onSaved }: { batch: TrackingLessonBatch; onSaved: () => void }) {
  const [text, setText] = useState(batch.content ?? batch.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.trackingAction(`/lessons/${batch.id}`, { content: text, approve }, 'PUT');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.lesson}>
      <div className={styles.row}>
        <strong>Đợt {fmtDateTime(batch.createdAt)} · {batch.tradeCount} lệnh</strong>
        <span className={`${styles.badge} ${batch.status === 'APPROVED' ? styles.stOPEN : styles.stPENDING}`}>{batch.status === 'APPROVED' ? 'Đã duyệt' : 'Nháp'}</span>
      </div>
      <textarea className={styles.textarea} style={{ minHeight: 160, marginTop: 8 }} value={text} onChange={(e) => setText(e.target.value)} />
      <div className={styles.actions}>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => void save(false)}>Lưu</button>
        {batch.status !== 'APPROVED' && (
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void save(true)}>Duyệt</button>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

function RiskConfig({ riskUsd, onSaved }: { riskUsd: number; onSaved: () => void }) {
  const [value, setValue] = useState(String(riskUsd));
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setMsg(null);
    try {
      await api.trackingAction('/config', { riskUsd: Number(value) }, 'PUT');
      setMsg('Đã lưu — áp dụng cho lệnh đặt từ giờ.');
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Lưu thất bại');
    }
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Cấu hình</h3>
      <div className={styles.row}>
        <span className={styles.hint}>Rủi ro mỗi lệnh (1R, USD)</span>
        <input className={`${styles.input} ${styles.num}`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="button" className={styles.btn} disabled={!(Number(value) > 0) || Number(value) === riskUsd} onClick={() => void save()}>Lưu</button>
        {msg && <span className={styles.hint}>{msg}</span>}
      </div>
    </div>
  );
}
