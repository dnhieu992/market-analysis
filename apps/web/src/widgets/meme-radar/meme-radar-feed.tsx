'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { resolveApiBaseUrl, createApiClient } from '@web/shared/api/client';
import type { MemeCoinRow, MemeStage, MemeHistoryRow, MemeRescanStatus, PaTrend } from '@web/shared/api/types';

/* ── types ──────────────────────────────────────────────────── */

type Props = { initialCoins: MemeCoinRow[] };

type SortKey = 'signal' | 'rsi' | 'vol' | 'ext' | 'coin';

const ALL_STAGES: MemeStage[] = ['Breakout', 'Trending', 'Accumulating', 'Waking', 'Extended', 'Oversold', 'Quiet'];
const PAGE_SIZE = 50;

/* ── Lottery (xổ số) strategy params ──────────────────────────────
 * Backtested on ATM/PIVX/ORDI + 30 small-caps, D1 ~2.7y
 * (scripts/run-smallcap-lottery-strategy-backtest.ts, cfg C).
 * Entry trigger = the `Oversold` stage (deep capitulation: RSI<30,
 * below EMA200, ≥25% drop/10d). Flat small size per ticket, no
 * compounding; the TP ladder ≈ 3× vs buy&hold and the −40% stop caps
 * the rare coin that keeps bleeding to zero. Memes are the archetypal
 * lottery-ticket sleeve, so the same overlay applies. */
const LOTTERY_TP1 = 0.18; // sell ½ here (+15–20% band)
const LOTTERY_TP2 = 0.35; // sell the rest here (+30–40% band)
const LOTTERY_STOP = 0.40; // disaster stop, caps the near-zeros
const LOTTERY_TIME_STOP_DAYS = 21; // exit at close if neither TP nor stop hits

type LotteryPlan = { entry: number; tp1: number; tp2: number; stop: number };

/** The lottery entry trigger is exactly the deep-oversold capitulation stage. */
function isLotteryEntry(stage: MemeStage): boolean {
  return stage === 'Oversold';
}

/** Derive concrete price levels from the current close (last sparkline point). */
function computeLotteryPlan(close: number): LotteryPlan {
  return {
    entry: close,
    tp1: close * (1 + LOTTERY_TP1),
    tp2: close * (1 + LOTTERY_TP2),
    stop: close * (1 - LOTTERY_STOP),
  };
}

/* ── stage badge ─────────────────────────────────────────────── */

function StageBadge({ stage }: { stage: MemeStage }) {
  const cls: Record<MemeStage, string> = {
    Breakout: 'scr-stage scr-stage--breakout',
    Trending: 'scr-stage scr-stage--trending',
    Accumulating: 'scr-stage scr-stage--accumulating',
    Waking: 'scr-stage scr-stage--waking',
    Extended: 'scr-stage scr-stage--extended',
    Oversold: 'scr-stage scr-stage--oversold',
    Quiet: 'scr-stage scr-stage--quiet',
  };
  return <span className={cls[stage]}>{stage}</span>;
}

/* ── trend label ─────────────────────────────────────────────── */

const TREND_LABEL: Record<PaTrend, string> = {
  StrongUp: '↑↑', Up: '↑', Neutral: '→', Down: '↓', StrongDown: '↓↓',
};

function fmtSmallPrice(price: number): string {
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(8);
}

/* ── history modal (radar stage change-log) ──────────────────── */

