'use client';

import { useEffect, useState } from 'react';

/**
 * Public OKX V5 WebSocket — `tickers` channel, no auth required, no CORS on WS.
 * We subscribe to each open symbol and push updates client-side between the
 * authoritative 15s REST refreshes so the table tracks price live.
 *
 * Protocol differences from the Bitget/MEXC hooks this mirrors:
 *  - One batched `subscribe` message with an `args` array of
 *    `{ channel: 'tickers', instId }`, like Bitget (MEXC needs one per symbol).
 *  - Instruments on the wire are `BTC-USDT-SWAP`; the app speaks `BTCUSDT`, so
 *    the conversion happens at this boundary and the returned maps are keyed by
 *    the app format.
 *  - Keep-alive is the bare string `ping` (OKX replies `pong`), and OKX drops the
 *    socket after 30s of silence.
 *  - The ticker carries `sodUtc0` (the 00:00-UTC open), so — unlike MEXC — the
 *    Setup tab's change column is a true since-midnight move, the same as Bitget.
 *    `open24h` is the rolling-24h fallback when `sodUtc0` is missing.
 */
const WS_URL = 'wss://ws.okx.com:8443/ws/v5/public';
const PING_MS = 20_000;
const RECONNECT_MS = 3_000;

export type LivePriceMap = Record<string, number>;

type TickerMessage = {
  arg?: { channel?: string };
  data?: Array<{
    instId?: string;
    last?: string;
    sodUtc0?: string;
    open24h?: string;
  }>;
};

/** App symbol (`BTCUSDT`) → OKX instrument id (`BTC-USDT-SWAP`). */
function toOkxInstId(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes('-')) return s.endsWith('-SWAP') ? s : `${s}-SWAP`;
  const base = s.endsWith('USDT') ? s.slice(0, -4) : s;
  return `${base}-USDT-SWAP`;
}

/** OKX instrument id (`BTC-USDT-SWAP`) → app symbol (`BTCUSDT`). */
function fromOkxInstId(instId: string): string {
  const parts = instId.trim().toUpperCase().split('-');
  if (parts.length < 2) return instId.trim().toUpperCase();
  return `${parts[0]}${parts[1]}`;
}

/**
 * @returns `prices` — latest traded price per symbol.
 *          `changes` — price change since 00:00 UTC as a ratio (0.0123 = +1.23%) per symbol.
 *          `live` — whether the WS is currently connected.
 */
export function useOkxLivePrices(symbols: string[]): {
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
        ws?.send(
          JSON.stringify({
            op: 'subscribe',
            args: subs.map((symbol) => ({ channel: 'tickers', instId: toOkxInstId(symbol) })),
          }),
        );
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send('ping');
        }, PING_MS);
      };

      ws.onmessage = (ev) => {
        if (ev.data === 'pong') return;
        let msg: TickerMessage;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        // Subscription acks and error frames arrive on the same socket — ignore them.
        if (msg.arg?.channel !== 'tickers' || !Array.isArray(msg.data)) return;

        setPrices((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const d of msg.data ?? []) {
            const px = Number(d.last);
            const symbol = d.instId ? fromOkxInstId(d.instId) : '';
            if (symbol && Number.isFinite(px) && next[symbol] !== px) {
              next[symbol] = px;
              changed = true;
            }
          }
          return changed ? next : prev;
        });

        setChanges((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const d of msg.data ?? []) {
            const symbol = d.instId ? fromOkxInstId(d.instId) : '';
            const last = Number(d.last);
            // Change since 00:00 UTC; fall back to the rolling 24h open when OKX
            // omits `sodUtc0` (it is blank on a freshly-listed instrument).
            const open = Number(d.sodUtc0) || Number(d.open24h);
            const ratio =
              Number.isFinite(last) && Number.isFinite(open) && open > 0 ? (last - open) / open : NaN;
            if (symbol && Number.isFinite(ratio) && next[symbol] !== ratio) {
              next[symbol] = ratio;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
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
