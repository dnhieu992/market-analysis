'use client';

import { useEffect, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';

/**
 * BTC/USDT price tile that sits next to the account tiles on /bitget and /mexc.
 *
 * The price itself comes from the page's own exchange WebSocket (passed in as a
 * prop) so there is no extra socket per page. Only the 1h reference is fetched
 * here: 61 one-minute candles from the Binance proxy on our API, whose first
 * candle opened exactly 60 minutes ago. That makes the % a **rolling** 1h move
 * (price now vs price 60 minutes ago), not the change since the hour opened.
 * The proxy is used rather than a direct api.binance.com call so the tile keeps
 * working from regions where Binance blocks browser requests.
 */
const REF_REFRESH_MS = 60_000;
/** 61 one-minute candles: the first one opened exactly 60 minutes ago. */
const REF_KLINE_LIMIT = 61;
const SYMBOL = 'BTCUSDT';

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
}

function pnlClass(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n > 0) return 'bg-pnl--up';
  if (n < 0) return 'bg-pnl--down';
  return '';
}

type BtcPriceTileProps = {
  /** Live price from the page's exchange WS. Null until the first tick lands. */
  priceUsd: number | null;
};

export function BtcPriceTile({ priceUsd }: BtcPriceTileProps) {
  // Price 60 minutes ago, and the last kline close as a stand-in while the WS
  // has not delivered a tick yet (or is reconnecting).
  const [refPrice, setRefPrice] = useState<number | null>(null);
  const [klinePrice, setKlinePrice] = useState<number | null>(null);

  useEffect(() => {
    let disposed = false;
    const api = createApiClient();

    const load = async () => {
      try {
        const rows = await api.fetchCoinKlines(SYMBOL, '1m', REF_KLINE_LIMIT);
        const first = rows[0];
        const last = rows[rows.length - 1];
        if (disposed || !first || !last) return;
        const open = Number(first[1]);
        const close = Number(last[4]);
        if (Number.isFinite(open) && open > 0) setRefPrice(open);
        if (Number.isFinite(close) && close > 0) setKlinePrice(close);
      } catch {
        // Non-fatal, like every other fetch on these pages: keep the last good
        // reference and show "—" if there has never been one.
      }
    };

    void load();
    const id = setInterval(() => void load(), REF_REFRESH_MS);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, []);

  const price = priceUsd != null && Number.isFinite(priceUsd) ? priceUsd : klinePrice;
  const changePct =
    price != null && refPrice != null && refPrice > 0 ? ((price - refPrice) / refPrice) * 100 : null;

  // Flash the value green/red on each tick, same as the live-price table cell.
  const prevPrice = useRef<number | null>(null);
  const [flash, setFlash] = useState<'' | 'bg-tick--up' | 'bg-tick--down'>('');
  useEffect(() => {
    const prev = prevPrice.current;
    if (price == null || !Number.isFinite(price)) return;
    prevPrice.current = price;
    if (prev == null || price === prev) return;
    setFlash(price > prev ? 'bg-tick--up' : 'bg-tick--down');
    const id = setTimeout(() => setFlash(''), 500);
    return () => clearTimeout(id);
  }, [price]);

  return (
    <div className="bg-tile">
      <span className="bg-tile-label">Giá BTC</span>
      <span className={`bg-tile-value bg-tile-price ${flash}`}>{fmtPrice(price)}</span>
      <span className={`bg-tile-change ${pnlClass(changePct)}`}>
        {fmtPct(changePct)} <span className="bg-tile-change-note">trong 1h</span>
      </span>
    </div>
  );
}
