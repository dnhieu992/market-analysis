'use client';

import { useState, useMemo, useEffect } from 'react';
import { resolveApiBaseUrl } from '@web/shared/api/client';
import type { TopCapCoinRow, SmallCapStage } from '@web/shared/api/types';

/* ── types ──────────────────────────────────────────────────── */

type Props = { initialCoins: TopCapCoinRow[] };

type SortKey = 'signal' | 'rsi' | 'vol' | 'ext' | 'coin';

const ALL_STAGES: SmallCapStage[] = ['Breakout', 'Trending', 'Accumulating', 'Waking', 'Extended', 'Quiet'];
const PAGE_SIZE = 50;

/* ── stage badge ─────────────────────────────────────────────── */

function StageBadge({ stage }: { stage: SmallCapStage }) {
  const cls: Record<SmallCapStage, string> = {
    Breakout: 'scr-stage scr-stage--breakout',
    Trending: 'scr-stage scr-stage--trending',
    Accumulating: 'scr-stage scr-stage--accumulating',
    Waking: 'scr-stage scr-stage--waking',
    Extended: 'scr-stage scr-stage--extended',
    Quiet: 'scr-stage scr-stage--quiet',
  };
  return <span className={cls[stage]}>{stage}</span>;
}

/* ── signal bar ──────────────────────────────────────────────── */

function SignalBar({ score, stage }: { score: number; stage: SmallCapStage }) {
  const width = `${score}%`;
  const barCls =
    stage === 'Extended' ? 'scr-bar scr-bar--extended' :
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

function AddCoinForm({ onAdded }: { onAdded: (coin: TopCapCoinRow) => void }) {
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/top-cap-radar/coins`, {
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
        placeholder="Symbol (e.g. BTC)"
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

export function TopCapRadarFeed({ initialCoins }: Props) {
  const [coins, setCoins] = useState<TopCapCoinRow[]>(initialCoins);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('signal');
  const [hiddenStages, setHiddenStages] = useState<Set<SmallCapStage>>(new Set<SmallCapStage>());
  const [showAddForm, setShowAddForm] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [page, setPage] = useState(1);

  function toggleStage(stage: SmallCapStage) {
    setHiddenStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }

  // Reset to page 1 whenever filters or sort change
  useEffect(() => { setPage(1); }, [nameFilter, hiddenStages, sortKey]);

  async function reloadCoins() {
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/top-cap-radar`, { credentials: 'include' });
      if (!res.ok) return;
      const updated = await res.json() as TopCapCoinRow[];
      setCoins(updated);
    } catch {
      // ignore
    }
  }

  async function handleReanalyze() {
    setReanalyzing(true);
    setScanMsg(null);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/top-cap-radar/scan`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json() as { scanned: number; failed: number };
        setScanMsg(`Re-analyze xong: ${data.scanned} coins scanned, ${data.failed} failed.`);
        await reloadCoins();
      }
    } catch {
      setScanMsg('Re-analyze thất bại, thử lại sau.');
    } finally {
      setReanalyzing(false);
    }
  }

  const sorted = useMemo(() => {
    const q = nameFilter.trim().toUpperCase();
    const filtered = coins.filter((c) => {
      if (q && !c.symbol.includes(q) && !c.name.toUpperCase().includes(q)) return false;
      if (c.signal === null) return true;
      const stage = c.signal.stage as SmallCapStage;
      return !hiddenStages.has(stage);
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === 'signal') return (b.signal?.signalScore ?? 0) - (a.signal?.signalScore ?? 0);
      if (sortKey === 'rsi') return (b.signal?.rsi ?? 0) - (a.signal?.rsi ?? 0);
      if (sortKey === 'vol') return (b.signal?.volMultiplier ?? 0) - (a.signal?.volMultiplier ?? 0);
      if (sortKey === 'ext') return (b.signal?.extPct ?? -Infinity) - (a.signal?.extPct ?? -Infinity);
      return a.symbol.localeCompare(b.symbol);
    });
  }, [coins, sortKey, hiddenStages, nameFilter]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <main className="dashboard-shell scr-shell">
      {/* ── toolbar ── */}
      <div className="scr-toolbar">
        <div className="scr-toolbar-left">
          <h1 className="scr-title">Top Cap Radar</h1>
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
            className="scr-add-toggle"
            onClick={() => setShowAddForm((v) => !v)}
          >
            {showAddForm ? '✕' : '+ Coin'}
          </button>
        </div>
      </div>

      {scanMsg && (
        <p className="scr-scan-result">{scanMsg}</p>
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
              <th className="scr-th">30d</th>
              <th className="scr-th scr-th--num">Mkt Cap</th>
              <th className="scr-th scr-th--num">Listed</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="scr-empty">
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
              const stage = (sig?.stage ?? 'Quiet') as SmallCapStage;
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
        <span className="scr-stage scr-stage--quiet">Quiet</span><span>bỏ qua</span>
      </div>
    </main>
  );
}
