'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { EmaBounceCoin, EmaBounceSignal, EmaBounceMatch } from '@web/shared/api/types';

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const STAGE_META: Record<string, { label: string; cls: string }> = {
  near: { label: '⏳ Gần thoả mãn', cls: 'eb-badge-near' },
  reach: { label: '🟢 Thoả mãn', cls: 'eb-badge-reach' },
  risk: { label: '🔔 Gần TP', cls: 'eb-badge-risk' },
};

/** Badge for a persisted card: closed states win, otherwise show the monitoring stage. */
function badgeFor(s: { status: string; stage: string }): { label: string; cls: string } {
  if (s.status === 'hit_tp') return { label: 'Đã chạm TP +10%', cls: 'eb-badge-tp' };
  if (s.status === 'expired') return { label: 'Hết hạn', cls: 'eb-badge-exp' };
  return STAGE_META[s.stage] ?? STAGE_META.reach!;
}

function tfLabel(tf: string): string {
  return tf === '1d' ? '1D' : tf === '4h' ? '4H' : tf.toUpperCase();
}

export function EmaBounceFeed({
  initialCoins,
  initialSignals,
}: {
  initialCoins: EmaBounceCoin[];
  initialSignals: EmaBounceSignal[];
}) {
  const api = createApiClient();
  const [coins, setCoins] = useState<EmaBounceCoin[]>(initialCoins);
  const [signals, setSignals] = useState<EmaBounceSignal[]>(initialSignals);
  const [newSymbol, setNewSymbol] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EmaBounceMatch[] | null>(null);
  const [showOpenOnly, setShowOpenOnly] = useState(false);
  const [tfFilter, setTfFilter] = useState<'all' | '4h' | '1d'>('all');
  const [stageFilter, setStageFilter] = useState<'all' | 'near' | 'reach' | 'risk'>('all');

  async function addCoin() {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    setBusy(true);
    setError(null);
    try {
      const coin = await api.addEmaBounceCoin(sym);
      setCoins((prev) => (prev.some((c) => c.symbol === coin.symbol) ? prev : [...prev, coin]));
      setNewSymbol('');
    } catch {
      setError(`Không thêm được ${sym}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeCoin(symbol: string) {
    setBusy(true);
    try {
      await api.removeEmaBounceCoin(symbol);
      setCoins((prev) => prev.filter((c) => c.symbol !== symbol));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSignals() {
    setBusy(true);
    try {
      setSignals(await api.fetchEmaBounceSignals(showOpenOnly));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.previewEmaBounce();
      setPreview(res.matches);
    } catch {
      setError('Quét thất bại');
    } finally {
      setBusy(false);
    }
  }

  const shown = signals
    .filter((s) => (showOpenOnly ? s.status === 'open' : true))
    .filter((s) => (tfFilter === 'all' ? true : s.timeframe === tfFilter))
    .filter((s) => (stageFilter === 'all' ? true : s.stage === stageFilter));

  return (
    <div className="eb-page">
      <header className="eb-header">
        <div>
          <h1 className="eb-title">EMA Bounce Scanner</h1>
          <p className="eb-sub">
            LONG khi giá dưới cụm <b>EMA34&lt;89&lt;200</b>, giãn <b>7–15%</b> dưới EMA34 và StochRSI %K
            cắt lên %D trong vùng quá bán. TP <b>+10%</b>, không cắt lỗ. Worker tự quét khung <b>4H</b> (mỗi 4h)
            và <b>D1</b> (mỗi ngày).
          </p>
          <p className="eb-sub">
            Mỗi card đi qua 3 giai đoạn: <b className="eb-near">⏳ Gần thoả mãn</b> (giãn 5–18%, StochRSI sắp/vừa cắt —
            để canh chart) → <b className="eb-reach">🟢 Thoả mãn</b> (đủ điều kiện vào lệnh) →{' '}
            <b className="eb-risk">🔔 Gần TP</b> (giá đã gần chạm TP +10%). Mỗi lần đổi giai đoạn đều gửi Telegram.
          </p>
        </div>
      </header>

      {error && <div className="eb-error">{error}</div>}

      {/* Watchlist manager */}
      <section className="eb-card eb-watchlist">
        <div className="eb-row">
          <input
            className="eb-input"
            placeholder="Thêm coin (VD: SOL)"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCoin()}
            disabled={busy}
          />
          <button className="eb-btn eb-btn-primary" onClick={addCoin} disabled={busy}>Thêm</button>
          <button className="eb-btn" onClick={runPreview} disabled={busy || coins.length === 0}>Quét ngay</button>
        </div>
        <div className="eb-chips">
          {coins.length === 0 && <span className="eb-muted">Chưa có coin nào trong danh sách theo dõi.</span>}
          {coins.map((c) => (
            <span key={c.id} className="eb-chip">
              {c.symbol}
              <button className="eb-chip-x" onClick={() => removeCoin(c.symbol)} disabled={busy} title="Xoá">×</button>
            </span>
          ))}
        </div>
      </section>

      {/* Live preview matches */}
      {preview && (
        <section className="eb-card">
          <h2 className="eb-h2">Gần / khớp ngay bây giờ ({preview.length})</h2>
          {preview.length === 0 ? (
            <p className="eb-muted">Không có coin nào gần hoặc khớp trên nến vừa đóng.</p>
          ) : (
            <div className="eb-grid">
              {preview.map((m) => {
                const meta = STAGE_META[m.stage] ?? STAGE_META.reach!;
                return (
                  <div key={`${m.symbol}-${m.timeframe}`} className="eb-mini">
                    <div className="eb-mini-head">
                      <b>{m.symbol} <span className="eb-tf">{tfLabel(m.timeframe)}</span></b>
                      <span className={`eb-badge ${meta.cls}`}>{meta.label}</span>
                    </div>
                    <div className="eb-kv"><span>Giá</span><span>{fmtPrice(m.price)}</span></div>
                    <div className="eb-kv"><span>Cách EMA34</span><span className="eb-red">-{(m.distPct * 100).toFixed(1)}%</span></div>
                    <div className="eb-kv"><span>StochRSI</span><span>%K {m.stochK.toFixed(1)} / %D {m.stochD.toFixed(1)}</span></div>
                    <div className="eb-kv"><span>TP +10%</span><span className="eb-green">{fmtPrice(m.tpPrice)}</span></div>
                    {m.note && <div className="eb-signal-note">{m.note}</div>}
                  </div>
                );
              })}
            </div>
          )}
          <p className="eb-note">Đây là bản xem nhanh (không lưu). Card &amp; Telegram do worker tạo mỗi 4h.</p>
        </section>
      )}

      {/* Signal cards */}
      <section className="eb-card">
        <div className="eb-row eb-between">
          <h2 className="eb-h2">Tín hiệu ({shown.length})</h2>
          <div className="eb-row">
            <select className="eb-select" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as 'all' | 'near' | 'reach' | 'risk')}>
              <option value="all">Mọi giai đoạn</option>
              <option value="near">⏳ Gần thoả mãn</option>
              <option value="reach">🟢 Thoả mãn</option>
              <option value="risk">🔔 Gần TP</option>
            </select>
            <select className="eb-select" value={tfFilter} onChange={(e) => setTfFilter(e.target.value as 'all' | '4h' | '1d')}>
              <option value="all">Tất cả khung</option>
              <option value="4h">4H</option>
              <option value="1d">1D</option>
            </select>
            <label className="eb-check">
              <input type="checkbox" checked={showOpenOnly} onChange={(e) => setShowOpenOnly(e.target.checked)} />
              Chỉ đang mở
            </label>
            <button className="eb-btn" onClick={refreshSignals} disabled={busy}>Làm mới</button>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="eb-muted">Chưa có tín hiệu nào. Worker sẽ quét vào lần đóng nến 4h kế tiếp.</p>
        ) : (
          <div className="eb-grid">
            {shown.map((s) => {
              const st = badgeFor(s);
              const pnl = s.pnlPct ?? 0;
              return (
                <div key={s.id} className="eb-signal">
                  <div className="eb-signal-head">
                    <b className="eb-signal-sym">{s.symbol} <span className="eb-tf">{tfLabel(s.timeframe)}</span></b>
                    <span className={`eb-badge ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="eb-signal-pnl" style={{ color: pnl >= 0 ? '#26a69a' : '#ef5350' }}>
                    {fmtPct(pnl)}
                  </div>
                  <div className="eb-kv"><span>{s.stage === 'near' ? 'Giá canh' : 'Vào lệnh'}</span><span>{fmtPrice(s.entryPrice)}</span></div>
                  <div className="eb-kv"><span>Hiện tại</span><span>{fmtPrice(s.currentPrice)}</span></div>
                  <div className="eb-kv"><span>TP +10%</span><span className="eb-green">{fmtPrice(s.tpPrice)}</span></div>
                  <div className="eb-kv"><span>Cách EMA34</span><span className="eb-red">-{(s.distPct * 100).toFixed(1)}%</span></div>
                  <div className="eb-kv"><span>RSI</span><span>{s.rsi != null ? s.rsi.toFixed(1) : '—'}</span></div>
                  <div className="eb-kv"><span>StochRSI</span><span>{s.stochK != null ? `%K ${s.stochK.toFixed(1)} / %D ${s.stochD?.toFixed(1)}` : '—'}</span></div>
                  {s.note && <div className="eb-signal-note">{s.note}</div>}
                  <div className="eb-kv eb-kv-time"><span>Kích hoạt</span><span>{fmtTime(s.triggeredAt)}</span></div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
