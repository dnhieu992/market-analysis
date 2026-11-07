'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import type { JunkCoinStat, JunkShortCoin } from '@web/shared/api/types';

import styles from './junk-coins.module.css';

const api = createApiClient();

/** `ordi, PIVX/USDT\nsui_usdt` → ['ORDIUSDT', 'PIVXUSDT', 'SUIUSDT'] (dedup, USDT appended). */
export function parseSymbols(raw: string): string[] {
  const out = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase().replace(/[_/-]/g, ''))
    .filter(Boolean)
    .map((s) => (s.endsWith('USDT') ? s : `${s}USDT`));
  return [...new Set(out)];
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' });
const bySymbol = (a: JunkShortCoin, b: JunkShortCoin) => a.symbol.localeCompare(b.symbol);

type Banner = { kind: 'info' | 'error'; text: string; stale?: string[] };

type SortKey = 'symbol' | 'cap' | 'ath' | 'below' | 'c24' | 'c3' | 'c7' | 'c30' | 'c90' | 'funding' | 'spot';
const POLL_MS = 30_000;

const SORT_VALUE: Record<SortKey, (s: JunkCoinStat | undefined, c: JunkShortCoin) => number | string | null> = {
  symbol: (_s, c) => c.symbol,
  cap: (s) => s?.marketCapUsd ?? null,
  ath: (s) => (s?.athDate ? Date.parse(s.athDate) : null),
  below: (s) => s?.belowAthPct ?? null,
  c24: (s) => s?.change24hPct ?? null,
  c3: (s) => s?.change3dPct ?? null,
  c7: (s) => s?.change7dPct ?? null,
  c30: (s) => s?.change30dPct ?? null,
  c90: (s) => s?.change90dPct ?? null,
  funding: (s) => s?.fundingRatePct ?? null,
  spot: (s) => (s?.spotListedAt ? Date.parse(s.spotListedAt) : null),
};

const fmtCap = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : `$${(n / 1e3).toFixed(0)}K`;
const fmtPrice = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 4 : 8 });

