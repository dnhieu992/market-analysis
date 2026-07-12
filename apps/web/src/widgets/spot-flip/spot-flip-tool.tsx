'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type {
  SpotFlipAnalysis,
  SpotFlipHistoryEntry,
  SpotFlipDailyEntry,
  SpotFlipLogEntry,
} from '@web/shared/api/types';

// Lazy-load the shared TipTap editor so its bundle only loads when a logs
// dialog opens.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

/* ── constants ──────────────────────────────────────────────────
 * Fee is 0.05%/side = 0.10% round-trip (user's real Binance spot fee).
 * Default TP/SL are derived from ATR% so targets stay inside the coin's
 * usual daily range — the core "lướt spot" rule: don't aim past what the
 * coin normally moves in a session. */
const FEE_ROUND_TRIP = 0.1;
const TP_ATR_MULT = 0.8; // suggested take-profit = 0.8 × daily range
const SL_ATR_MULT = 0.6; // suggested stop-loss   = 0.6 × daily range

const apiClient = createApiClient();

/** Known quote assets, so we can peel the base off a full pair for display. */
const QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'BTC', 'ETH'];

/** Full names for the coins we commonly show; falls back to the pair. */
const COIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  BNB: 'BNB',
  XRP: 'XRP',
  ADA: 'Cardano',
  DOGE: 'Dogecoin',
  AVAX: 'Avalanche',
  LINK: 'Chainlink',
  MATIC: 'Polygon',
  DOT: 'Polkadot',
  PEPE: 'Pepe',
  SHIB: 'Shiba Inu',
  ARB: 'Arbitrum',
  OP: 'Optimism',
  SUI: 'Sui',
  VIRTUAL: 'Virtuals Protocol',
  WIF: 'dogwifhat',
  ORDI: 'ORDI',
  TIA: 'Celestia',
};

/** Deterministic avatar background so a coin always gets the same color. */
const AVATAR_COLORS = ['#00C896', '#F6465D', '#5B8DEF', '#F7931A', '#8B5CF6', '#EAB308', '#EC4899', '#14B8A6'];

/* ── helpers ────────────────────────────────────────────────── */

function baseAsset(symbol: string): string {
  const quote = QUOTE_ASSETS.find((q) => symbol.endsWith(q) && symbol.length > q.length);
  return quote ? symbol.slice(0, -quote.length) : symbol;
}

function quoteAsset(symbol: string): string {
  const quote = QUOTE_ASSETS.find((q) => symbol.endsWith(q) && symbol.length > q.length);
  return quote ?? 'USDT';
}

function coinFullName(symbol: string): string {
  const base = baseAsset(symbol);
  return COIN_NAMES[base] ?? `${base} / ${quoteAsset(symbol)}`;
}

