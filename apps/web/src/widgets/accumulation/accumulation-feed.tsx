'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { TrackingCoinRow } from '@web/shared/api/types';

type Props = { initialCoins: TrackingCoinRow[] };
type ZoneFilter = 'all' | 'GOM' | 'CHO' | 'CHOT';

const PRICE_REFRESH_MS = 5000;

const apiClient = createApiClient();

/* ── live prices ────────────────────────────────────────────────── */

function useLivePrices(symbols: string[]) {
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const key = symbols.join(',');

  const fetchPrices = useCallback(async () => {
    if (symbols.length === 0) return;
    const usdt = symbols.map((s) => `${s}USDT`);
    const query = encodeURIComponent(JSON.stringify(usdt));
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${query}`);
      if (!res.ok) return;
      const data = (await res.json()) as { symbol: string; price: string }[];
      const next = new Map<string, number>();
      for (const { symbol, price } of data) next.set(symbol.replace(/USDT$/, ''), parseFloat(price));
      setPrices(next);
    } catch {
      /* ignore */
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPrices();
    const id = setInterval(fetchPrices, PRICE_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchPrices]);

  return prices;
}

/* ── helpers ────────────────────────────────────────────────────── */

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(7);
}

function fmtMarketCap(cap: number | null): string {
  if (cap == null) return '—';
  if (cap >= 1_000_000_000) return `$${(cap / 1_000_000_000).toFixed(1)}B`;
  if (cap >= 1_000_000) return `$${(cap / 1_000_000).toFixed(1)}M`;
  return `$${cap.toLocaleString()}`;
}

const ZONE_META: Record<'GOM' | 'CHO' | 'CHOT', { label: string; cls: string; title: string }> = {
  GOM: { label: 'GOM', cls: 'tc-zone--gom', title: 'Vùng tích luỹ + qua cổng dcaScore → gom (spot, no SL)' },
  CHOT: { label: 'CHỐT', cls: 'tc-zone--chot', title: 'Giá đã hồi lên EMA34 → chốt nếu đang ôm' },
  CHO: { label: 'Chờ', cls: 'tc-zone--cho', title: 'Chưa vào vùng tích luỹ chất lượng hoặc chưa qua cổng dcaScore' },
};

// GOM first (the actionable buys), then CHO, then CHOT.
const ZONE_RANK: Record<'GOM' | 'CHO' | 'CHOT', number> = { GOM: 0, CHO: 1, CHOT: 2 };

function dcaBucket(score: number): { label: string; cls: string } {
  if (score >= 70) return { label: 'safe', cls: 'tc-zone--gom' };
  if (score >= 50) return { label: 'ok', cls: 'tc-zone--chot' };
  if (score >= 30) return { label: 'risky', cls: 'tc-zone--cho' };
  return { label: 'avoid', cls: 'tc-zone--cho' };
}

/* ── component ──────────────────────────────────────────────────── */

export function AccumulationFeed({ initialCoins }: Props) {
  const [coins, setCoins] = useState<TrackingCoinRow[]>(initialCoins);
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('all');
  const [scanning, setScanning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const reloadingRef = useRef(false);

  const symbols = useMemo(() => coins.map((c) => c.symbol), [coins]);
  const prices = useLivePrices(symbols);

  const reloadCoins = useCallback(async () => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    try {
      const fresh = await apiClient.fetchTrackingCoins();
      setCoins(fresh);
    } catch {
      /* ignore */
    } finally {
      reloadingRef.current = false;
    }
  }, []);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setStatusMsg(null);
    try {
      const r = await apiClient.triggerTrackingCoinsScan();
      setStatusMsg(`Đã scan ${r.scanned} coin${r.failed ? `, ${r.failed} lỗi` : ''}.`);
      await reloadCoins();
    } catch {
      setStatusMsg('Scan thất bại.');
    } finally {
      setScanning(false);
    }
  }, [reloadCoins]);

  const zoneCounts = useMemo(() => {
    const c: Record<'GOM' | 'CHO' | 'CHOT', number> = { GOM: 0, CHO: 0, CHOT: 0 };
    for (const x of coins) {
      const z = x.signal?.accZone;
      if (z) c[z] += 1;
    }
    return c;
  }, [coins]);

  const sorted = useMemo(() => {
    const filtered = coins.filter((c) => {
      if (zoneFilter === 'all') return true;
      return c.signal?.accZone === zoneFilter;
    });
    return [...filtered].sort((a, b) => {
      const za = a.signal?.accZone ?? 'CHO';
      const zb = b.signal?.accZone ?? 'CHO';
      if (ZONE_RANK[za] !== ZONE_RANK[zb]) return ZONE_RANK[za] - ZONE_RANK[zb];
      // within a zone: higher dcaScore first (safest to DCA)
      return (b.signal?.dcaScore ?? 0) - (a.signal?.dcaScore ?? 0);
    });
  }, [coins, zoneFilter]);

  return (
    <main className="dashboard-shell scr-shell">
      <div className="tc-page-header">
        <div className="tc-page-header-left">
          <h1 className="scr-title">Tích luỹ (Accumulation DCA)</h1>
          <p className="tc-page-header-sub">
            Gom spot, KHÔNG stop-loss · vào vùng tích luỹ (giảm sâu + đi ngang) qua cổng dcaScore ·{' '}
            {coins.length} coin · GOM {zoneCounts.GOM}
          </p>
        </div>
        <div className="scr-toolbar-right">
          <button className="scr-scan-btn" onClick={handleScan} disabled={scanning}>
            {scanning ? 'Đang scan…' : '⚡ Re-analyze'}
          </button>
        </div>
      </div>

      {statusMsg && <p className="scr-scan-result">{statusMsg}</p>}

      <div className="tc-filters">
        <div className="tc-chip-row">
          {(['GOM', 'CHO', 'CHOT'] as const).map((z) => (
            <button
              key={z}
              className={`ts-filter${zoneFilter === z ? ' is-active' : ''}`}
              onClick={() => setZoneFilter((v) => (v === z ? 'all' : z))}
            >
              {ZONE_META[z].label} <span className="ts-filter-count">{zoneCounts[z]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="scr-table-wrap">
        <table className="scr-table">
          <thead>
            <tr>
              <th className="scr-th scr-th--coin">Coin</th>
              <th className="scr-th scr-th--num">Giá</th>
              <th className="scr-th scr-th--num">Market Cap</th>
              <th className="scr-th scr-th--num">Drawdown</th>
              <th className="scr-th scr-th--num">Base%</th>
              <th className="scr-th scr-th--num">RSI</th>
              <th className="scr-th scr-th--num">dcaScore</th>
              <th className="scr-th">Tín hiệu</th>
              <th className="scr-th">Lý do</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="scr-empty">
                  {coins.length === 0 ? 'Chưa có coin nào trong danh sách tracking.' : 'Không có coin nào khớp filter.'}
                </td>
              </tr>
            )}
            {sorted.map((coin) => {
              const sig = coin.signal;
              const z = sig?.accZone ? ZONE_META[sig.accZone] : null;
              const price = prices.get(coin.symbol);
              const bucket = sig ? dcaBucket(sig.dcaScore) : null;
              return (
                <tr key={coin.id} className="scr-row">
                  <td className="scr-td scr-td--coin">
                    <span className="scr-symbol">{coin.symbol}</span>
                    {coin.name && <span className="scr-name">{coin.name}</span>}
                  </td>
                  <td className="scr-td scr-td--num">{price != null ? formatPrice(price) : '—'}</td>
                  <td className="scr-td scr-td--num">{fmtMarketCap(coin.marketCap)}</td>
                  <td className="scr-td scr-td--num">
                    {sig?.accDrawdownPct != null ? `-${sig.accDrawdownPct}%` : '—'}
                  </td>
                  <td className="scr-td scr-td--num">
                    {sig?.accBaseWidthPct != null ? `${sig.accBaseWidthPct}%` : '—'}
                  </td>
                  <td className="scr-td scr-td--num">{sig?.rsi != null ? Math.round(sig.rsi) : '—'}</td>
                  <td className="scr-td scr-td--num">
                    {sig ? (
                      <span className={`tc-zone ${bucket!.cls}`} title={`dcaScore ${sig.dcaScore} (${bucket!.label})`}>
                        {sig.dcaScore}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="scr-td">
                    {z ? (
                      <span className={`tc-zone ${z.cls}`} title={z.title}>
                        {z.label}
                      </span>
                    ) : (
                      <span className="scr-muted">—</span>
                    )}
                  </td>
                  <td className="scr-td">
                    <span className="scr-muted" style={{ fontSize: '0.78rem' }}>
                      {sig ? accReason(sig) : '—'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

// Re-derive a short reason from the persisted fields (the worker stores the metrics,
// not the prose, so the UI stays in sync with the signal even on old rows).
function accReason(sig: NonNullable<TrackingCoinRow['signal']>): string {
  if (sig.accZone === 'CHOT') return 'Giá đã hồi lên EMA34 → chốt / không gom';
  if (sig.accZone === 'GOM') return `Tích luỹ -${sig.accDrawdownPct}% từ đỉnh, base ${sig.accBaseWidthPct}%, qua cổng dcaScore ✓`;
  if (sig.accInBase && sig.accGatePassed === false) return `Đủ tích luỹ nhưng dcaScore ${sig.dcaScore} < 50 → chờ`;
  return 'Chưa vào vùng tích luỹ chất lượng → chờ';
}