function Pct({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className={styles.muted}>—</span>;
  return <span className={v > 0 ? styles.up : v < 0 ? styles.down : ''}>{v > 0 ? '+' : ''}{v.toFixed(1)}%</span>;
}

function countdown(ms: number): string {
  if (ms <= 0) return 'đang tính';
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function age(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  return days >= 365 ? `${(days / 365).toFixed(1)} năm` : `${days} ngày`;
}

/** The /short-junk coin list: toolbar (add dialog · Binance sync · search) + live Binance stats table. */
export function JunkCoinsManager({ coins, onChange }: { coins: JunkShortCoin[]; onChange: (coins: JunkShortCoin[]) => void }) {
  const [query, setQuery] = useState('');
  const [eco, setEco] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'c24', dir: -1 });
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [stats, setStats] = useState<Map<string, JunkCoinStat>>(new Map());
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const symbolsKey = coins.map((c) => c.symbol).join(',');

  // Live stats: refetch every 30 s while the tab is visible, and whenever the list changes.
  useEffect(() => {
    if (!symbolsKey) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      api
        .fetchJunkCoinStats()
        .then((r) => {
          if (cancelled) return;
          setStats(new Map(r.stats.map((x) => [x.symbol, x])));
          setUpdatedAt(r.updatedAt);
          setStatsError(null);
        })
        .catch((e) => !cancelled && setStatsError(e instanceof Error ? e.message : 'Không tải được số liệu Binance.'));
    };
    load();
    const id = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', load);
    };
  }, [symbolsKey]);

  // Funding countdown ticks every second.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ecoCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of coins) for (const e of stats.get(c.symbol)?.ecosystems ?? []) m.set(e, (m.get(e) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [coins, stats]);

  const q = query.trim().toUpperCase();
  const shown = useMemo(() => {
    const rows = coins.filter((c) => {
      const st = stats.get(c.symbol);
      if (eco && !st?.ecosystems.includes(eco)) return false;
      return !q || c.symbol.includes(q) || (st?.name ?? '').toUpperCase().includes(q);
    });
    const val = SORT_VALUE[sort.key];
    return rows.sort((a, b) => {
      const va = val(stats.get(a.symbol), a);
      const vb = val(stats.get(b.symbol), b);
      if (va == null && vb == null) return a.symbol.localeCompare(b.symbol);
      if (va == null) return 1; // missing values always last
      if (vb == null) return -1;
      return (typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)) * sort.dir;
    });
  }, [coins, stats, eco, q, sort]);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    setBanner(null);
    try {
      const r = await api.syncJunkCoins();
      onChange([...r.coins].sort(bySymbol));
      setBanner({
        kind: 'info',
        text:
          `Đã quét ${r.scanned} coin futures Binance · ${r.junk} coin đạt tiêu chí coin rác · thêm mới ${r.added.length}` +
          (r.added.length ? ` (${r.added.slice(0, 12).map((s) => s.replace(/USDT$/, '')).join(', ')}${r.added.length > 12 ? '…' : ''})` : '') +
          '.',
        stale: r.noLongerJunk,
      });
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : 'Sync từ Binance thất bại.' });
    } finally {
      setSyncing(false);
    }
  };

  const removeMany = async (symbols: string[]) => {
    if (!window.confirm(`Xoá ${symbols.length} coin không còn đạt tiêu chí coin rác khỏi danh sách?`)) return;
    setBanner(null);
    const gone: string[] = [];
    for (const s of symbols) {
      try {
        await api.deleteJunkCoin(s);
        gone.push(s);
      } catch {
        /* keep it — reported below */
      }
    }
    onChange(coins.filter((c) => !gone.includes(c.symbol)));
    setBanner({ kind: gone.length === symbols.length ? 'info' : 'error', text: `Đã xoá ${gone.length}/${symbols.length} coin.` });
  };

  const remove = async (symbol: string) => {
    if (rowBusy || !window.confirm(`Xoá ${symbol} khỏi danh sách coin rác? Skill sẽ không scan coin này nữa.`)) return;
    setRowBusy(symbol);
    try {
      await api.deleteJunkCoin(symbol);
      onChange(coins.filter((c) => c.symbol !== symbol));
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : 'Xoá coin thất bại.' });
    } finally {
      setRowBusy(null);
    }
  };

  const Th = ({ k, label, title, num = true }: { k: SortKey; label: string; title?: string; num?: boolean }) => (
    <th className={num ? styles.num : ''} title={title} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={styles.sortBtn}
        onClick={() => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: k === 'symbol' ? 1 : -1 }))}
      >
        {label}
        <span className={styles.sortMark}>{sort.key === k ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );

  return (
    <section className={styles.card}>
      <div className={styles.toolbar}>
        <h2 className={styles.cardTitle}>
          Danh sách coin rác ({coins.length})
          {updatedAt && (
            <span className={styles.updated} title={statsError ?? 'Số liệu Binance tự cập nhật mỗi 30 giây'}>
              {statsError ? '⚠ lỗi cập nhật' : `● Binance ${new Date(updatedAt).toLocaleTimeString('vi-VN')}`}
            </span>
          )}
        </h2>
        <div className={styles.toolbarActions}>
          {coins.length > 0 && (
            <input className={styles.searchInput} type="search" value={query} placeholder="Tìm coin…" onChange={(e) => setQuery(e.target.value)} />
          )}
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void sync()}
            disabled={syncing}
            title="Quét toàn bộ futures USDT-M Binance theo tiêu chí coin rác (spot + futures, list ≥ 90 ngày, vốn hoá $20–500M, ≥ 50% dưới ATH) và thêm coin chưa có. Không xoá coin nào."
          >
            {syncing ? 'Đang quét Binance…' : '⟳ Sync từ Binance'}
          </button>
          <button type="button" className={styles.primaryBtn} onClick={() => setAdding(true)}>
            + Thêm coin
          </button>
        </div>
      </div>

      {banner && (
        <div className={`bg-alert ${banner.kind === 'error' ? 'bg-alert--error' : ''} ${styles.banner}`}>
          <span>{banner.text}</span>
          {banner.stale && banner.stale.length > 0 && (
            <span>
              {' '}
              {banner.stale.length} coin đã sync trước đây không còn đạt tiêu chí: {banner.stale.map((s) => s.replace(/USDT$/, '')).join(', ')}.{' '}
              <button type="button" className={`${styles.linkBtn} ${styles.linkBtnDanger}`} onClick={() => void removeMany(banner.stale!)}>
                Xoá các coin này
              </button>
            </span>
          )}
          <button type="button" className={styles.bannerX} onClick={() => setBanner(null)} aria-label="Đóng">×</button>
        </div>
      )}

      {ecoCounts.length > 0 && (
        <div className={styles.chips} role="group" aria-label="Lọc theo hệ sinh thái">
          <button type="button" className={`${styles.chip} ${eco == null ? styles.chipActive : ''}`} onClick={() => setEco(null)}>
            Tất cả <small>{coins.length}</small>
          </button>
          {ecoCounts.map(([name, n]) => (
            <button key={name} type="button" className={`${styles.chip} ${eco === name ? styles.chipActive : ''}`} onClick={() => setEco(eco === name ? null : name)}>
              {name} <small>{n}</small>
            </button>
          ))}
        </div>
      )}

      {coins.length === 0 ? (
        <p className={styles.empty}>
          Chưa có coin nào — bấm <strong>⟳ Sync từ Binance</strong> để lấy toàn bộ coin rác theo tiêu chí nghiên cứu, hoặc <strong>+ Thêm coin</strong> để tự thêm.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <Th k="symbol" label="Coin" num={false} />
                <th>Hệ sinh thái</th>
                <Th k="cap" label="Vốn hoá" title="Circulating supply × giá (Binance)" />
                <Th k="ath" label="ATH" title="Đỉnh mọi thời đại (nến tuần cao nhất trên Binance spot + futures) · ngày đạt đỉnh — sắp xếp theo ngày" />
                <Th k="below" label="% dưới ATH" title="Giá hiện tại thấp hơn ATH bao nhiêu % — nghiên cứu: coin còn cách ATH < 50% short lỗ (PF 0.75)" />
                <Th k="c24" label="24h" />
                <Th k="c3" label="3D" title="Giá hiện tại so với giá đóng nến D1 3 ngày trước" />
                <Th k="c7" label="7D" />
                <Th k="c30" label="30D" />
                <Th k="c90" label="90D" />
                <Th k="funding" label="Funding" title="Funding rate hiện tại · chu kỳ tính (1h / 4h / 8h) · thời gian tới lần tính tiếp" />
                <Th k="spot" label="List spot" title="Ngày list spot trên Binance (nến D1 đầu tiên)" />
                <th>Nguồn</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const st = stats.get(c.symbol);
                return (
                  <tr key={c.symbol}>
                    <td className={styles.sym}>
                      <div className={styles.symName} title={st?.name ?? undefined}>{c.symbol.replace(/USDT$/, '')}</div>
                      {st?.price != null && <div className={styles.sub}>{fmtPrice(st.price)}</div>}
                      {st?.name && st.name.toUpperCase() !== c.symbol.replace(/USDT$/, '') && (
                        <div className={`${styles.sub} ${styles.projName}`} title={st.name}>{st.name}</div>
                      )}
                      {st?.monitoring && <span className={`${styles.badge} ${styles.badgeWarn}`} title="Binance gắn tag Monitoring — rủi ro delist, tail rất dày">Monitoring</span>}
                      {st && !st.onSpot && <span className={`${styles.badge} ${styles.badgeWarn}`}>không spot</span>}
                    </td>
                    <td>
                      <div className={styles.ecoList}>
                        {st?.ecosystems.length ? st.ecosystems.map((e) => <span key={e} className={styles.badge}>{e}</span>) : <span className={styles.muted}>—</span>}
                      </div>
                    </td>
                    <td className={styles.num}>{fmtCap(st?.marketCapUsd)}</td>
                    <td className={styles.num}>
                      {st?.athPrice != null ? (
                        <>
                          <div>{fmtPrice(st.athPrice)}</div>
                          {st.athDate && <div className={styles.sub}>{fmtDate(st.athDate)}</div>}
                        </>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={styles.num}>
                      {st?.belowAthPct != null ? (
                        <span className={st.belowAthPct < 50 ? styles.warnText : ''} title={st.belowAthPct < 50 ? 'Còn cách ATH < 50% — ngoài tiêu chí coin rác của nghiên cứu' : undefined}>
                          −{st.belowAthPct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={styles.num}><Pct v={st?.change24hPct} /></td>
                    <td className={styles.num}><Pct v={st?.change3dPct} /></td>
                    <td className={styles.num}><Pct v={st?.change7dPct} /></td>
                    <td className={styles.num}><Pct v={st?.change30dPct} /></td>
                    <td className={styles.num}><Pct v={st?.change90dPct} /></td>
                    <td className={styles.num}>
                      {st?.fundingRatePct != null ? (
                        <>
                          <div className={st.fundingRatePct < 0 ? styles.down : st.fundingRatePct > 0.01 ? styles.up : ''}>
                            {st.fundingRatePct > 0 ? '+' : ''}
                            {st.fundingRatePct.toFixed(4)}%
                          </div>
                          <div className={styles.sub}>
                            mỗi {st.fundingIntervalHours}h{st.nextFundingTime ? ` · ${countdown(st.nextFundingTime - now)}` : ''}
                          </div>
                        </>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={styles.num}>
                      {st?.spotListedAt ? (
                        <>
                          <div>{fmtDate(st.spotListedAt)}</div>
                          <div className={styles.sub}>{age(st.spotListedAt, now)}</div>
                        </>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`${styles.badge} ${c.source === 'BINANCE_SYNC' ? styles.badgeSync : ''}`}>
                        {c.source === 'BINANCE_SYNC' ? 'Binance' : 'Tự thêm'}
                      </span>
                    </td>
                    <td className={styles.rowActions}>
                      <button
                        type="button"
                        className={`${styles.linkBtn} ${styles.linkBtnDanger}`}
                        disabled={rowBusy === c.symbol}
                        onClick={() => void remove(c.symbol)}
                      >
                        {rowBusy === c.symbol ? '…' : 'Xoá'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={14} className={styles.empty}>Không tìm thấy.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddCoinsDialog
          coins={coins}
          onClose={() => setAdding(false)}
          onAdded={(rows, rejected) => {
            merge(rows);
            setAdding(false);
            setBanner({
              kind: rejected.length ? 'error' : 'info',
              text:
                `Đã lưu ${rows.length} coin.` +
                (rejected.length ? ` Bỏ qua (không có futures USDT-M trên Binance): ${rejected.join(', ')}.` : ''),
            });
          }}
        />
      )}
    </section>
  );

  function merge(rows: JunkShortCoin[]) {
    const map = new Map(coins.map((c) => [c.symbol, c]));
    for (const r of rows) map.set(r.symbol, r);
    onChange([...map.values()].sort(bySymbol));
  }
}

function AddCoinsDialog({
  coins,
  onClose,
  onAdded,
}: {
  coins: JunkShortCoin[];
  onClose: () => void;
  onAdded: (rows: JunkShortCoin[], rejected: string[]) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parsed = useMemo(() => parseSymbols(raw), [raw]);
  const fresh = parsed.filter((s) => !coins.some((c) => c.symbol === s));

  const submit = async () => {
    if (parsed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.addJunkCoins(parsed);
      onAdded(res.added, res.rejected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thêm coin thất bại.');
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="bg-setup-overlay" onClick={onClose}>
      <div className={`bg-setup-dialog ${styles.dialog}`} role="dialog" aria-modal="true" aria-label="Thêm coin rác" onClick={(e) => e.stopPropagation()}>
        <div className="bg-setup-head">
          <h3>Thêm coin rác</h3>
          <button type="button" className="bg-setup-x" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        <div className="bg-setup-body">
          <label className="bg-setup-field">
            <span>Mã coin</span>
            <textarea
              className={styles.noteInput}
              rows={3}
              value={raw}
              placeholder="ORDI, ATM, PIVX — dấu phẩy hoặc xuống dòng"
              autoFocus
              onChange={(e) => {
                setRaw(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
              }}
            />
          </label>
          <p className="bg-setup-note">
            {parsed.length === 0
              ? 'Không cần gõ đuôi USDT. Chỉ nhận coin có futures USDT-M trên Binance.'
              : `${parsed.length} mã · ${fresh.length} mới${parsed.length > fresh.length ? ` · ${parsed.length - fresh.length} đã có` : ''}`}
          </p>
          {error && <div className="bg-alert bg-alert--error">{error}</div>}
        </div>
        <div className="bg-setup-foot">
          <button type="button" className="bg-setup-cancel" onClick={onClose}>
            Huỷ
          </button>
          <button type="button" className="bg-setup-save" disabled={parsed.length === 0 || busy} onClick={() => void submit()}>
            {busy ? 'Đang thêm…' : `Thêm${fresh.length ? ` ${fresh.length} coin` : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
