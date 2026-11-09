'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { createApiClient } from '@web/shared/api/client';

const api = createApiClient();
const REFRESH_MS = 60_000;
const COLLAPSE_KEY = 'trades.pendingLimit.collapsed';

type Exchange = 'OKX' | 'Bitget' | 'MEXC';

type Row = {
  key: string;
  exchange: Exchange;
  symbol: string;
  /** null = reduce-only close order (OKX net mode). */
  holdSide: 'long' | 'short' | null;
  price: number;
  notionalUsd: number | null;
  marginUsd: number | null;
  leverage: number | null;
  createdAt: string | null;
};

const fmtPrice = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  return n.toLocaleString('en-US', { maximumFractionDigits: abs >= 1000 ? 2 : abs >= 1 ? 4 : 8 });
};
const fmtUsd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '-' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';

/** Last price per symbol: Binance spot, then USDT-M futures for coins only listed there. Missing = not shown. */
async function fetchPrices(symbols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.allSettled(
    symbols.map(async (sym) => {
      for (const url of [`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}`]) {
        try {
          const r = await fetch(url);
          if (!r.ok) continue;
          const d = (await r.json()) as { price?: string };
          if (d.price) {
            out[sym] = Number(d.price);
            return;
          }
        } catch {
          /* try next source */
        }
      }
    }),
  );
  return out;
}

/**
 * "Lệnh limit đang chờ" panel of /trades: resting (unfilled) orders on OKX, Bitget and MEXC,
 * read live from each exchange, sorted by how close they are to filling. Read-only.
 */
export function PendingLimitOrders() {
  const searchParams = useSearchParams();
  const symbolFilter = (searchParams?.get('symbol') ?? '').trim().toUpperCase();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [okx, bitget, mexc] = await Promise.allSettled([api.fetchOkxPendingOrders(), api.fetchBitgetPendingOrders(), api.fetchMexcPendingOrders()]);
    const next: Row[] = [];
    const errs: string[] = [];
    if (okx.status === 'fulfilled') {
      for (const o of okx.value.orders)
        next.push({
          key: `okx:${o.orderId}`,
          exchange: 'OKX',
          symbol: o.symbol,
          holdSide: o.holdSide,
          price: o.price,
          notionalUsd: o.price > 0 ? o.size * o.price : null,
          marginUsd: o.marginUsd,
          leverage: o.leverage,
          createdAt: o.createdAt,
        });
    } else errs.push(`OKX: ${okx.reason instanceof Error ? okx.reason.message : 'lỗi'}`);
    for (const [name, res] of [['Bitget', bitget], ['MEXC', mexc]] as const) {
      if (res.status === 'fulfilled') {
        for (const o of res.value.orders)
          next.push({
            key: `${name}:${o.orderId}`,
            exchange: name,
            symbol: o.symbol,
            holdSide: o.holdSide,
            price: o.price,
            notionalUsd: o.notionalUsd,
            marginUsd: o.marginUsd,
            leverage: o.leverage,
            createdAt: o.createdAt,
          });
      } else errs.push(`${name}: ${res.reason instanceof Error ? res.reason.message : 'lỗi'}`);
    }
    setRows(next);
    setErrors(errs);
    setFetchedAt(new Date());
    setLoading(false);
    const syms = Array.from(new Set(next.map((r) => r.symbol.toUpperCase())));
    if (syms.length) setPrices(await fetchPrices(syms));
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const visible = useMemo(() => {
    const list = (rows ?? []).filter((r) => !symbolFilter || r.symbol.toUpperCase().includes(symbolFilter));
    const dist = (r: Row) => {
      const last = prices[r.symbol.toUpperCase()];
      return last ? Math.abs((r.price - last) / last) : Infinity;
    };
    return list.sort((a, b) => dist(a) - dist(b));
  }, [rows, prices, symbolFilter]);

  const totalMargin = visible.reduce((s, r) => s + (r.marginUsd ?? 0), 0);

  function toggle() {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  }

  return (
    <article className="panel">
      <div className="table-header">
        <div>
          <div className="trades-title-row">
            <h2 style={{ cursor: 'pointer' }} onClick={toggle}>
              {collapsed ? '▸' : '▾'} Lệnh limit đang chờ {rows ? `(${visible.length})` : ''}
            </h2>
          </div>
          <p>
            OKX · Bitget · MEXC — lệnh chưa khớp, sắp theo độ gần giá hiện tại
            {visible.length > 0 ? ` · tổng ký quỹ chờ ${fmtUsd(totalMargin)}` : ''}
            {fetchedAt ? ` · cập nhật ${fetchedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
            {symbolFilter ? ` · lọc "${symbolFilter}"` : ''}
          </p>
        </div>
        <div className="table-actions">
          <button className="btn btn--secondary" onClick={() => void load()} disabled={loading}>
            {loading ? 'Đang tải…' : '↻ Làm mới'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {errors.length > 0 && <p className="tt-muted" style={{ color: '#dc2626', fontSize: '0.8rem' }}>Không đọc được: {errors.join(' · ')}</p>}
          {rows == null ? (
            <p className="tt-muted">Đang tải lệnh chờ…</p>
          ) : visible.length === 0 ? (
            <p className="tt-muted">Không có lệnh limit nào đang chờ.</p>
          ) : (
            <div className="tt-wrap tt-card-wrap">
              <table className="tt tt-card">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Sàn</th>
                    <th>Giá limit</th>
                    <th>Giá hiện tại</th>
                    <th>Cách giá</th>
                    <th>Volume</th>
                    <th>Ký quỹ</th>
                    <th>Đặt lúc</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const last = prices[r.symbol.toUpperCase()];
                    const gap = last ? ((r.price - last) / last) * 100 : null;
                    return (
                      <tr key={r.key}>
                        <td data-label="Name" data-full="">
                          <div className="tt-name">
                            <span className="tt-symbol-btn tt-symbol-btn--readonly">{r.symbol}</span>
                            {r.holdSide ? (
                              <span className={`tt-side tt-side--${r.holdSide}`}>{r.holdSide.toUpperCase()}</span>
                            ) : (
                              <span className="tt-side">ĐÓNG</span>
                            )}
                          </div>
                        </td>
                        <td data-label="Sàn">{r.exchange}</td>
                        <td data-label="Giá limit">{fmtPrice(r.price)}</td>
                        <td data-label="Giá hiện tại">{last ? fmtPrice(last) : <span className="tt-muted">-</span>}</td>
                        <td data-label="Cách giá">
                          {gap == null ? (
                            <span className="tt-muted">-</span>
                          ) : (
                            <span title="Giá limit so với giá hiện tại">
                              {gap > 0 ? '+' : ''}
                              {gap.toFixed(2)}%
                            </span>
                          )}
                        </td>
                        <td data-label="Volume">{fmtUsd(r.notionalUsd)}</td>
                        <td data-label="Ký quỹ">
                          {fmtUsd(r.marginUsd)}
                          {r.leverage ? <span className="tt-muted"> · {r.leverage}×</span> : null}
                        </td>
                        <td data-label="Đặt lúc">{fmtDate(r.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </article>
  );
}
