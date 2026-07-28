'use client';

import { useEffect, useState } from 'react';

/**
 * Public MEXC contract WebSocket — ticker channel, no auth required, no CORS on
 * WS. We subscribe to each open symbol and push updates client-side between the
 * authoritative 15s REST refreshes so the table tracks price live.
 *
 * Protocol differences from the Bitget hook this mirrors:
 *  - One `sub.ticker` message PER symbol (there is no batched arg list).
 *  - Symbols on the wire are `BTC_USDT`; the app speaks `BTCUSDT`, so the
 *    conversion happens at this boundary and the returned maps are keyed by the
 *    app format.
 *  - Keep-alive is a JSON `{"method":"ping"}` (a bare "ping" string is ignored),
 *    and MEXC drops the socket after ~60s without one.
 *  - There is no UTC-open field: the change comes from `riseFallRate`, already a
 *    ratio, so the Setup tab's change column reads as a rolling 24h move rather
 *    than a since-00:00 one.
 */
const WS_URL = 'wss://contract.mexc.com/edge';
const PING_MS = 20_000;
const RECONNECT_MS = 3_000;

export type LivePriceMap = Record<string, number>;

type TickerMessage = {
  channel?: string;
  symbol?: string;
  data?: {
    symbol?: string;
    lastPrice?: number;
    fairPrice?: number;
    riseFallRate?: number;
  };
};

/** App symbol (`BTCUSDT`) → MEXC contract symbol (`BTC_USDT`). */
function toMexcSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes('_')) return s;
  return s.endsWith('USDT') ? `${s.slice(0, -4)}_USDT` : s;
}

/** MEXC contract symbol (`BTC_USDT`) → app symbol (`BTCUSDT`). */
function fromMexcSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace('_', '');
}

/**
 * @returns `prices` — latest fair/last price per symbol.
 *          `changes` — 24h price change as a ratio (0.0123 = +1.23%) per symbol.
 *          `live` — whether the WS is currently connected.
 */
export function useMexcLivePrices(symbols: string[]): {
  prices: LivePriceMap;
  changes: LivePriceMap;
  live: boolean;
} {
  const [prices, setPrices] = useState<LivePriceMap>({});
  const [changes, setChanges] = useState<LivePriceMap>({});
  const [live, setLive] = useState(false);
  // Stable dependency: reconnect only when the set of symbols actually changes.
  const key = Array.from(new Set(symbols)).sort().join(',');

  useEffect(() => {
    const subs = key ? key.split(',') : [];
    if (subs.length === 0) {
      setLive(false);
      return;
    }

    let ws: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const clearTimers = () => {
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      pingTimer = null;
      reconnectTimer = null;
    };

    const connect = () => {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setLive(true);
        for (const symbol of subs) {
          ws?.send(JSON.stringify({ method: 'sub.ticker', param: { symbol: toMexcSymbol(symbol) } }));
        }
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: 'ping' }));
        }, PING_MS);
      };

      ws.onmessage = (ev) => {
        let msg: TickerMessage;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        // `pong` and subscription acks arrive on the same socket — ignore them.
        if (msg.channel !== 'push.ticker' || !msg.data) return;
        const wireSymbol = msg.data.symbol ?? msg.symbol;
        if (!wireSymbol) return;
        const symbol = fromMexcSymbol(wireSymbol);

        const px = Number(msg.data.fairPrice ?? msg.data.lastPrice);
        if (Number.isFinite(px)) {
          setPrices((prev) => (prev[symbol] === px ? prev : { ...prev, [symbol]: px }));
        }
        const ratio = Number(msg.data.riseFallRate);
        if (Number.isFinite(ratio)) {
          setChanges((prev) => (prev[symbol] === ratio ? prev : { ...prev, [symbol]: ratio }));
        }
      };

      ws.onclose = () => {
        setLive(false);
        clearTimers();
        if (!disposed) reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimers();
      ws?.close();
    };
  }, [key]);

  return { prices, changes, live };
}
