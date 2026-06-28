'use client';

import { useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { DcaLadderState, DcaLadderSettings, DcaLadderTimingSignal } from '@web/shared/api/types';

const api = createApiClient();

function fmt(n: number | null, d = 2): string {
  return n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const ZONE_INFO: Record<DcaLadderTimingSignal['zone'], { label: string; advice: string }> = {
  GOM: { label: '✅ GOM', advice: 'Hợp lý để bắt đầu / thêm 1 tier DCA (RSI ≤ 35 & gần đáy 20 ngày).' },
  CHO: { label: '⏳ CHỜ', advice: 'Chưa tới điểm gom — chờ giá về sâu hơn hoặc RSI ≤ 35.' },
  CHOT: { label: '🎯 CHỐT', advice: 'Giá đã vượt lại EMA34 — vùng chốt lời, không phải lúc gom.' },
};

const TREND_LABEL: Record<DcaLadderTimingSignal['weekTrend'], string> = {
  StrongUp: 'Tăng mạnh', Up: 'Tăng', Neutral: 'Đi ngang', Down: 'Giảm', StrongDown: 'Giảm mạnh',
};

/** Weekly bull (Up/StrongUp) starts shallow; bear/neutral starts deep — mirrors core effectiveFirstTierPct. */
function effectiveFirstTier(weekTrend: DcaLadderTimingSignal['weekTrend'], s: DcaLadderSettings): number {
  return weekTrend === 'Up' || weekTrend === 'StrongUp' ? s.firstTierPct : s.bearFirstTierPct;
}

export function DcaLadderFeed({ initialState }: { initialState: DcaLadderState }) {
  const [state, setState] = useState(initialState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<DcaLadderSettings>(initialState.settings);

  const { settings, cycle, orders, livePrice, summary, timingSignal } = state;

  const deployed = orders
    .filter((o) => o.side === 'BUY' && o.status === 'FILLED')
    .reduce((a, o) => a + (o.usdAmount ?? 0), 0);

  async function confirmFill(id: string, planned: number) {
    const raw = window.prompt('Giá khớp thực tế:', String(planned));
    if (!raw) return;
    setState(await api.fillDcaOrder(id, Number(raw)));
  }

  async function editPlanned(id: string, planned: number) {
    const raw = window.prompt('Sửa giá dự kiến:', String(planned));
    if (!raw) return;
    setState(await api.updateDcaOrder(id, { plannedPrice: Number(raw) }));
  }

  async function editFill(id: string, fill: number) {
    const raw = window.prompt('Sửa giá khớp:', String(fill));
    if (!raw) return;
    setState(await api.updateDcaOrder(id, { fillPrice: Number(raw) }));
  }

  async function unfill(id: string) {
    setState(await api.unfillDcaOrder(id));
  }

  async function closeTp(planned: number) {
    const raw = window.prompt('Giá bán TP (100%):', String(planned));
    if (!raw) return;
    setState(await api.closeDcaCycle(Number(raw)));
  }

  async function saveSettings() {
    setState(await api.updateDcaLadderSettings(settingsDraft));
    setSettingsOpen(false);
  }

  return (
    <div className="dcal">
      {/* Summary cards */}
      <div className="dcal-cards">
        <div className="dcal-card">
          <span>Số cycle</span>
          <strong>{summary.cycleCount}</strong>
        </div>
        <div className="dcal-card">
          <span>Lệnh khớp / cycle</span>
          <strong>{summary.avgFillsPerCycle.toFixed(1)}</strong>
        </div>
        <div className="dcal-card">
          <span>Lãi đã thực hiện</span>
          <strong className={summary.realizedPnl >= 0 ? 'pos' : 'neg'}>${fmt(summary.realizedPnl)}</strong>
        </div>
        <div className="dcal-card">
          <span>Lãi chưa thực hiện</span>
          <strong className={summary.unrealizedPnl >= 0 ? 'pos' : 'neg'}>${fmt(summary.unrealizedPnl)}</strong>
        </div>
      </div>

      {/* Current cycle info */}
      <div className="dcal-cycle">
        <span className={`dcal-badge dcal-${cycle.status.toLowerCase()}`}>{cycle.status}</span>
        <span>Cycle #{cycle.cycleNumber}</span>
        <span>Peak {fmt(cycle.peak)}</span>
        <span>Giá vốn TB {fmt(cycle.avgCost)}</span>
        <span>Vốn đã vào ${fmt(deployed)}</span>
        <span>TP {fmt(cycle.tpPrice)}</span>
        <span>Budget ${fmt(cycle.budget)}</span>
        <span>Giá BTC {fmt(livePrice)}</span>
      </div>

      {/* DCA timing signal (chiến lược /tracking-coins áp cho BTC) */}
      {timingSignal && (
        <div className={`dcal-signal dcal-zone-${timingSignal.zone.toLowerCase()}`}>
          <div className="dcal-signal-head">
            <span className="dcal-signal-zone">{ZONE_INFO[timingSignal.zone].label}</span>
            <span className="dcal-signal-advice">{ZONE_INFO[timingSignal.zone].advice}</span>
            <span className={`dcal-signal-score dcal-bucket-${timingSignal.bucket}`}>
              An toàn {timingSignal.score}/100 · {timingSignal.bucket}
            </span>
          </div>
          <div className="dcal-signal-metrics">
            <span>RSI D1 <strong>{fmt(timingSignal.rsi, 1)}</strong></span>
            <span>EMA34 <strong>{timingSignal.ema34Above == null ? '—' : timingSignal.ema34Above ? 'trên' : 'dưới'}</strong></span>
            <span>Trên đáy 20N <strong>{timingSignal.low20Pct == null ? '—' : `${fmt(timingSignal.low20Pct, 1)}%`}</strong></span>
            <span>Xu hướng tuần <strong>{TREND_LABEL[timingSignal.weekTrend]}</strong></span>
            <span>Tier 1 hiệu lực <strong>{effectiveFirstTier(timingSignal.weekTrend, settings)}%</strong> dưới đỉnh</span>
          </div>
        </div>
      )}

      {/* Ladder table */}
      <div className="dcal-table-wrap">
      <table className="dcal-table">
        <thead>
          <tr>
            <th>Tier</th>
            <th>Giá dự kiến</th>
            <th>Trạng thái</th>
            <th>Giá khớp</th>
            <th>USD</th>
            <th>Qty</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className={o.status === 'PENDING_FILL' ? 'dcal-pending' : ''}>
              <td>{o.side === 'SELL' ? 'TP' : `#${(o.tierIndex ?? 0) + 1}`}</td>
              <td
                onClick={() => void editPlanned(o.id, o.plannedPrice)}
                className="dcal-edit"
              >
                {fmt(o.plannedPrice)}
              </td>
              <td>
                <span className={`dcal-ostatus dcal-${o.status.toLowerCase()}`}>{o.status}</span>
              </td>
              <td
                className={o.status === 'FILLED' ? 'dcal-edit' : ''}
                onClick={() => {
                  if (o.status === 'FILLED' && o.fillPrice != null) {
                    void editFill(o.id, o.fillPrice);
                  }
                }}
              >
                {fmt(o.fillPrice)}
              </td>
              <td>{o.usdAmount == null ? '—' : `$${fmt(o.usdAmount)}`}</td>
              <td>{fmt(o.qty, 6)}</td>
              <td>
                {o.side === 'BUY' && o.status !== 'FILLED' && o.status !== 'CANCELLED' && (
                  <button onClick={() => void confirmFill(o.id, o.plannedPrice)}>
                    Xác nhận khớp
                  </button>
                )}
                {o.side === 'BUY' && o.status === 'FILLED' && (
                  <button onClick={() => void unfill(o.id)}>Hoàn tác</button>
                )}
                {o.side === 'SELL' && (o.status === 'ARMED' || o.status === 'PENDING_FILL') && (
                  <button onClick={() => void closeTp(o.plannedPrice)}>Chốt TP</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* Settings panel toggle */}
      <div style={{ marginTop: 20 }}>
        <button onClick={() => { setSettingsDraft(settings); setSettingsOpen((v) => !v); }}>
          {settingsOpen ? 'Ẩn cài đặt' : 'Cài đặt ladder'}
        </button>
      </div>

      {settingsOpen && (
        <div className="dcal-settings">
          <h3>Cài đặt DCA Ladder</h3>
          <div className="dcal-settings-grid">
            {(
              [
                ['startCapital', 'Vốn ban đầu ($)'],
                ['firstTierPct', 'Tier 1 — tuần bull (%)'],
                ['bearFirstTierPct', 'Tier 1 — tuần bear (%)'],
                ['numTiers', 'Số tier'],
                ['stepPct', 'Bước giảm (%)'],
                ['tpPct', 'TP (%)'],
                ['feePct', 'Phí (%)'],
              ] as [keyof DcaLadderSettings, string][]
            ).map(([key, label]) => (
              <label key={key} className="dcal-settings-field">
                <span>{label}</span>
                <input
                  type="number"
                  value={settingsDraft[key] as number}
                  onChange={(e) =>
                    setSettingsDraft((d) => ({ ...d, [key]: Number(e.target.value) }))
                  }
                />
              </label>
            ))}
            <label className="dcal-settings-field">
              <span>Bật</span>
              <input
                type="checkbox"
                checked={settingsDraft.enabled}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, enabled: e.target.checked }))}
              />
            </label>
          </div>
          <button onClick={() => void saveSettings()}>Lưu</button>
        </div>
      )}
    </div>
  );
}
