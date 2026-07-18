'use client';

import { useEffect, useState } from 'react';

/**
 * Public Bitget V2 WebSocket — ticker channel, no auth required, no CORS on WS.
 * We subscribe to the mark price of each open symbol and push updates client-side
 * between the authoritative 15s REST refreshes so the table tracks price live.
 */
const WS_URL = 'wss://ws.bitget.com/v2/ws/public';
const PING_MS = 20_000;
const RECONNECT_MS = 3_000;

export type LivePriceMap = Record<string, number>;

type TickerMessage = {
  arg?: { channel?: string };
  data?: Array<{ instId?: string; markPrice?: string; lastPr?: string }>;
};

export function useBitgetLivePrices(symbols: string[]): { prices: LivePriceMap; live: boolean } {
  const [prices, setPrices] = useState<LivePriceMap>({});
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
            args: subs.map((instId) => ({ instType: 'USDT-FUTURES', channel: 'ticker', instId })),
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
        if (msg.arg?.channel !== 'ticker' || !Array.isArray(msg.data)) return;
        setPrices((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const d of msg.data ?? []) {
            const px = Number(d.markPrice ?? d.lastPr);
            if (d.instId && Number.isFinite(px) && next[d.instId] !== px) {
              next[d.instId] = px;
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

  return { prices, live };
}
