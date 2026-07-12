'use client';

import { useEffect, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { PatternKind, PatternWatchCoin, PatternScanResult, PatternMatch } from '@web/shared/api/types';

const PATTERN_META: Record<PatternKind, { label: string; dir: 'bullish' | 'bearish' }> = {
  double_bottom: { label: 'Hai đáy', dir: 'bullish' },
  inverse_head_shoulders: { label: 'Vai đầu vai ngược', dir: 'bullish' },
  double_top: { label: 'Hai đỉnh', dir: 'bearish' },
  head_shoulders: { label: 'Vai đầu vai', dir: 'bearish' },
};

/**
 * Rules shown in the info dialog for each pattern. Kept faithful to the actual
 * detector in packages/core/src/analysis/chart-patterns.ts (fractal wing 5, 3%
 * "equal" tolerance, ≥5% amplitude, 10–60 bar gap, 25-bar recency, failed
 * right-leg rejection, 4% stale-breakout cutoff).
 */
const PATTERN_RULES: Record<PatternKind, { intro: string; rules: string[] }> = {
  double_bottom: {
    intro: 'Mô hình đảo chiều TĂNG. Sau một nhịp giảm, giá tạo hai đáy xấp xỉ bằng nhau (hình chữ W); phá vỡ neckline xác nhận đảo chiều.',
    rules: [
      'Hai đáy được xác nhận bằng fractal: mỗi đáy phải thấp hơn 5 nến ở mỗi bên.',
      'Hai đáy “bằng nhau”: chênh lệch ≤ 3%.',
      'Hai đáy cách nhau 10–60 nến.',
      'Neckline = đỉnh cao nhất nằm giữa hai đáy, phải cao hơn đáy ≥ 5% (biên độ mô hình).',
      'Đáy phải là vùng thấp nhất của cửa sổ xung quanh (đáy thực sự, không phải swing giữa xu hướng).',
      'Loại nếu nhịp hồi sau đáy 2 chỉ tạo một đỉnh THẤP HƠN neckline rồi quay đầu (right leg hỏng — thực chất là bị từ chối, không phải hai đáy).',
      'Đáy thứ 2 phải hoàn thiện trong 25 nến gần nhất (còn mới).',
      'Bỏ nếu giá đã phá neckline và chạy quá 4% (breakout cũ, không còn vào lệnh được).',
      'Target = neckline + (neckline − đáy). Stop = dưới đáy 0.5%.',
    ],
  },
  double_top: {
    intro: 'Mô hình đảo chiều GIẢM. Sau một nhịp tăng, giá tạo hai đỉnh xấp xỉ bằng nhau (hình chữ M); phá vỡ neckline xác nhận đảo chiều.',
    rules: [
      'Hai đỉnh được xác nhận bằng fractal: mỗi đỉnh phải cao hơn 5 nến ở mỗi bên.',
      'Hai đỉnh “bằng nhau”: chênh lệch ≤ 3%.',
      'Hai đỉnh cách nhau 10–60 nến.',
      'Neckline = đáy thấp nhất nằm giữa hai đỉnh, phải thấp hơn đỉnh ≥ 5% (biên độ mô hình).',
      'Đỉnh phải là vùng cao nhất của cửa sổ xung quanh (đỉnh thực sự).',
      'Loại nếu nhịp giảm sau đỉnh 2 chỉ tạo một đáy CAO HƠN neckline rồi bật lại (right leg hỏng).',
      'Đỉnh thứ 2 phải hoàn thiện trong 25 nến gần nhất (còn mới).',
      'Bỏ nếu giá đã phá neckline và chạy quá 4% (breakout cũ).',
      'Target = neckline − (đỉnh − neckline). Stop = trên đỉnh 0.5%.',
    ],
  },
  inverse_head_shoulders: {
    intro: 'Mô hình đảo chiều TĂNG. Ba đáy: đáy giữa (đầu) thấp nhất, hai vai hai bên nông hơn và xấp xỉ bằng nhau; phá neckline xác nhận.',
    rules: [
      'Ba đáy xác nhận bằng fractal (thấp hơn 5 nến mỗi bên); đáy giữa (đầu) phải thấp hơn cả hai vai.',
      'Hai vai xấp xỉ bằng nhau: chênh lệch ≤ 3%.',
      'Đối xứng thời gian: khoảng cách vai trái→đầu và đầu→vai phải lệch nhau ≤ 50% tổng nhịp.',
      'Neckline = trung bình hai đỉnh phản ứng (giữa vai và đầu). Biên độ đầu→neckline ≥ 5%.',
      'Vai phải nằm giữa neckline và đầu, độ sâu 15–70% độ sâu của đầu (không quá nông cũng không quá sâu).',
      'Đầu phải là vùng thấp nhất của cả mô hình.',
      'Bỏ nếu giá đã phá neckline và chạy quá 4% (breakout cũ).',
      'Target = neckline + (neckline − đầu). Stop = dưới đầu 0.5%.',
    ],
  },
  head_shoulders: {
    intro: 'Mô hình đảo chiều GIẢM. Ba đỉnh: đỉnh giữa (đầu) cao nhất, hai vai hai bên thấp hơn và xấp xỉ bằng nhau; phá neckline xác nhận.',
    rules: [
      'Ba đỉnh xác nhận bằng fractal (cao hơn 5 nến mỗi bên); đỉnh giữa (đầu) phải cao hơn cả hai vai.',
      'Hai vai xấp xỉ bằng nhau: chênh lệch ≤ 3%.',
      'Đối xứng thời gian: khoảng cách vai trái→đầu và đầu→vai phải lệch nhau ≤ 50% tổng nhịp.',
      'Neckline = trung bình hai đáy phản ứng (giữa vai và đầu). Biên độ đầu→neckline ≥ 5%.',
      'Vai phải nằm giữa neckline và đầu, độ sâu 15–70% độ sâu của đầu.',
      'Đầu phải là vùng cao nhất của cả mô hình.',
      'Bỏ nếu giá đã phá neckline và chạy quá 4% (breakout cũ).',
      'Target = neckline − (đầu − neckline). Stop = trên đầu 0.5%.',
    ],
  },
};

const PATTERN_ORDER: PatternKind[] = ['double_bottom', 'double_top', 'head_shoulders', 'inverse_head_shoulders'];

const TIMEFRAMES = [
  { value: '1d', label: 'D1 (ngày)' },
  { value: '4h', label: 'H4' },
  { value: '1w', label: 'W1 (tuần)' },
  { value: '1h', label: 'H1' },
];

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toFixed(8);
}

