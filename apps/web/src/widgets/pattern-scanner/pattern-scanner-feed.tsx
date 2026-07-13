'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import type { PatternKind, PatternWatchCoin, PatternScanResult, PatternMatch, PatternReferenceImage, CoinIndicators } from '@web/shared/api/types';

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
      'Đầu phải là đáy đơn, cô lập: không có đáy nào khác giữa hai vai nằm trong 3% của đầu (tránh nhầm đáy đôi rộng thành vai-đầu-vai).',
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
      'Đầu phải là đỉnh đơn, cô lập: không có đỉnh nào khác giữa hai vai nằm trong 3% của đầu (tránh nhầm đỉnh đôi rộng thành vai-đầu-vai).',
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
  const [selectedInds, setSelectedInds] = useState<Set<'rsi' | 'sonic-r'>>(new Set(['rsi', 'sonic-r']));
  const [timeframe, setTimeframe] = useState('1d');
  const [newSymbol, setNewSymbol] = useState('');
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<PatternScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoPattern, setInfoPattern] = useState<PatternKind | null>(null);
  const [infoIndicator, setInfoIndicator] = useState<'rsi' | 'sonic-r' | null>(null);

  function togglePattern(p: PatternKind) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  function toggleInd(k: 'rsi' | 'sonic-r') {
    setSelectedInds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
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

        <div className="ps-ind-section">
          <p className="ps-ind-section-title">Chỉ báo đánh giá</p>
          <div className="ps-patterns">
            <label className="ps-check ps-check--indicator">
              <input type="checkbox" checked={selectedInds.has('rsi')} onChange={() => toggleInd('rsi')} />
              <span>RSI(14)</span>
            </label>
            <label className="ps-check ps-check--indicator">
              <input type="checkbox" checked={selectedInds.has('sonic-r')} onChange={() => toggleInd('sonic-r')} />
              <span>Sonic R</span>
              <span className="ps-check-sub">EMA 34 · 89 · 200</span>
            </label>
          </div>
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
                  <IndicatorRows price={coin.price} ind={coin.indicators} show={selectedInds} onInfo={setInfoIndicator} />
                  <div className="ps-matches">
                    {coin.matches.map((m, i) => (
                      <MatchRow
                        key={i}
                        m={m}
                        series={{ opens: coin.opens, highs: coin.highs, lows: coin.lows, closes: coin.closes }}
                        onInfo={setInfoPattern}
                      />
                    ))}
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
      {infoIndicator && (
        <IndicatorRuleDialog indicator={infoIndicator} onClose={() => setInfoIndicator(null)} />
      )}
    </div>
  );
}

