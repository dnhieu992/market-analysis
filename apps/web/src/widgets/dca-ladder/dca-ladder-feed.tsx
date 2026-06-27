'use client';

import { useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { DcaLadderState, DcaLadderSettings } from '@web/shared/api/types';

const api = createApiClient();

function fmt(n: number | null, d = 2): string {
  return n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function DcaLadderFeed({ initialState }: { initialState: DcaLadderState }) {
  const [state, setState] = useState(initialState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<DcaLadderSettings>(initialState.settings);

  const { settings, cycle, orders, livePrice, summary } = state;

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

      {/* Ladder table */}
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
                onClick={() => editPlanned(o.id, o.plannedPrice)}
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
                ['firstTierPct', 'Tier 1 (% vốn)'],
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
