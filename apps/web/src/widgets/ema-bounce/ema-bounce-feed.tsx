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

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: 'Đang mở', cls: 'eb-badge-open' },
  hit_tp: { label: 'Đã chạm TP +10%', cls: 'eb-badge-tp' },
  expired: { label: 'Hết hạn', cls: 'eb-badge-exp' },
};

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

  const shown = showOpenOnly ? signals.filter((s) => s.status === 'open') : signals;

  return (
    <div className="eb-page">
      <header className="eb-header">
        <div>
          <h1 className="eb-title">EMA Bounce Scanner</h1>
          <p className="eb-sub">
            LONG khi giá dưới cụm <b>EMA34&lt;89&lt;200</b>, giãn <b>7–15%</b> dưới EMA34 và StochRSI %K
            cắt lên %D trong vùng quá bán. TP <b>+10%</b>, không cắt lỗ. Worker tự quét mỗi <b>4h</b> →
            tạo card + gửi Telegram.
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
          <h2 className="eb-h2">Khớp ngay bây giờ ({preview.length})</h2>
          {preview.length === 0 ? (
            <p className="eb-muted">Không có coin nào khớp trên nến 4h vừa đóng.</p>
          ) : (
            <div className="eb-grid">
              {preview.map((m) => (
                <div key={m.symbol} className="eb-mini">
                  <div className="eb-mini-head"><b>{m.symbol}</b><span className="eb-badge eb-badge-open">khớp</span></div>
                  <div className="eb-kv"><span>Giá</span><span>{fmtPrice(m.price)}</span></div>
                  <div className="eb-kv"><span>Cách EMA34</span><span className="eb-red">-{(m.distPct * 100).toFixed(1)}%</span></div>
                  <div className="eb-kv"><span>StochRSI</span><span>%K {m.stochK.toFixed(1)} / %D {m.stochD.toFixed(1)}</span></div>
                  <div className="eb-kv"><span>TP +10%</span><span className="eb-green">{fmtPrice(m.tpPrice)}</span></div>
                </div>
              ))}
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
              const st = STATUS_META[s.status] ?? { label: s.status, cls: 'eb-badge-exp' };
              const pnl = s.pnlPct ?? 0;
              return (
                <div key={s.id} className="eb-signal">
                  <div className="eb-signal-head">
                    <b className="eb-signal-sym">{s.symbol}</b>
                    <span className={`eb-badge ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="eb-signal-pnl" style={{ color: pnl >= 0 ? '#26a69a' : '#ef5350' }}>
                    {fmtPct(pnl)}
                  </div>
                  <div className="eb-kv"><span>Vào lệnh</span><span>{fmtPrice(s.entryPrice)}</span></div>
                  <div className="eb-kv"><span>Hiện tại</span><span>{fmtPrice(s.currentPrice)}</span></div>
                  <div className="eb-kv"><span>TP +10%</span><span className="eb-green">{fmtPrice(s.tpPrice)}</span></div>
                  <div className="eb-kv"><span>Cách EMA34</span><span className="eb-red">-{(s.distPct * 100).toFixed(1)}%</span></div>
                  <div className="eb-kv"><span>RSI</span><span>{s.rsi != null ? s.rsi.toFixed(1) : '—'}</span></div>
                  <div className="eb-kv"><span>StochRSI</span><span>{s.stochK != null ? `%K ${s.stochK.toFixed(1)} / %D ${s.stochD?.toFixed(1)}` : '—'}</span></div>
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