function HistoryModal({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [rows, setRows] = useState<MemeHistoryRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null); setError(false);
    createApiClient().fetchMemeSignalHistory(symbol, 100)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [symbol]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog setup-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="dialog-header">
          <span className="dialog-title">Lịch sử radar — {symbol}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="dialog-body setup-body">
          {error ? (
            <p className="scr-muted">Không tải được lịch sử.</p>
          ) : rows === null ? (
            <div className="ord-loading"><span className="ord-loading__spinner" /><span>Đang tải…</span></div>
          ) : rows.length === 0 ? (
            <p className="scr-muted">Chưa có thay đổi nào. Lịch sử chỉ lưu khi stage đổi.</p>
          ) : (
            <>
              <p className="scr-muted" style={{ margin: 0, fontSize: '0.78rem', lineHeight: 1.5 }}>
                Mỗi dòng là một lần stage radar đổi trạng thái. Mới nhất ở trên.
              </p>
              <table className="dcapos-table sc-history-table">
                <thead>
                  <tr><th>Thời điểm</th><th>Stage</th><th>Signal</th><th>Trend</th><th>RSI</th><th>Vol×</th><th>Ext%</th><th>Giá</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.scannedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td><StageBadge stage={r.stage} /></td>
                      <td>{r.signalScore}</td>
                      <td title={r.trend}>{TREND_LABEL[r.trend]}</td>
                      <td>{r.rsi == null ? '—' : Math.round(r.rsi)}</td>
                      <td>{r.volMultiplier == null ? '—' : `${r.volMultiplier.toFixed(1)}×`}</td>
                      <td>{r.extPct == null ? '—' : `${r.extPct > 0 ? '+' : ''}${r.extPct.toFixed(1)}%`}</td>
                      <td>{r.price == null ? '—' : `$${fmtSmallPrice(r.price)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── signal bar ──────────────────────────────────────────────── */

function SignalBar({ score, stage }: { score: number; stage: MemeStage }) {
  const width = `${score}%`;
  const barCls =
    stage === 'Extended' ? 'scr-bar scr-bar--extended' :
    stage === 'Oversold' ? 'scr-bar scr-bar--oversold' :
    stage === 'Quiet'    ? 'scr-bar scr-bar--quiet' :
    stage === 'Trending' ? 'scr-bar scr-bar--trending' :
    'scr-bar scr-bar--active';
  return (
    <div className="scr-bar-wrap">
      <div className={barCls} style={{ width }} />
    </div>
  );
}

/* ── rsi cell ────────────────────────────────────────────────── */

function RsiCell({ rsi }: { rsi: number | null }) {
  if (rsi == null) return <span className="scr-muted">—</span>;
  const cls =
    rsi > 70 ? 'scr-rsi scr-rsi--hot' :
    rsi < 35 ? 'scr-rsi scr-rsi--cold' :
    rsi >= 35 && rsi <= 60 ? 'scr-rsi scr-rsi--good' :
    'scr-rsi';
  return <span className={cls}>{Math.round(rsi)}</span>;
}

/* ── vol× cell ───────────────────────────────────────────────── */

function VolCell({ vol }: { vol: number | null }) {
  if (vol == null) return <span className="scr-muted">—</span>;
  const cls = vol >= 1.5 ? 'scr-vol scr-vol--high' : vol >= 1.0 ? 'scr-vol' : 'scr-vol scr-vol--low';
  return <span className={cls}>{vol.toFixed(1)}×</span>;
}

/* ── extension % cell (distance above EMA34 — exit-timing gauge) ── */

function ExtCell({ ext }: { ext: number | null }) {
  if (ext == null) return <span className="scr-muted">—</span>;
  // >= +20% above EMA34 = overheated → trail / take profit, don't chase.
  const cls =
    ext >= 20 ? 'scr-ext scr-ext--hot' :
    ext >= 0  ? 'scr-ext scr-ext--up' :
    'scr-ext scr-ext--down';
  const sign = ext > 0 ? '+' : '';
  return <span className={cls}>{`${sign}${ext.toFixed(1)}%`}</span>;
}

/* ── market cap cell ─────────────────────────────────────────── */

function MarketCapCell({ cap }: { cap: number | null }) {
  if (cap == null) return <span className="scr-muted">—</span>;
  const fmt =
    cap >= 1_000_000_000 ? `$${(cap / 1_000_000_000).toFixed(1)}B` :
    cap >= 1_000_000     ? `$${(cap / 1_000_000).toFixed(1)}M` :
    `$${cap.toLocaleString()}`;
  return <span className="scr-muted">{fmt}</span>;
}

/* ── lottery (xổ số) plan cell ───────────────────────────────── */

function LotteryCell({ stage, sparkline }: { stage: MemeStage; sparkline: number[] }) {
  if (!isLotteryEntry(stage)) return <span className="scr-muted">—</span>;
  const close = sparkline[sparkline.length - 1];
  if (close == null || close <= 0) return <span className="scr-muted">—</span>;
  const plan = computeLotteryPlan(close);
  const title =
    `Kế hoạch xổ số (đã backtest):\n` +
    `Vào: $${fmtSmallPrice(plan.entry)}\n` +
    `TP1 (+${(LOTTERY_TP1 * 100).toFixed(0)}%, bán ½): $${fmtSmallPrice(plan.tp1)}\n` +
    `TP2 (+${(LOTTERY_TP2 * 100).toFixed(0)}%, bán phần còn lại): $${fmtSmallPrice(plan.tp2)}\n` +
    `SL (−${(LOTTERY_STOP * 100).toFixed(0)}%): $${fmtSmallPrice(plan.stop)}\n` +
    `Time-stop: ${LOTTERY_TIME_STOP_DAYS} ngày — không chạm TP/SL thì thoát, quay vòng vốn.\n` +
    `Size nhỏ cố định, chia đều rổ. Không nhồi lệnh.`;
  return (
    <div className="scr-lotto" title={title}>
      <span className="scr-lotto-badge">🎟 MUA</span>
      <span className="scr-lotto-levels">
        TP +{(LOTTERY_TP1 * 100).toFixed(0)}/+{(LOTTERY_TP2 * 100).toFixed(0)}% · SL −{(LOTTERY_STOP * 100).toFixed(0)}%
      </span>
    </div>
  );
}

/* ── listing date cell ───────────────────────────────────────── */

function ListingDateCell({ date }: { date: string | null }) {
  if (!date) return <span className="scr-muted">—</span>;
  const d = new Date(date);
  const label = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' });
  return <span className="scr-muted">{label}</span>;
}

/* ── EMA pips ────────────────────────────────────────────────── */

function EmaPips({
  ema34Above, ema89Above, ema200Above,
}: { ema34Above: boolean; ema89Above: boolean; ema200Above: boolean }) {
  return (
    <div className="scr-ema-pips">
      <span className={`scr-pip${ema34Above ? ' scr-pip--on' : ''}`}>34</span>
      <span className={`scr-pip${ema89Above ? ' scr-pip--on' : ''}`}>89</span>
      <span className={`scr-pip${ema200Above ? ' scr-pip--on' : ''}`}>200</span>
    </div>
  );
}

/* ── 30-day sparkline ────────────────────────────────────────── */

function Sparkline({ prices }: { prices: number[] }) {
  if (prices.length < 2) return <span className="scr-muted">—</span>;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const W = 80;
  const H = 28;
  const step = W / (prices.length - 1);

  const points = prices
    .map((p, i) => `${i * step},${H - ((p - min) / range) * H}`)
    .join(' ');

  const last = prices[prices.length - 1]!;
  const first = prices[0]!;
  const isUp = last >= first;

  return (
    <svg width={W} height={H} className="scr-sparkline" viewBox={`0 0 ${W} ${H}`}>
      <polyline
        points={points}
        fill="none"
        stroke={isUp ? '#22c55e' : '#ef4444'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── add coin form ───────────────────────────────────────────── */

function AddCoinForm({ onAdded }: { onAdded: (coin: MemeCoinRow) => void }) {
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/meme-radar/coins`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, name: name.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { id: string; symbol: string; name: string };
      onAdded({ ...data, marketCap: null, listingDate: null, addedAt: new Date().toISOString(), signal: null });
      setSymbol('');
      setName('');
    } catch {
      // silently ignore — in production add error state
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="scr-add-form" onSubmit={handleSubmit}>
      <input
        className="scr-add-input"
        placeholder="Symbol (e.g. DOGE)"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        required
      />
      <input
        className="scr-add-input scr-add-input--name"
        placeholder="Name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button className="scr-add-btn" type="submit" disabled={loading}>
        {loading ? '...' : '+ Add'}
      </button>
    </form>
  );
}

/* ── main feed ───────────────────────────────────────────────── */

export function MemeRadarFeed({ initialCoins }: Props) {
  const [coins, setCoins] = useState<MemeCoinRow[]>(initialCoins);
  const [syncing, setSyncing] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('signal');
  const [hiddenStages, setHiddenStages] = useState<Set<MemeStage>>(new Set<MemeStage>());
  const [showAddForm, setShowAddForm] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [onlyLottery, setOnlyLottery] = useState(false);
  const [page, setPage] = useState(1);
  const [historyCoin, setHistoryCoin] = useState<string | null>(null);
  const pollingRef = useRef(false);

  function toggleStage(stage: MemeStage) {
    setHiddenStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }

  // Reset to page 1 whenever filters or sort change
  useEffect(() => { setPage(1); }, [nameFilter, hiddenStages, sortKey, onlyLottery]);

  // Poll the background sync until it finishes, then show a real result + reload.
  async function pollRescanStatus() {
    if (pollingRef.current) return;
    pollingRef.current = true;
    setSyncing(true);
    try {
      for (let i = 0; i < 160; i++) { // ~13 min max at 5s/tick
        await new Promise((r) => setTimeout(r, 5000));
        let st: MemeRescanStatus;
        try {
          const res = await fetch(`${resolveApiBaseUrl()}/meme-radar/rescan-status`, { credentials: 'include' });
          if (!res.ok) continue;
          st = await res.json() as MemeRescanStatus;
        } catch {
          continue;
        }
        if (st.running) {
          const secs = st.startedAt ? Math.round((Date.now() - new Date(st.startedAt).getTime()) / 1000) : 0;
          setSyncMsg(`Đang sync danh sách meme coin từ CoinGecko/Binance… (${secs}s)`);
          continue;
        }
        // finished
        if (st.error) {
          setSyncMsg(`⚠️ Sync chưa xong: ${st.error}`);
        } else {
          setSyncMsg(`✅ Đã sync xong: ${st.found ?? 0} coin (thêm/cập nhật ${st.upserted ?? 0}, gỡ ${st.removed ?? 0}).`);
          await reloadCoins();
        }
        return;
      }
      setSyncMsg('Sync vẫn đang chạy nền — bấm Refresh sau vài phút để xem kết quả.');
    } finally {
      pollingRef.current = false;
      setSyncing(false);
    }
  }

  // If a sync is already running (e.g. started before this page load), resume polling.
  useEffect(() => {
    let cancelled = false;
    fetch(`${resolveApiBaseUrl()}/meme-radar/rescan-status`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((st: MemeRescanStatus | null) => {
        if (!cancelled && st?.running) void pollRescanStatus();
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSyncCoins() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/meme-radar/rescan-coins`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 401) {
        setSyncMsg('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.');
        setSyncing(false);
        return;
      }
      if (!res.ok) {
        setSyncMsg(`Sync thất bại (HTTP ${res.status}), thử lại sau.`);
        setSyncing(false);
        return;
      }
      setSyncMsg('Đang sync danh sách meme coin từ CoinGecko/Binance…');
      void pollRescanStatus(); // keeps `syncing` true until it resolves
    } catch {
      setSyncMsg('Không thể kết nối tới server, kiểm tra lại mạng và thử lại.');
      setSyncing(false);
    }
  }

  async function reloadCoins() {
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/meme-radar`, { credentials: 'include' });
      if (!res.ok) return;
      const updated = await res.json() as MemeCoinRow[];
      setCoins(updated);
    } catch {
      // ignore
    }
  }

  async function handleReanalyze() {
    setReanalyzing(true);
    setSyncMsg(null);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/meme-radar/scan`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json() as { scanned: number; failed: number };
        setSyncMsg(`Re-analyze xong: ${data.scanned} coins scanned, ${data.failed} failed.`);
        await reloadCoins();
      }
    } catch {
      setSyncMsg('Re-analyze thất bại, thử lại sau.');
    } finally {
      setReanalyzing(false);
    }
  }

  const sorted = useMemo(() => {
    const q = nameFilter.trim().toUpperCase();
    const filtered = coins.filter((c) => {
      if (q && !c.symbol.includes(q) && !c.name.toUpperCase().includes(q)) return false;
      if (onlyLottery) return c.signal !== null && isLotteryEntry(c.signal.stage as MemeStage);
      if (c.signal === null) return true;
      const stage = c.signal.stage as MemeStage;
      return !hiddenStages.has(stage);
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === 'signal') return (b.signal?.signalScore ?? 0) - (a.signal?.signalScore ?? 0);
      if (sortKey === 'rsi') return (b.signal?.rsi ?? 0) - (a.signal?.rsi ?? 0);
      if (sortKey === 'vol') return (b.signal?.volMultiplier ?? 0) - (a.signal?.volMultiplier ?? 0);
      if (sortKey === 'ext') return (b.signal?.extPct ?? -Infinity) - (a.signal?.extPct ?? -Infinity);
      return a.symbol.localeCompare(b.symbol);
    });
  }, [coins, sortKey, hiddenStages, nameFilter, onlyLottery]);

  const lotteryCount = useMemo(
    () => coins.filter((c) => c.signal !== null && isLotteryEntry(c.signal.stage as MemeStage)).length,
    [coins],
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <main className="dashboard-shell scr-shell">
      {historyCoin && <HistoryModal symbol={historyCoin} onClose={() => setHistoryCoin(null)} />}
      {/* ── toolbar ── */}
      <div className="scr-toolbar">
        <div className="scr-toolbar-left">
          <h1 className="scr-title">Meme Radar</h1>
          <span className="scr-count">
            {sorted.length < coins.length
              ? `${sorted.length} / ${coins.length} coins`
              : `${coins.length} coins`}
          </span>
        </div>
        <div className="scr-toolbar-right">
          <button className="scr-scan-btn" onClick={reloadCoins}>
            ↻ Refresh
          </button>
          <button
            className="scr-scan-btn"
            onClick={handleReanalyze}
            disabled={reanalyzing}
          >
            {reanalyzing ? 'Đang scan…' : '⚡ Re-analyze'}
          </button>
          <button
            className="scr-scan-btn"
            onClick={handleSyncCoins}
            disabled={syncing}
          >
            {syncing ? 'Đang sync…' : '⟳ Sync Coins'}
          </button>
          <button
            className="scr-add-toggle"
            onClick={() => setShowAddForm((v) => !v)}
          >
            {showAddForm ? '✕' : '+ Coin'}
          </button>
        </div>
      </div>

      {syncMsg && (
        <p className="scr-scan-result">{syncMsg}</p>
      )}

      {showAddForm && (
        <AddCoinForm
          onAdded={(coin) => {
            setCoins((prev) => {
              const exists = prev.some((c) => c.symbol === coin.symbol);
              return exists ? prev : [...prev, coin];
            });
            setShowAddForm(false);
          }}
        />
      )}

      {/* ── filters row: stage chips + search ── */}
      <div className="scr-filters">
        <button
          className={`scr-filter-chip scr-filter-chip--lottery${onlyLottery ? '' : ' scr-filter-chip--off'}`}
          onClick={() => setOnlyLottery((v) => !v)}
          title="Chỉ hiện các coin đang ở điểm vào lệnh xổ số (stage Oversold)"
        >
          🎟 Xổ số {lotteryCount > 0 ? `(${lotteryCount})` : ''}
        </button>
        {ALL_STAGES.map((stage) => (
          <button
            key={stage}
            className={`scr-filter-chip scr-filter-chip--${stage.toLowerCase()}${hiddenStages.has(stage) ? ' scr-filter-chip--off' : ''}`}
            onClick={() => toggleStage(stage)}
          >
            {stage}
          </button>
        ))}
        <input
          className="scr-search"
          type="search"
          placeholder="Tìm symbol / tên…"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
        />
      </div>

      {/* ── table ── */}
      <div className="scr-table-wrap">
        <table className="scr-table scr-table--radar">
          <thead>
            <tr>
              <th className="scr-th scr-th--coin" onClick={() => setSortKey('coin')}>
                Coin {sortKey === 'coin' && '↑'}
              </th>
              <th className="scr-th">Stage</th>
              <th className="scr-th scr-th--signal" onClick={() => setSortKey('signal')}>
                Signal {sortKey === 'signal' && '↓'}
              </th>
              <th className="scr-th scr-th--num" onClick={() => setSortKey('rsi')}>
                RSI {sortKey === 'rsi' && '↓'}
              </th>
              <th className="scr-th scr-th--num" onClick={() => setSortKey('vol')}>
                Vol× {sortKey === 'vol' && '↓'}
              </th>
              <th className="scr-th scr-th--num" onClick={() => setSortKey('ext')}>
                Ext% {sortKey === 'ext' && '↓'}
              </th>
              <th className="scr-th">vs EMA</th>
              <th className="scr-th">Xổ số</th>
              <th className="scr-th">30d</th>
              <th className="scr-th scr-th--num">Mkt Cap</th>
              <th className="scr-th scr-th--num">Listed</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={11} className="scr-empty">
                  {coins.length === 0
                    ? 'Add coins to start tracking.'
                    : nameFilter
                    ? `Không tìm thấy coin khớp với "${nameFilter}".`
                    : 'All coins are hidden by stage filter.'}
                </td>
              </tr>
            )}
            {paginated.map((coin) => {
              const sig = coin.signal;
              const stage = (sig?.stage ?? 'Quiet') as MemeStage;
              const tvUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}USDT`;
              return (
                <tr
                  key={coin.id}
                  className="scr-row"
                  onClick={() => window.open(tvUrl, '_blank')}
                >
                  <td className="scr-td scr-td--coin">
                    <span className="scr-symbol">{coin.symbol}</span>
                    {coin.name && <span className="scr-name">{coin.name}</span>}
                    <button
                      className="sc-history-btn"
                      title="Lịch sử radar"
                      aria-label={`Lịch sử radar ${coin.symbol}`}
                      onClick={(e) => { e.stopPropagation(); setHistoryCoin(coin.symbol); }}
                    >
                      🕒
                    </button>
                  </td>
                  <td className="scr-td">
                    <StageBadge stage={stage} />
                  </td>
                  <td className="scr-td scr-td--signal">
                    <SignalBar score={sig?.signalScore ?? 0} stage={stage} />
                    <span className="scr-signal-num">{sig?.signalScore ?? '—'}</span>
                  </td>
                  <td className="scr-td scr-td--num">
                    <RsiCell rsi={sig?.rsi ?? null} />
                  </td>
                  <td className="scr-td scr-td--num">
                    <VolCell vol={sig?.volMultiplier ?? null} />
                  </td>
                  <td className="scr-td scr-td--num">
                    <ExtCell ext={sig?.extPct ?? null} />
                  </td>
                  <td className="scr-td">
                    {sig ? (
                      <EmaPips
                        ema34Above={sig.ema34Above}
                        ema89Above={sig.ema89Above}
                        ema200Above={sig.ema200Above}
                      />
                    ) : (
                      <span className="scr-muted">—</span>
                    )}
                  </td>
                  <td className="scr-td scr-td--lotto" onClick={(e) => e.stopPropagation()}>
                    <LotteryCell stage={stage} sparkline={sig?.sparkline ?? []} />
                  </td>
                  <td className="scr-td scr-td--sparkline">
                    <Sparkline prices={sig?.sparkline ?? []} />
                  </td>
                  <td className="scr-td scr-td--num">
                    <MarketCapCell cap={coin.marketCap} />
                  </td>
                  <td className="scr-td scr-td--num">
                    <ListingDateCell date={coin.listingDate} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── pagination ── */}
      {totalPages > 1 && (
        <div className="scr-pagination">
          <button
            className="scr-page-btn"
            onClick={() => setPage(1)}
            disabled={safePage === 1}
          >
            «
          </button>
          <button
            className="scr-page-btn"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
          >
            ‹
          </button>
          <span className="scr-page-info">
            Trang {safePage} / {totalPages}
            <span className="scr-page-sub">
              &nbsp;({(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, sorted.length)} / {sorted.length})
            </span>
          </span>
          <button
            className="scr-page-btn"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
          >
            ›
          </button>
          <button
            className="scr-page-btn"
            onClick={() => setPage(totalPages)}
            disabled={safePage === totalPages}
          >
            »
          </button>
        </div>
      )}

      {/* ── legend ── */}
      <div className="scr-legend">
        <span className="scr-stage scr-stage--breakout">Breakout</span><span>vào soi ngay</span>
        <span className="scr-stage scr-stage--trending">Trending</span><span>trend xác nhận, giữ lệnh</span>
        <span className="scr-stage scr-stage--accumulating">Accumulating</span><span>theo dõi</span>
        <span className="scr-stage scr-stage--waking">Waking</span><span>chớm động</span>
        <span className="scr-stage scr-stage--extended">Extended</span><span>đã chạy, tránh đu</span>
        <span className="scr-stage scr-stage--oversold">Oversold</span><span>điểm vào xổ số</span>
        <span className="scr-stage scr-stage--quiet">Quiet</span><span>bỏ qua</span>
      </div>

      {/* ── lottery strategy note ── */}
      <div className="scr-lotto-note">
        🎟 <strong>Chiến lược xổ số</strong> (đã backtest ~2.7 năm trên ATM/PIVX/ORDI + 30 small-cap; meme coin là rổ vé số điển hình):
        vào lệnh khi coin ở stage <span className="scr-stage scr-stage--oversold">Oversold</span> (quá bán sâu:
        RSI&lt;30, dưới EMA200, giảm ≥25%/10 ngày) — <strong>size nhỏ cố định, chia đều rổ, không nén vốn, không nhồi</strong>.
        Chốt: bán ½ ở <strong>+{(LOTTERY_TP1 * 100).toFixed(0)}%</strong>, bán phần còn lại ở <strong>+{(LOTTERY_TP2 * 100).toFixed(0)}%</strong>;
        cắt lỗ thảm hoạ <strong>−{(LOTTERY_STOP * 100).toFixed(0)}%</strong>; nếu sau <strong>{LOTTERY_TIME_STOP_DAYS} ngày</strong> không chạm TP/SL thì thoát, quay vòng vốn.
        Kỳ vọng ~7–9%/năm trên vốn rổ — một mảng nhỏ bất đối xứng, không phải máy in tiền.
      </div>
    </main>
  );
}