function avatarColor(symbol: string): string {
  const base = baseAsset(symbol);
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

/* ── formatting ─────────────────────────────────────────────── */

function fmtPrice(price: number): string {
  if (!Number.isFinite(price)) return '—';
  if (price >= 100) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(8);
}

function fmtPct(value: number | null, withSign = true): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = withSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function pctClass(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'sf-neutral';
  if (value > 0) return 'sf-up';
  if (value < 0) return 'sf-down';
  return 'sf-neutral';
}

/** Short Vietnamese take on where the coin sits — the optional card summary. */
function cardSummary(d: SpotFlipAnalysis): string {
  const dipInAtr = d.atrPct > 0 ? d.pullbackPct / d.atrPct : null;
  const dipStr = dipInAtr != null ? ` (~${dipInAtr.toFixed(1)}× biên ngày)` : '';
  const stance =
    dipInAtr != null && dipInAtr >= 1
      ? 'Đã chỉnh sâu so với đỉnh — canh mua nhịp hồi, TP trong 1× biên ngày.'
      : 'Chưa chỉnh sâu — chờ giá về vùng chiết khấu trước khi vào.';
  return `Cách đỉnh 30N −${d.pullbackPct.toFixed(1)}%${dipStr}, biên ngày TB ${d.atrPct.toFixed(1)}%. ${stance}`;
}

/* ── dual up/down bar ───────────────────────────────────────── */

function DualBar({ data }: { data: SpotFlipAnalysis }) {
  // Remaining room in the 30-day range, not distance already travelled:
  // green "tăng giá" = headroom up to the high (pullbackPct), red "giảm giá"
  // = downside to the low (reboundPct). So the closer price sits to the high,
  // the smaller the green share — matching how a trader reads "dư địa tăng".
  const up = Math.max(0, data.pullbackPct);
  const down = Math.max(0, data.reboundPct);
  const total = up + down;
  const greenShare = total > 0 ? (up / total) * 100 : 50;
  const redShare = 100 - greenShare;

  return (
    <div className="sf-dual">
      <div className="sf-dual-labels">
        <span className="sf-dual-up">{Math.round(greenShare)}% tăng giá</span>
        <span className="sf-dual-down">{Math.round(redShare)}% giảm giá</span>
      </div>
      <div className="sf-dual-bar">
        <span className="sf-dual-seg-up" style={{ flexBasis: `${greenShare}%` }} />
        <span className="sf-dual-seg-down" style={{ flexBasis: `${redShare}%` }} />
      </div>
    </div>
  );
}

/* ── tab 1: general info (range / dip / atr) ────────────────── */

function GeneralInfo({ data }: { data: SpotFlipAnalysis }) {
  const dipInAtr = data.atrPct > 0 ? data.pullbackPct / data.atrPct : null;

  return (
    <div className="sf-detail">
      <div className="sf-metrics">
        <div className="sf-metric">
          <span className="sf-metric-label">Cách đỉnh (dip)</span>
          <span className="sf-metric-value sf-down">−{data.pullbackPct.toFixed(2)}%</span>
          <span className="sf-metric-sub">đỉnh ${fmtPrice(data.high30d)}</span>
        </div>
        <div className="sf-metric">
          <span className="sf-metric-label">Trên đáy</span>
          <span className="sf-metric-value sf-up">+{data.reboundPct.toFixed(2)}%</span>
          <span className="sf-metric-sub">đáy ${fmtPrice(data.low30d)}</span>
        </div>
        <div className="sf-metric">
          <span className="sf-metric-label">Biên ngày (ATR)</span>
          <span className="sf-metric-value sf-neutral">{data.atrPct.toFixed(2)}%</span>
          <span className="sf-metric-sub">TB 14 ngày</span>
        </div>
        <div className="sf-metric">
          <span className="sf-metric-label">Độ sâu nhịp chỉnh</span>
          <span className="sf-metric-value sf-neutral">{dipInAtr != null ? `${dipInAtr.toFixed(1)}×` : '—'}</span>
          <span className="sf-metric-sub">lần biên ngày</span>
        </div>
      </div>

      <DualBar data={data} />

      <div className="sf-changes">
        {(
          [
            ['1H', data.changes.h1],
            ['4H', data.changes.h4],
            ['24H', data.changes.h24],
            ['7N', data.changes.d7],
            ['30N', data.changes.d30],
          ] as const
        ).map(([label, value]) => (
          <div className="sf-change-cell" key={label}>
            <span className="sf-change-cell-label">{label}</span>
            <span className={`sf-change-cell-value ${pctClass(value)}`}>{fmtPct(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── tab 2: daily history (stored analysis + OHLC) ──────────── */

/** Stored daily analysis snapshots (up/down ratio + stance note), written by
 *  the worker cron at 00:15 UTC and fetched on demand when the tab opens. */
function AnalysisHistoryTable({ rows }: { rows: SpotFlipDailyEntry[] }) {
  return (
    <div className="sf-history-wrap">
      <table className="sf-history">
        <thead>
          <tr>
            <th>Ngày</th>
            <th className="sf-history-num">Giá</th>
            <th className="sf-history-num">Tăng / Giảm</th>
            <th>Nhận định</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date}>
              <td>{r.date}</td>
              <td className="sf-history-num">${fmtPrice(r.price)}</td>
              <td className="sf-history-num sf-share-cell">
                <span className="sf-up">{Math.round(r.upPct)}%</span>
                <span className="sf-share-sep">/</span>
                <span className="sf-down">{Math.round(r.downPct)}%</span>
              </td>
              <td className="sf-history-note">{r.notes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTab({ data }: { data: SpotFlipAnalysis }) {
  const [rows, setRows] = useState<SpotFlipDailyEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .fetchSpotFlipHistory(data.symbol)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [data.symbol]);

  return (
    <div className="sf-detail">
      <div>
        <h3 className="sf-card-title">Lịch sử phân tích (tỉ lệ tăng/giảm · nhận định)</h3>
        {rows == null ? (
          <p className="sf-hint">Đang tải…</p>
        ) : rows.length === 0 ? (
          <p className="sf-hint">Chưa có snapshot phân tích nào. Job tự chạy 00:15 UTC mỗi ngày.</p>
        ) : (
          <AnalysisHistoryTable rows={rows} />
        )}
      </div>
      <div>
        <h3 className="sf-card-title">Giá theo ngày (OHLC)</h3>
        <HistoryTable history={data.history} />
      </div>
    </div>
  );
}

function HistoryTable({ history }: { history: SpotFlipHistoryEntry[] }) {
  if (!history.length) return <p className="sf-hint">Chưa có dữ liệu lịch sử.</p>;
  return (
    <div className="sf-history-wrap">
      <table className="sf-history">
        <thead>
          <tr>
            <th>Ngày</th>
            <th className="sf-history-num">Mở cửa</th>
            <th className="sf-history-num">Đóng cửa</th>
            <th className="sf-history-num">Biến động</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.date}>
              <td>{h.date}</td>
              <td className="sf-history-num">${fmtPrice(h.open)}</td>
              <td className="sf-history-num">${fmtPrice(h.close)}</td>
              <td className="sf-history-num">
                <span className={`sf-change-badge ${pctClass(h.changePct)}`}>{fmtPct(h.changePct)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── tab 3: order signal (flip calculator) ──────────────────── */

type CalcInputs = { entry: string; tp: string; sl: string; capital: string };

function seedCalc(d: SpotFlipAnalysis): CalcInputs {
  const atr = d.atrPct / 100;
  return {
    entry: String(d.price),
    tp: String(d.price * (1 + TP_ATR_MULT * atr)),
    sl: String(d.price * (1 - SL_ATR_MULT * atr)),
    capital: '1000',
  };
}

function SignalTab({ data }: { data: SpotFlipAnalysis }) {
  const [inputs, setInputs] = useState<CalcInputs>(() => seedCalc(data));

  const calc = useMemo(() => {
    const e = parseFloat(inputs.entry);
    const t = parseFloat(inputs.tp);
    const s = parseFloat(inputs.sl);
    const cap = parseFloat(inputs.capital);
    if (!Number.isFinite(e) || e <= 0) return null;

    const breakeven = e * (1 + FEE_ROUND_TRIP / 100);
    const tpNetPct = Number.isFinite(t) ? ((t - e) / e) * 100 - FEE_ROUND_TRIP : null;
    const slNetPct = Number.isFinite(s) ? ((s - e) / e) * 100 - FEE_ROUND_TRIP : null;
    const rr = Number.isFinite(t) && Number.isFinite(s) && e > s ? (t - e) / (e - s) : null;
    const profit = tpNetPct != null && Number.isFinite(cap) ? (cap * tpNetPct) / 100 : null;
    const lossAmt = slNetPct != null && Number.isFinite(cap) ? (cap * slNetPct) / 100 : null;

    return { breakeven, tpNetPct, slNetPct, rr, profit, lossAmt };
  }, [inputs]);

  const set = (key: keyof CalcInputs) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInputs((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="sf-detail">
      {/* trading stance / signal */}
      <div className="sf-signal-banner">{cardSummary(data)}</div>

      <h3 className="sf-card-title">Máy tính chốt lời (net phí 0.10%)</h3>
      <div className="sf-calc-inputs">
        <label className="sf-field">
          <span>Giá vào</span>
          <input value={inputs.entry} onChange={set('entry')} inputMode="decimal" />
        </label>
        <label className="sf-field">
          <span>Chốt lời (TP)</span>
          <input value={inputs.tp} onChange={set('tp')} inputMode="decimal" />
        </label>
        <label className="sf-field">
          <span>Cắt lỗ (SL)</span>
          <input value={inputs.sl} onChange={set('sl')} inputMode="decimal" />
        </label>
        <label className="sf-field">
          <span>Vốn ($)</span>
          <input value={inputs.capital} onChange={set('capital')} inputMode="decimal" />
        </label>
      </div>

      {calc && (
        <div className="sf-calc-results">
          <div className="sf-result">
            <span className="sf-result-label">Lãi net @ TP</span>
            <span className={`sf-result-value ${pctClass(calc.tpNetPct)}`}>{fmtPct(calc.tpNetPct)}</span>
            {calc.profit != null && (
              <span className="sf-result-sub">{calc.profit >= 0 ? '+' : ''}${calc.profit.toFixed(2)}</span>
            )}
          </div>
          <div className="sf-result">
            <span className="sf-result-label">Lỗ net @ SL</span>
            <span className={`sf-result-value ${pctClass(calc.slNetPct)}`}>{fmtPct(calc.slNetPct)}</span>
            {calc.lossAmt != null && <span className="sf-result-sub">${calc.lossAmt.toFixed(2)}</span>}
          </div>
          <div className="sf-result">
            <span className="sf-result-label">R : R</span>
            <span className={`sf-result-value ${calc.rr != null && calc.rr >= 1.5 ? 'sf-up' : 'sf-neutral'}`}>
              {calc.rr != null ? `${calc.rr.toFixed(2)} : 1` : '—'}
            </span>
            <span className="sf-result-sub">nên ≥ 1.5</span>
          </div>
          <div className="sf-result">
            <span className="sf-result-label">Giá hoà vốn</span>
            <span className="sf-result-value sf-neutral">${fmtPrice(calc.breakeven)}</span>
            <span className="sf-result-sub">đã trừ phí</span>
          </div>
        </div>
      )}
      <p className="sf-hint">
        TP/SL mặc định = {TP_ATR_MULT}× / {SL_ATR_MULT}× biên ngày (ATR) tính từ giá vào — chỉnh tay thoải mái.
      </p>
    </div>
  );
}

/* ── coin card ──────────────────────────────────────────────── */

function CoinCard({
  data,
  onOpen,
  onRemove,
  onLogs,
}: {
  data: SpotFlipAnalysis;
  onOpen: () => void;
  onRemove: () => void;
  onLogs: () => void;
}) {
  const base = baseAsset(data.symbol);
  const change = data.changes.h24;

  return (
    <article className="sf-coin-card sf-coin-card--clickable">
      <button
        type="button"
        className="sf-remove"
        onClick={onRemove}
        aria-label={`Bỏ theo dõi ${base}`}
        title="Bỏ theo dõi"
      >
        ✕
      </button>
      <button type="button" className="sf-coin-head" onClick={onOpen}>
        <div className="sf-coin-id">
          <span className="sf-avatar" style={{ background: avatarColor(data.symbol) }}>
            {base.slice(0, 2)}
          </span>
          <span className="sf-coin-names">
            <span className="sf-coin-symbol">{base}</span>
            <span className="sf-coin-full">{coinFullName(data.symbol)}</span>
          </span>
        </div>
        <div className="sf-coin-price">
          <span className="sf-coin-price-value">${fmtPrice(data.price)}</span>
          <span className={`sf-coin-change ${pctClass(change)}`}>
            {change != null && Number.isFinite(change) ? (change >= 0 ? '▲' : '▼') : ''} {fmtPct(change, false)}
          </span>
        </div>
      </button>

      <DualBar data={data} />

      <p className="sf-coin-summary">{cardSummary(data)}</p>

      <div className="sf-coin-actions">
        <button
          type="button"
          className="sf-logs-btn"
          onClick={onLogs}
          aria-label={`Nhật ký ${base}`}
          title="Thêm / xem logs"
        >
          📝 Logs
        </button>
      </div>
    </article>
  );
}

/* ── coin dialog (3 tabs) ───────────────────────────────────── */

type DialogTab = 'general' | 'history' | 'signal';

const DIALOG_TABS: { id: DialogTab; label: string }[] = [
  { id: 'general', label: 'Thông tin chung' },
  { id: 'history', label: 'Lịch sử' },
  { id: 'signal', label: 'Tín hiệu lệnh' },
];

function CoinDialog({ data, onClose }: { data: SpotFlipAnalysis; onClose: () => void }) {
  const base = baseAsset(data.symbol);
  const [tab, setTab] = useState<DialogTab>('general');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Chi tiết ${base}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <span className="dialog-title">
            {base} · ${fmtPrice(data.price)}
          </span>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="sf-tabs" role="tablist">
          {DIALOG_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`sf-tab ${tab === t.id ? 'sf-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="dialog-body">
          {tab === 'general' && <GeneralInfo data={data} />}
          {tab === 'history' && <HistoryTab data={data} />}
          {tab === 'signal' && <SignalTab data={data} />}
        </div>
      </div>
    </div>
  );
}

/* ── logs dialog (per coin) ─────────────────────────────────── */

function fmtLogTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function LogsDialog({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const base = baseAsset(symbol);
  const [logs, setLogs] = useState<SpotFlipLogEntry[] | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .fetchSpotFlipLogs(symbol)
      .then((r) => {
        if (!cancelled) setLogs(r);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  async function addLog() {
    const content = draft.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      const entry = await apiClient.addSpotFlipLog(symbol, content);
      setLogs((prev) => [entry, ...(prev ?? [])]);
      setDraft('');
    } catch {
      // keep the draft so the user can retry
    } finally {
      setSaving(false);
    }
  }

  async function deleteLog(id: string) {
    setLogs((prev) => (prev ?? []).filter((l) => l.id !== id));
    try {
      await apiClient.deleteSpotFlipLog(id);
    } catch {
      // already removed from the view
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Logs ${base}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <span className="dialog-title">{base} · Nhật ký / Logs</span>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="dialog-body">
          <div className="sf-log-compose">
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              minHeight={160}
              placeholder="Ghi log cho coin này… (hỗ trợ định dạng markdown)"
            />
            <div className="sf-log-compose-actions">
              <button
                type="button"
                className="sf-search-btn"
                onClick={() => void addLog()}
                disabled={saving || !draft.trim()}
              >
                {saving ? 'Đang lưu…' : 'Thêm log'}
              </button>
            </div>
          </div>

          <div className="sf-log-list">
            {logs == null ? (
              <p className="sf-hint">Đang tải…</p>
            ) : logs.length === 0 ? (
              <p className="sf-hint">Chưa có log nào. Viết ghi chú ở trên và bấm “Thêm log”.</p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="sf-log-entry">
                  <div className="sf-log-entry-head">
                    <span className="sf-log-entry-time">{fmtLogTime(log.createdAt)}</span>
                    <button
                      type="button"
                      className="sf-log-entry-del"
                      onClick={() => void deleteLog(log.id)}
                      aria-label="Xoá log"
                      title="Xoá log"
                    >
                      ✕
                    </button>
                  </div>
                  <MarkdownEditor value={log.content} onChange={() => {}} editable={false} hideToolbar minHeight={0} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── remove confirm dialog ──────────────────────────────────── */

function RemoveConfirm({
  base,
  onCancel,
  onConfirm,
}: {
  base: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Bỏ theo dõi {base}?</span>
          <button type="button" className="dialog-close" onClick={onCancel} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="dialog-body">
          <p className="dialog-confirm-text">
            Coin sẽ được ẩn khỏi danh sách theo dõi. Dữ liệu không bị xoá — thêm lại mã này bất cứ lúc nào để hiện lại.
          </p>
          <div className="dialog-confirm-actions">
            <button type="button" className="btn btn--secondary" onClick={onCancel}>
              Huỷ
            </button>
            <button type="button" className="btn btn--danger" onClick={onConfirm}>
              Bỏ theo dõi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── component ──────────────────────────────────────────────── */

export function SpotFlipTool() {
  const [symbolInput, setSymbolInput] = useState('');
  const [filterText, setFilterText] = useState('');
  const [cards, setCards] = useState<SpotFlipAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [logsSymbol, setLogsSymbol] = useState<string | null>(null);

  const activeCard = activeSymbol ? cards.find((c) => c.symbol === activeSymbol) ?? null : null;

  // Filter the visible cards by base symbol or full name (case-insensitive).
  const filteredCards = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => {
      const base = baseAsset(c.symbol).toLowerCase();
      return base.includes(q) || c.symbol.toLowerCase().includes(q) || coinFullName(c.symbol).toLowerCase().includes(q);
    });
  }, [cards, filterText]);

  // Mirror `cards` into a ref so the daily 00:08 UTC timer (registered once)
  // can read the current symbol list without re-scheduling on every change.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  async function analyze(sym: string) {
    const symbol = sym.trim();
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      // Validate + fetch metrics first, then persist to the watchlist so we
      // never save a junk symbol. `result.symbol` is the normalized pair.
      const result = await apiClient.analyzeSpotFlip(symbol);
      await apiClient.addSpotFlipWatch(result.symbol);
      setCards((prev) => [result, ...prev.filter((c) => c.symbol !== result.symbol)]);
      setSymbolInput('');
    } catch {
      setError('Không tải được dữ liệu. Kiểm tra lại mã coin (VD: BTC, SOL, PEPE).');
    } finally {
      setLoading(false);
    }
  }

  // Optimistically hide the card, then soft-delete it on the watchlist
  // (backend keeps the row, just marks it disabled).
  async function removeCoin(symbol: string) {
    setCards((prev) => prev.filter((c) => c.symbol !== symbol));
    setActiveSymbol((prev) => (prev === symbol ? null : prev));
    try {
      await apiClient.removeSpotFlipWatch(symbol);
    } catch {
      // ignore — the card is already gone from the view
    }
  }

  // Load the persisted watchlist, then analyze each coin (keeping the saved
  // order). The list is empty only if the user has removed every coin.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const watch = await apiClient.fetchSpotFlipWatchlist();
        if (cancelled) return;
        const results = await Promise.allSettled(watch.map((w) => apiClient.analyzeSpotFlip(w.symbol)));
        if (cancelled) return;
        const ok = results
          .filter((r): r is PromiseFulfilledResult<SpotFlipAnalysis> => r.status === 'fulfilled')
          .map((r) => r.value);
        setCards(ok);
      } catch {
        if (!cancelled) setError('Không tải được danh sách theo dõi.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-refresh every day at 00:08 UTC — a few minutes after the daily candle
  // closes at 00:00 UTC, so the freshly completed day shows up in each card's
  // history and metrics. Re-analyzes whatever symbols are currently shown.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const refreshAll = async () => {
      const symbols = cardsRef.current.map((c) => c.symbol);
      if (!symbols.length) return;
      const results = await Promise.allSettled(symbols.map((s) => apiClient.analyzeSpotFlip(s)));
      const fresh = results
        .filter((r): r is PromiseFulfilledResult<SpotFlipAnalysis> => r.status === 'fulfilled')
        .map((r) => r.value);
      if (fresh.length) {
        setCards((prev) => prev.map((c) => fresh.find((f) => f.symbol === c.symbol) ?? c));
      }
    };

    const scheduleNext = () => {
      const now = new Date();
      const next = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 8, 0, 0),
      );
      if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
      timer = setTimeout(async () => {
        await refreshAll();
        scheduleNext();
      }, next.getTime() - now.getTime());
    };

    scheduleNext();
    return () => clearTimeout(timer);
  }, []);

  const pendingBase = pendingRemove ? baseAsset(pendingRemove) : '';

  return (
    <div className="sf-page">
      <header className="sf-header">
        <h1 className="sf-title">Spot Flip</h1>
        <p className="sf-subtitle">
          Biến động &amp; vị trí trong biên 30 ngày cho lướt spot. Chạm vào coin để xem chi tiết nhịp chỉnh, biên
          ngày (ATR) &amp; máy tính TP/SL net phí (0.05%/chiều).
        </p>
      </header>

      {/* ── add coin ── */}
      <div className="sf-search">
        <input
          className="sf-search-input"
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') analyze(symbolInput);
          }}
          placeholder="Thêm coin, VD: BTC, SOL, PEPE…"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="sf-search-btn" onClick={() => analyze(symbolInput)} disabled={loading}>
          {loading ? 'Đang tải…' : 'Thêm'}
        </button>
      </div>

      {/* ── filter shown coins ── */}
      <input
        className="sf-filter-input"
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
        placeholder="Lọc coin đang theo dõi theo tên…"
        autoComplete="off"
        spellCheck={false}
      />

      {error && <p className="sf-error">{error}</p>}

      {/* ── card list ── */}
      <div className="sf-list">
        {filteredCards.map((c) => (
          <CoinCard
            key={c.symbol}
            data={c}
            onOpen={() => setActiveSymbol(c.symbol)}
            onRemove={() => setPendingRemove(c.symbol)}
            onLogs={() => setLogsSymbol(c.symbol)}
          />
        ))}
      </div>

      {cards.length === 0 && !loading && (
        <p className="sf-empty">Chưa theo dõi coin nào. Thêm một mã ở trên để bắt đầu.</p>
      )}
      {cards.length > 0 && filteredCards.length === 0 && (
        <p className="sf-empty">Không có coin nào khớp “{filterText}”.</p>
      )}

      {activeCard && <CoinDialog data={activeCard} onClose={() => setActiveSymbol(null)} />}

      {logsSymbol && <LogsDialog symbol={logsSymbol} onClose={() => setLogsSymbol(null)} />}

      {pendingRemove && (
        <RemoveConfirm
          base={pendingBase}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            removeCoin(pendingRemove);
            setPendingRemove(null);
          }}
        />
      )}
    </div>
  );
}