const apiClient = createApiClient();

export function PatternScannerFeed({ initialCoins }: { initialCoins: PatternWatchCoin[] }) {
  const [coins, setCoins] = useState<PatternWatchCoin[]>(initialCoins);
  const [selected, setSelected] = useState<Set<PatternKind>>(new Set(PATTERN_ORDER));
  const [timeframe, setTimeframe] = useState('1d');
  const [newSymbol, setNewSymbol] = useState('');
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<PatternScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoPattern, setInfoPattern] = useState<PatternKind | null>(null);

  function togglePattern(p: PatternKind) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    setAdding(true);
    setError(null);
    try {
      const coin = await apiClient.addPatternCoin(sym);
      setCoins((prev) => (prev.some((c) => c.symbol === coin.symbol) ? prev : [...prev, coin]));
      setNewSymbol('');
    } catch {
      setError(`Không thêm được ${sym}.`);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(symbol: string) {
    try {
      await apiClient.removePatternCoin(symbol);
      setCoins((prev) => prev.filter((c) => c.symbol !== symbol));
    } catch { /* ignore */ }
  }

  async function handleScan() {
    if (selected.size === 0) { setError('Chọn ít nhất 1 pattern.'); return; }
    if (coins.length === 0) { setError('Watchlist trống — thêm coin trước.'); return; }
    setScanning(true);
    setError(null);
    try {
      const patterns = PATTERN_ORDER.filter((p) => selected.has(p));
      const res = await apiClient.scanPatterns(patterns, timeframe);
      setResult(res);
    } catch {
      setError('Scan lỗi. Thử lại.');
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="ps">
      <header className="ps-header">
        <h1 className="ps-title">Pattern Scanner</h1>
        <p className="ps-sub">Quét watchlist theo mô hình giá (2 đáy, 2 đỉnh, vai đầu vai…) để lọc coin đáng chú ý.</p>
      </header>

      {/* Watchlist */}
      <section className="ps-card">
        <div className="ps-card-head">
          <h2>Watchlist <span className="ps-count">{coins.length}</span></h2>
          <form className="ps-add" onSubmit={handleAdd}>
            <input
              className="setup-input"
              placeholder="Mã coin (VD: BTC)"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
            />
            <button className="btn btn--primary" type="submit" disabled={adding}>+ Thêm</button>
          </form>
        </div>
        {coins.length === 0 ? (
          <p className="scr-muted">Chưa có coin. Thêm mã để bắt đầu.</p>
        ) : (
          <div className="ps-chips">
            {coins.map((c) => (
              <span key={c.id} className="ps-chip">
                {c.symbol}
                <button className="ps-chip-x" onClick={() => handleRemove(c.symbol)} aria-label={`Xóa ${c.symbol}`}>✕</button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Controls */}
      <section className="ps-card">
        <h2>Pattern cần quét</h2>
        <div className="ps-patterns">
          {PATTERN_ORDER.map((p) => {
            const m = PATTERN_META[p];
            return (
              <label key={p} className={`ps-check ps-check--${m.dir}`}>
                <input type="checkbox" checked={selected.has(p)} onChange={() => togglePattern(p)} />
                <span>{m.label}</span>
                <span className={`ps-dir ps-dir--${m.dir}`}>{m.dir === 'bullish' ? '↑' : '↓'}</span>
                <button
                  type="button"
                  className="ps-info"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setInfoPattern(p); }}
                  aria-label={`Quy tắc mô hình ${m.label}`}
                  title="Xem quy tắc mô hình"
                >
                  i
                </button>
              </label>
            );
          })}
        </div>
        <div className="ps-actions">
          <label className="ps-tf">
            Khung
            <select className="setup-input" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              {TIMEFRAMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <button className="btn btn--primary ps-scan" onClick={handleScan} disabled={scanning}>
            {scanning ? 'Đang quét…' : '🔍 Scan'}
          </button>
        </div>
        {error && <p className="scr-muted ord-error">{error}</p>}
      </section>

      {/* Results */}
      {result && (
        <section className="ps-card">
          <div className="ps-card-head">
            <h2>Kết quả <span className="ps-count">{result.coins.length}</span></h2>
            <span className="scr-muted">
              {result.scanned} coin · {result.timeframe.toUpperCase()} · {new Date(result.scannedAt).toLocaleString('vi-VN')}
              {result.failed > 0 && ` · ${result.failed} lỗi`}
            </span>
          </div>
          {result.coins.length === 0 ? (
            <p className="scr-muted">Không coin nào khớp pattern đã chọn.</p>
          ) : (
            <div className="ps-results">
              {result.coins.map((coin) => (
                <div key={coin.symbol} className="ps-result">
                  <div className="ps-result-head">
                    <span className="scr-symbol">{coin.symbol}</span>
                    <span className="scr-muted">${fmtPrice(coin.price)}</span>
                  </div>
                  <div className="ps-matches">
                    {coin.matches.map((m, i) => <MatchRow key={i} m={m} onInfo={setInfoPattern} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {infoPattern && (
        <PatternRuleDialog pattern={infoPattern} onClose={() => setInfoPattern(null)} />
      )}
    </div>
  );
}

function PatternRuleDialog({ pattern, onClose }: { pattern: PatternKind; onClose: () => void }) {
  const meta = PATTERN_META[pattern];
  const rule = PATTERN_RULES[pattern];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="dialog-header">
          <span className="dialog-title">
            {meta.label}
            <span className={`ps-dir ps-dir--${meta.dir}`} style={{ marginLeft: 8 }}>
              {meta.dir === 'bullish' ? 'Tăng ↑' : 'Giảm ↓'}
            </span>
          </span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="dialog-body">
          <p className="ps-rule-intro">{rule.intro}</p>
          <p className="notes-section-label">Điều kiện scanner nhận diện</p>
          <ul className="ps-rule-list">
            {rule.rules.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

function MatchRow({ m, onInfo }: { m: PatternMatch; onInfo: (p: PatternKind) => void }) {
  const meta = PATTERN_META[m.pattern];
  return (
    <div className={`ps-match ps-match--${m.direction}`}>
      <div className="ps-match-top">
        <span className="ps-match-name">{meta.label}</span>
        <button
          type="button"
          className="ps-info"
          onClick={() => onInfo(m.pattern)}
          aria-label={`Quy tắc mô hình ${meta.label}`}
          title="Xem quy tắc mô hình"
        >
          i
        </button>
        <span className={`ps-badge ps-badge--${m.status}`}>{m.status === 'confirmed' ? 'Đã phá neckline' : 'Đang hình thành'}</span>
        <span className={`ps-dir ps-dir--${m.direction}`}>{m.direction === 'bullish' ? 'Tăng ↑' : 'Giảm ↓'}</span>
        <span className="scr-muted ps-match-meta">biên độ {m.heightPct}% · {m.barsAgo} nến trước</span>
      </div>
      <div className="ps-levels">
        <span>Neckline <b>${fmtPrice(m.neckline)}</b></span>
        <span>Target <b>${fmtPrice(m.target)}</b></span>
        <span>Stop <b>${fmtPrice(m.stop)}</b></span>
      </div>
    </div>
  );
}