function PatternRuleDialog({ pattern, onClose }: { pattern: PatternKind; onClose: () => void }) {
  const meta = PATTERN_META[pattern];
  const rule = PATTERN_RULES[pattern];
  const [tab, setTab] = useState<'rules' | 'refs'>('rules');
  const [refs, setRefs] = useState<PatternReferenceImage[]>([]);
  const [refsLoaded, setRefsLoaded] = useState(false);
  const [refsLoading, setRefsLoading] = useState(false);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [newNotes, setNewNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<PatternReferenceImage | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (lightbox) setLightbox(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, lightbox]);

  async function loadRefs() {
    if (refsLoaded || refsLoading) return;
    setRefsLoading(true);
    try {
      const data = await apiClient.fetchPatternReferences(pattern);
      setRefs(data);
      setRefsLoaded(true);
    } finally {
      setRefsLoading(false);
    }
  }

  function switchTab(t: 'rules' | 'refs') {
    setTab(t);
    if (t === 'refs') loadRefs();
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPickedFile(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!pickedFile) return;
    setAdding(true);
    try {
      const img = await apiClient.uploadPatternReference(pattern, pickedFile, newNotes.trim() || undefined);
      setRefs((prev) => [img, ...prev]);
      setPickedFile(null);
      if (preview) { URL.revokeObjectURL(preview); setPreview(null); }
      setNewNotes('');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await apiClient.removePatternReference(id);
      setRefs((prev) => prev.filter((r) => r.id !== id));
      if (lightbox?.id === id) setLightbox(null);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={lightbox ? () => setLightbox(null) : onClose}>
      {lightbox && (
        <div className="ps-ref-lightbox" onClick={(e) => e.stopPropagation()}>
          <button className="dialog-close ps-ref-lightbox-close" onClick={() => setLightbox(null)} aria-label="Đóng">✕</button>
          <img src={lightbox.imageUrl} alt={lightbox.notes ?? 'Reference'} className="ps-ref-lightbox-img" />
          {lightbox.notes && <p className="ps-ref-lightbox-notes">{lightbox.notes}</p>}
        </div>
      )}
      {!lightbox && (
        <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="dialog-header">
            <span className="dialog-title">
              {meta.label}
              <span className={`ps-dir ps-dir--${meta.dir}`} style={{ marginLeft: 8 }}>
                {meta.dir === 'bullish' ? 'Tăng ↑' : 'Giảm ↓'}
              </span>
            </span>
            <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
          </div>
          <div className="ps-ref-tabs">
            <button className={`ps-ref-tab${tab === 'rules' ? ' ps-ref-tab--active' : ''}`} onClick={() => switchTab('rules')}>Quy tắc</button>
            <button className={`ps-ref-tab${tab === 'refs' ? ' ps-ref-tab--active' : ''}`} onClick={() => switchTab('refs')}>Ảnh thực tế</button>
          </div>
          {tab === 'rules' && (
            <div className="dialog-body">
              <p className="ps-rule-intro">{rule.intro}</p>
              <p className="notes-section-label">Điều kiện scanner nhận diện</p>
              <ul className="ps-rule-list">
                {rule.rules.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {tab === 'refs' && (
            <div className="dialog-body">
              <form className="ps-ref-add" onSubmit={handleAdd}>
                <label className="ps-ref-file-label">
                  <input
                    type="file"
                    accept="image/*"
                    className="ps-ref-file-input"
                    onChange={handleFilePick}
                    disabled={adding}
                  />
                  <span className="btn btn--secondary ps-ref-file-btn">
                    {pickedFile ? pickedFile.name : 'Chọn ảnh…'}
                  </span>
                </label>
                {preview && (
                  <img src={preview} alt="preview" className="ps-ref-preview" />
                )}
                <textarea
                  className="setup-input ps-ref-notes-input"
                  placeholder="Notes (tuỳ chọn)"
                  rows={2}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  disabled={adding}
                />
                <button className="btn btn--primary" type="submit" disabled={adding || !pickedFile}>
                  {adding ? 'Đang upload…' : '+ Upload'}
                </button>
              </form>
              {refsLoading && <p className="scr-muted" style={{ marginTop: 12 }}>Đang tải…</p>}
              {refsLoaded && refs.length === 0 && (
                <p className="scr-muted" style={{ marginTop: 12 }}>Chưa có ảnh nào. Thêm URL ảnh thực tế bên trên.</p>
              )}
              {refs.length > 0 && (
                <div className="ps-ref-grid">
                  {refs.map((r) => (
                    <div key={r.id} className="ps-ref-item" onClick={() => setLightbox(r)}>
                      <img src={r.imageUrl} alt={r.notes ?? 'Reference'} className="ps-ref-item-img" loading="lazy" />
                      {r.notes && <p className="ps-ref-item-notes">{r.notes}</p>}
                      <button
                        className="notes-img-del"
                        onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                        disabled={deleting === r.id}
                        aria-label="Xóa ảnh"
                      >
                        {deleting === r.id ? '…' : '✕'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Indicator info + reference dialog ────────────────────────────────────────

const INDICATOR_META: Record<'rsi' | 'sonic-r', { label: string; dbKey: string }> = {
  'rsi':     { label: 'RSI(14)', dbKey: 'rsi' },
  'sonic-r': { label: 'Sonic R — EMA 34/89/200', dbKey: 'sonic_r' },
};

const INDICATOR_RULES: Record<'rsi' | 'sonic-r', { intro: string; rules: string[] }> = {
  'rsi': {
    intro: 'RSI (Relative Strength Index) đo momentum của giá: so sánh mức tăng trung bình và mức giảm trung bình trong 14 nến gần nhất. Kết quả là một số từ 0–100.',
    rules: [
      'RSI > 70 → Overbought: coin tăng quá nhanh, xác suất pullback cao. Tránh long mới, chú ý tín hiệu đảo chiều giảm.',
      'RSI < 30 → Oversold: coin giảm quá mức, xác suất bounce cao. Chú ý tín hiệu đảo chiều tăng.',
      'RSI 30–70 → Neutral: vùng giao dịch bình thường, momentum không cực đoan.',
      'Bullish divergence: giá tạo đáy thấp hơn nhưng RSI tạo đáy cao hơn → cảnh báo đảo chiều tăng.',
      'Bearish divergence: giá tạo đỉnh cao hơn nhưng RSI tạo đỉnh thấp hơn → cảnh báo đảo chiều giảm.',
      'Trong uptrend mạnh, RSI có thể duy trì >60 trong nhiều tuần — không short chỉ vì RSI cao.',
      'Dùng RSI để xác nhận hoặc lọc setup từ mô hình giá, không phải lý do vào lệnh đơn lẻ.',
      'Kết hợp tốt nhất: RSI oversold (<30) + mô hình hai đáy hoặc vai đầu vai ngược → setup chất lượng cao.',
    ],
  },
  'sonic-r': {
    intro: 'Sonic R System dùng 3 đường EMA (34, 89, 200) để xác định xu hướng và vị thế của giá so với momentum ngắn/trung/dài hạn. Khi 3 đường xếp hàng theo thứ tự, xu hướng được coi là mạnh và rõ ràng.',
    rules: [
      'Stack Bullish (EMA34 > EMA89 > EMA200): xu hướng tăng mạnh. Ưu tiên tìm long setup, tránh bán khống.',
      'Stack Bearish (EMA34 < EMA89 < EMA200): xu hướng giảm mạnh. Ưu tiên short, tránh long.',
      'Mixed (3 đường chưa xếp hàng): thị trường đang chuyển xu hướng hoặc sideways — cẩn thận với false breakout.',
      'Giá > EMA34 > EMA89 > EMA200: vị thế lý tưởng để long (trend + momentum cùng chiều tăng).',
      'Giá < EMA34 < EMA89 < EMA200: vị thế lý tưởng để short.',
      'EMA34 là đường nhanh nhất, hoạt động như hỗ trợ động (uptrend) hoặc kháng cự động (downtrend).',
      'EMA200 là xu hướng dài hạn — giá trên EMA200 là bull territory, dưới là bear territory.',
      'Kết hợp tốt nhất: pattern breakout (hai đáy, vai đầu vai) cùng chiều với Sonic R Stack → xác suất thành công cao hơn nhiều.',
    ],
  },
};

function IndicatorRuleDialog({ indicator, onClose }: { indicator: 'rsi' | 'sonic-r'; onClose: () => void }) {
  const meta = INDICATOR_META[indicator];
  const rule = INDICATOR_RULES[indicator];
  const [tab, setTab] = useState<'rules' | 'refs'>('rules');
  const [refs, setRefs] = useState<PatternReferenceImage[]>([]);
  const [refsLoaded, setRefsLoaded] = useState(false);
  const [refsLoading, setRefsLoading] = useState(false);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [newNotes, setNewNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<PatternReferenceImage | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (lightbox) setLightbox(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, lightbox]);

  async function loadRefs() {
    if (refsLoaded || refsLoading) return;
    setRefsLoading(true);
    try {
      const data = await apiClient.fetchPatternReferences(meta.dbKey);
      setRefs(data);
      setRefsLoaded(true);
    } finally {
      setRefsLoading(false);
    }
  }

  function switchTab(t: 'rules' | 'refs') {
    setTab(t);
    if (t === 'refs') loadRefs();
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPickedFile(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!pickedFile) return;
    setAdding(true);
    try {
      const img = await apiClient.uploadPatternReference(meta.dbKey, pickedFile, newNotes.trim() || undefined);
      setRefs((prev) => [img, ...prev]);
      setPickedFile(null);
      if (preview) { URL.revokeObjectURL(preview); setPreview(null); }
      setNewNotes('');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await apiClient.removePatternReference(id);
      setRefs((prev) => prev.filter((r) => r.id !== id));
      if (lightbox?.id === id) setLightbox(null);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={lightbox ? () => setLightbox(null) : onClose}>
      {lightbox && (
        <div className="ps-ref-lightbox" onClick={(e) => e.stopPropagation()}>
          <button className="dialog-close ps-ref-lightbox-close" onClick={() => setLightbox(null)} aria-label="Đóng">✕</button>
          <img src={lightbox.imageUrl} alt={lightbox.notes ?? 'Reference'} className="ps-ref-lightbox-img" />
          {lightbox.notes && <p className="ps-ref-lightbox-notes">{lightbox.notes}</p>}
        </div>
      )}
      {!lightbox && (
        <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="dialog-header">
            <span className="dialog-title">{meta.label}</span>
            <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
          </div>
          <div className="ps-ref-tabs">
            <button className={`ps-ref-tab${tab === 'rules' ? ' ps-ref-tab--active' : ''}`} onClick={() => switchTab('rules')}>Hướng dẫn</button>
            <button className={`ps-ref-tab${tab === 'refs' ? ' ps-ref-tab--active' : ''}`} onClick={() => switchTab('refs')}>Ảnh thực tế</button>
          </div>
          {tab === 'rules' && (
            <div className="dialog-body">
              <p className="ps-rule-intro">{rule.intro}</p>
              <p className="notes-section-label">Cách đọc tín hiệu</p>
              <ul className="ps-rule-list">
                {rule.rules.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {tab === 'refs' && (
            <div className="dialog-body">
              <form className="ps-ref-add" onSubmit={handleAdd}>
                <label className="ps-ref-file-label">
                  <input type="file" accept="image/*" className="ps-ref-file-input" onChange={handleFilePick} disabled={adding} />
                  <span className="btn btn--secondary ps-ref-file-btn">
                    {pickedFile ? pickedFile.name : 'Chọn ảnh…'}
                  </span>
                </label>
                {preview && <img src={preview} alt="preview" className="ps-ref-preview" />}
                <textarea
                  className="setup-input ps-ref-notes-input"
                  placeholder="Notes (tuỳ chọn)"
                  rows={2}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  disabled={adding}
                />
                <button className="btn btn--primary" type="submit" disabled={adding || !pickedFile}>
                  {adding ? 'Đang upload…' : '+ Upload'}
                </button>
              </form>
              {refsLoading && <p className="scr-muted" style={{ marginTop: 12 }}>Đang tải…</p>}
              {refsLoaded && refs.length === 0 && (
                <p className="scr-muted" style={{ marginTop: 12 }}>Chưa có ảnh nào.</p>
              )}
              {refs.length > 0 && (
                <div className="ps-ref-grid">
                  {refs.map((r) => (
                    <div key={r.id} className="ps-ref-item" onClick={() => setLightbox(r)}>
                      <img src={r.imageUrl} alt={r.notes ?? 'Reference'} className="ps-ref-item-img" loading="lazy" />
                      {r.notes && <p className="ps-ref-item-notes">{r.notes}</p>}
                      <button
                        className="notes-img-del"
                        onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                        disabled={deleting === r.id}
                        aria-label="Xóa ảnh"
                      >
                        {deleting === r.id ? '…' : '✕'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Indicator rows ────────────────────────────────────────────────────────────

function rsiZone(rsi: number): 'ob' | 'os' | 'neutral' {
  if (rsi >= 70) return 'ob';
  if (rsi <= 30) return 'os';
  return 'neutral';
}

function emaAlignment(ind: CoinIndicators): 'bull' | 'bear' | 'mixed' {
  if (ind.ema34 > ind.ema89 && ind.ema89 > ind.ema200) return 'bull';
  if (ind.ema34 < ind.ema89 && ind.ema89 < ind.ema200) return 'bear';
  return 'mixed';
}

function IndicatorRows({ price, ind, show, onInfo }: {
  price: number;
  ind: CoinIndicators | undefined;
  show: Set<'rsi' | 'sonic-r'>;
  onInfo: (k: 'rsi' | 'sonic-r') => void;
}) {
  if (!ind || show.size === 0) return null;
  const zone  = rsiZone(ind.rsi);
  const align = emaAlignment(ind);
  const aboveEma34  = price > ind.ema34;
  const aboveEma89  = price > ind.ema89;
  const aboveEma200 = price > ind.ema200;

  return (
    <div className="ps-ind-rows">
      {show.has('rsi') && (
        <div className={`ps-ind-row ps-ind-row--${zone === 'ob' ? 'bearish' : zone === 'os' ? 'bullish' : 'neutral'}`}>
          <span className="ps-ind-row-name">RSI(14)</span>
          <button type="button" className="ps-info" onClick={() => onInfo('rsi')} title="Hướng dẫn RSI">i</button>
          <span className={`ps-badge ps-ind-badge--${zone}`}>
            {zone === 'ob' ? 'Overbought' : zone === 'os' ? 'Oversold' : 'Neutral'}
          </span>
          <span className="ps-ind-row-value">{ind.rsi.toFixed(1)}</span>
        </div>
      )}
      {show.has('sonic-r') && (
        <div className={`ps-ind-row ps-ind-row--${align === 'bull' ? 'bullish' : align === 'bear' ? 'bearish' : 'neutral'}`}>
          <span className="ps-ind-row-name">Sonic R</span>
          <button type="button" className="ps-info" onClick={() => onInfo('sonic-r')} title="Hướng dẫn Sonic R">i</button>
          <span className={`ps-badge ps-ind-badge--${align}`}>
            {align === 'bull' ? 'Bullish Stack' : align === 'bear' ? 'Bearish Stack' : 'Mixed'}
          </span>
          <span className="ps-ind-emas">
            {([34, 89, 200] as const).map((p, i) => {
              const above = [aboveEma34, aboveEma89, aboveEma200][i]!;
              return (
                <span
                  key={p}
                  className={`ps-ind-ema-chip ps-ind-ema-chip--${above ? 'above' : 'below'}`}
                  title={`EMA${p} = ${[ind.ema34, ind.ema89, ind.ema200][i]}`}
                >
                  {p}{above ? '↑' : '↓'}
                </span>
              );
            })}
          </span>
        </div>
      )}
    </div>
  );
}

type PatternSeries = { opens: number[]; highs: number[]; lows: number[]; closes: number[] };

function MatchRow({ m, series, onInfo }: { m: PatternMatch; series?: PatternSeries; onInfo: (p: PatternKind) => void }) {
  const meta = PATTERN_META[m.pattern];
  const [zoom, setZoom] = useState(false);
  const hasChart = !!series && series.closes.length >= 2 && m.pivots.length > 0;
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
      {hasChart && (
        <button
          type="button"
          className="ps-chart-btn"
          onClick={() => setZoom(true)}
          aria-label="Phóng to biểu đồ"
          title="Bấm để phóng to"
        >
          <PatternChart m={m} series={series} />
          <span className="ps-chart-zoom-hint" aria-hidden>⤢</span>
        </button>
      )}
      <div className="ps-levels">
        <span>Neckline <b>${fmtPrice(m.neckline)}</b></span>
        <span>Target <b>${fmtPrice(m.target)}</b></span>
        <span>Stop <b>${fmtPrice(m.stop)}</b></span>
      </div>
      {zoom && hasChart && (
        <ChartZoom m={m} series={series} onClose={() => setZoom(false)} />
      )}
    </div>
  );
}

/**
 * Full-screen lightbox showing the pattern chart large; closes on backdrop click or Esc.
 * Rendered through a portal to `document.body` so a card ancestor's `backdrop-filter`
 * can't trap the fixed overlay inside the content column — it truly covers the viewport.
 */
function ChartZoom({ m, series, onClose }: { m: PatternMatch; series: PatternSeries; onClose: () => void }) {
  const meta = PATTERN_META[m.pattern];
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="dialog-backdrop ps-chart-backdrop" onClick={onClose}>
      <div className="ps-chart-zoom" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="ps-chart-zoom-head">
          <span className="dialog-title">
            {meta.label}
            <span className={`ps-dir ps-dir--${meta.dir}`} style={{ marginLeft: 8 }}>
              {meta.dir === 'bullish' ? 'Tăng ↑' : 'Giảm ↓'}
            </span>
          </span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <PatternChart m={m} series={series} variant="full" />
      </div>
    </div>,
    document.body,
  );
}

const ROLE_SHORT: Record<string, string> = {
  'bottom-1': 'Đ1',
  'bottom-2': 'Đ2',
  'top-1': 'Đ1',
  'top-2': 'Đ2',
  'left-shoulder': 'VT',
  'head': 'Đầu',
  'right-shoulder': 'VP',
};

// App candlestick colours (match worker chart-renderer.ts).
const CANDLE_UP = '#26a69a';
const CANDLE_DOWN = '#ef5350';

/**
 * Inline SVG candlestick of the matched pattern: OHLC windowed around the pivots
 * (same green/red style as the Daily Plan chart), with the defining pivots marked
 * and the neckline / target / stop levels drawn as reference lines. Purely
 * client-side — no image request, no dependency. `variant="full"` renders larger.
 */
function PatternChart({ m, series, variant = 'inline' }: { m: PatternMatch; series?: PatternSeries; variant?: 'inline' | 'full' }) {
  if (!series || series.closes.length < 2 || m.pivots.length === 0) return null;
  const { opens, highs, lows, closes } = series;

  const full = variant === 'full';
  // Full-screen uses a wider landscape viewBox so it fills the viewport with minimal letterbox.
  const W = full ? 1280 : 560;
  const H = full ? 660 : 190;
  const padL = full ? 14 : 8;
  const padR = full ? 66 : 54; // room for level labels on the right
  const padT = full ? 20 : 14;
  const padB = full ? 22 : 16;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const lastIdx = closes.length - 1;
  const pivotIdxs = m.pivots.map((p) => p.idx);
  const minPivot = Math.min(...pivotIdxs);
  const startIdx = Math.max(0, minPivot - 6);
  const endIdx = lastIdx;
  if (endIdx - startIdx < 1) return null;

  const count = endIdx - startIdx + 1;
  const slotW = innerW / count;
  const barW = Math.max(1.5, slotW * 0.6);

  // Domain from visible highs/lows + neckline + stop (structural). Target left out
  // so a far measured-move doesn't squash the candles.
  const domainVals = [m.neckline, m.stop];
  for (let i = startIdx; i <= endIdx; i++) {
    const h = highs[i];
    const l = lows[i];
    if (h != null) domainVals.push(h);
    if (l != null) domainVals.push(l);
  }
  let lo = Math.min(...domainVals);
  let hi = Math.max(...domainVals);
  if (hi === lo) hi = lo + 1;
  const padY = (hi - lo) * 0.06;
  lo -= padY;
  hi += padY;

  const xc = (idx: number) => padL + (idx - startIdx + 0.5) * slotW;
  const yRaw = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * innerH;
  const y = (p: number) => Math.max(padT, Math.min(padT + innerH, yRaw(p)));

  const levels = [
    { key: 'nl', label: 'NL', value: m.neckline, color: '#64748b', dash: '4 3' },
    { key: 'tp', label: 'TP', value: m.target, color: '#16a34a', dash: '2 3' },
    { key: 'sl', label: 'SL', value: m.stop, color: '#ef4444', dash: '2 3' },
  ];

  const candles = [];
  for (let idx = startIdx; idx <= endIdx; idx++) {
    const o = opens[idx];
    const c = closes[idx];
    const h = highs[idx];
    const l = lows[idx];
    if (o == null || c == null || h == null || l == null) continue;
    const cx = xc(idx);
    const openY = yRaw(o);
    const closeY = yRaw(c);
    const color = c >= o ? CANDLE_UP : CANDLE_DOWN;
    const bodyTop = Math.min(openY, closeY);
    const bodyH = Math.max(1, Math.abs(closeY - openY));
    candles.push(
      <g key={idx}>
        <line x1={cx} x2={cx} y1={yRaw(h)} y2={yRaw(l)} stroke={color} strokeWidth={1} />
        <rect x={cx - barW / 2} y={bodyTop} width={barW} height={bodyH} fill={color} />
      </g>,
    );
  }

  const fs = full ? 16 : 9;
  const pr = full ? 5.5 : 3.5;

  // Place the NL/TP/SL labels: keep each line at its true y, but nudge the text apart
  // so close levels (e.g. neckline ≈ target) don't print on top of each other.
  const labelGap = fs + 3;
  const labelTop = padT + fs * 0.7;
  const labelBottom = padT + innerH;
  const levelRender = levels
    .map((lv) => ({ ...lv, lineY: y(lv.value), labelY: y(lv.value) }))
    .sort((a, b) => a.lineY - b.lineY);
  for (let i = 1; i < levelRender.length; i++) {
    levelRender[i]!.labelY = Math.max(levelRender[i]!.labelY, levelRender[i - 1]!.labelY + labelGap);
  }
  for (let i = levelRender.length - 1; i >= 0; i--) {
    const cap = i === levelRender.length - 1 ? labelBottom : levelRender[i + 1]!.labelY - labelGap;
    levelRender[i]!.labelY = Math.max(labelTop, Math.min(levelRender[i]!.labelY, cap));
  }

  return (
    <svg
      className={`ps-chart ps-chart--${variant}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio={full ? 'xMidYMid meet' : undefined}
      role="img"
      aria-label={`Biểu đồ ${PATTERN_META[m.pattern].label}`}
    >
      {/* level reference lines + right-edge labels (labels de-collided) */}
      {levelRender.map((lv) => (
        <g key={lv.key}>
          <line x1={padL} x2={padL + innerW} y1={lv.lineY} y2={lv.lineY} stroke={lv.color} strokeWidth={1} strokeDasharray={lv.dash} opacity={0.8} />
          <text x={padL + innerW + 4} y={lv.labelY + fs / 3} fontSize={fs} fill={lv.color} fontWeight={600}>{lv.label}</text>
        </g>
      ))}

      {/* candlesticks */}
      {candles}

      {/* pivots */}
      {m.pivots.map((p, i) => {
        const px = xc(p.idx);
        const py = yRaw(p.price);
        const below = m.direction === 'bullish';
        return (
          <g key={`piv-${i}`}>
            <circle cx={px} cy={py} r={pr} fill="#2563eb" stroke="#fff" strokeWidth={1.2} />
            <text
              x={px}
              y={below ? py + fs + 4 : py - fs / 2 - 3}
              fontSize={fs}
              fill="var(--text-muted, #64748b)"
              fontWeight={700}
              textAnchor="middle"
            >
              {ROLE_SHORT[p.role] ?? ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
