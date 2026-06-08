'use client';

import { useState, useMemo } from 'react';
import { resolveApiBaseUrl } from '@web/shared/api/client';
import type { SmallCapCoinRow, SmallCapStage } from '@web/shared/api/types';

/* ── types ──────────────────────────────────────────────────── */

type Props = { initialCoins: SmallCapCoinRow[] };

type SortKey = 'signal' | 'rsi' | 'vol' | 'coin';

const ALL_STAGES: SmallCapStage[] = ['Breakout', 'Accumulating', 'Waking', 'Extended', 'Quiet'];

/* ── stage badge ─────────────────────────────────────────────── */

function StageBadge({ stage }: { stage: SmallCapStage }) {
  const cls: Record<SmallCapStage, string> = {
    Breakout: 'scr-stage scr-stage--breakout',
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

function AddCoinForm({ onAdded }: { onAdded: (coin: SmallCapCoinRow) => void }) {
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/small-cap-radar/coins`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, name: name.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { id: string; symbol: string; name: string };
      onAdded({ ...data, addedAt: new Date().toISOString(), signal: null });
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
        placeholder="Symbol (e.g. EIGEN)"
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

export function SmallCapRadarFeed({ initialCoins }: Props) {
  const [coins, setCoins] = useState<SmallCapCoinRow[]>(initialCoins);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('signal');
  const [hiddenStages, setHiddenStages] = useState<Set<SmallCapStage>>(new Set(['Quiet']));
  const [showAddForm, setShowAddForm] = useState(false);

  function toggleStage(stage: SmallCapStage) {
    setHiddenStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }

  async function handleSyncCoins() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await fetch(`${resolveApiBaseUrl()}/small-cap-radar/rescan-coins`, {
        method: 'POST',
        credentials: 'include',
      });
      setSyncMsg('Đang sync coin list từ Binance/CoinGecko, có thể mất vài phút. Refresh lại trang để xem kết quả.');
    } catch {
      setSyncMsg('Sync thất bại, thử lại sau.');
    } finally {
      setSyncing(false);
    }
  }

  async function reloadCoins() {
    try {
      const res = await fetch(`${resolveApiBaseUrl()}/small-cap-radar`, { credentials: 'include' });
      const updated = await res.json() as SmallCapCoinRow[];
      setCoins(updated);
    } catch {
      // ignore
    }
  }

  async function handleRemove(symbol: string) {
    try {
      await fetch(`${resolveApiBaseUrl()}/small-cap-radar/coins/${encodeURIComponent(symbol)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setCoins((prev) => prev.filter((c) => c.symbol !== symbol));
    } catch {
      // ignore
    }
  }

  const sorted = useMemo(() => {
    const filtered = coins.filter((c) => {
      if (c.signal === null) return true; // coins without a signal are always shown
      const stage = c.signal.stage as SmallCapStage;
      return !hiddenStages.has(stage);
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === 'signal') return (b.signal?.signalScore ?? 0) - (a.signal?.signalScore ?? 0);
      if (sortKey === 'rsi') return (b.signal?.rsi ?? 0) - (a.signal?.rsi ?? 0);
      if (sortKey === 'vol') return (b.signal?.volMultiplier ?? 0) - (a.signal?.volMultiplier ?? 0);
      return a.symbol.localeCompare(b.symbol);
    });
  }, [coins, sortKey, hiddenStages]);

  return (
    <main className="dashboard-shell scr-shell">
      {/* ── toolbar ── */}
      <div className="scr-toolbar">
        <div className="scr-toolbar-left">
          <h1 className="scr-title">Small Cap Radar</h1>
          <span className="scr-count">{coins.length} coins</span>
        </div>
        <div className="scr-toolbar-right">
          <button
            className="scr-scan-btn"
            onClick={reloadCoins}
          >
            ↻ Refresh
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

      {/* ── stage filter chips ── */}
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
      </div>

      {/* ── table ── */}
      <div className="scr-table-wrap">
        <table className="scr-table">
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
              <th className="scr-th">vs EMA</th>
              <th className="scr-th">30d</th>
              <th className="scr-th scr-th--actions" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="scr-empty">
                  {coins.length === 0 ? 'Add coins to start tracking.' : 'All coins are hidden by stage filter.'}
                </td>
              </tr>
            )}
            {sorted.map((coin) => {
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
                  <td
                    className="scr-td scr-td--actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="scr-remove-btn"
                      onClick={() => handleRemove(coin.symbol)}
                      aria-label={`Remove ${coin.symbol}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── legend ── */}
      <div className="scr-legend">
        <span className="scr-stage scr-stage--breakout">Breakout</span><span>vào soi ngay</span>
        <span className="scr-stage scr-stage--accumulating">Accumulating</span><span>theo dõi</span>
        <span className="scr-stage scr-stage--waking">Waking</span><span>chớm động</span>
        <span className="scr-stage scr-stage--extended">Extended</span><span>đã chạy, tránh đu</span>
        <span className="scr-stage scr-stage--quiet">Quiet</span><span>bỏ qua</span>
      </div>
    </main>
  );
}
