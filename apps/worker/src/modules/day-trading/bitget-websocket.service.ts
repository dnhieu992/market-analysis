import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/**
 * PHASE 1 — Public WebSocket, no Bitget account required.
 *
 * Maintains a persistent connection to Bitget's PUBLIC futures WebSocket and:
 *   - streams real-time BTCUSDT price (ticker channel) → cached for result monitoring
 *   - detects 15m candle close (candle15m channel) → emits 'candleClose' to trigger a scan
 *
 * No API key is used here — only public market data. Authenticated order placement
 * belongs to PHASE 2 (separate service, gated behind account credentials).
 */

const WS_URL = 'wss://ws.bitget.com/v2/ws/public';
const SYMBOL = 'BTCUSDT';
const INST_TYPE = 'USDT-FUTURES';
const PING_INTERVAL_MS = 25_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const STALE_THRESHOLD_MS = 60_000;

type BitgetWsMessage = {
  event?: string;
  action?: 'snapshot' | 'update';
  arg?: { instType: string; channel: string; instId: string };
  data?: unknown;
  code?: number;
  msg?: string;
};

@Injectable()
export class BitgetWebSocketService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BitgetWebSocketService.name);
  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private closing = false;

  private latestPrice: number | null = null;
  private lastMessageAt = 0;
  private lastCandleTs = 0;

  onModuleInit(): void {
    this.connect();
  }

  onModuleDestroy(): void {
    this.closing = true;
    this.clearTimers();
    this.ws?.close();
  }

  /** Latest real-time price from the ticker stream, or null if not yet received. */
  getLatestPrice(): number | null {
    return this.latestPrice;
  }

  /** True if the WS has delivered a message within the staleness window. */
  isHealthy(): boolean {
    return this.lastMessageAt > 0 && Date.now() - this.lastMessageAt < STALE_THRESHOLD_MS;
  }

  private connect(): void {
    if (this.closing) return;
    this.logger.log(`Connecting to Bitget public WS (attempt ${this.reconnectAttempts + 1})`);

    try {
      this.ws = new WebSocket(WS_URL);
    } catch (err) {
      this.logger.error(`WS construction failed: ${err instanceof Error ? err.message : String(err)}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.logger.log('Bitget WS connected — subscribing to ticker + candle15m');
      this.reconnectAttempts = 0;
      this.subscribe();
      this.startPing();
    };

    this.ws.onmessage = (event) => this.handleMessage(event.data);

    this.ws.onerror = () => {
      this.logger.warn('Bitget WS error');
    };

    this.ws.onclose = () => {
      this.logger.warn('Bitget WS closed');
      this.clearTimers();
      this.scheduleReconnect();
    };
  }

  private subscribe(): void {
    const msg = {
      op: 'subscribe',
      args: [
        { instType: INST_TYPE, channel: 'ticker', instId: SYMBOL },
        { instType: INST_TYPE, channel: 'candle15m', instId: SYMBOL },
      ],
    };
    this.ws?.send(JSON.stringify(msg));
  }

  private startPing(): void {
    this.clearPing();
    // Bitget requires a literal "ping" string; server replies "pong".
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, PING_INTERVAL_MS);
  }

  private handleMessage(raw: unknown): void {
    this.lastMessageAt = Date.now();
    const text = typeof raw === 'string' ? raw : String(raw);
    if (text === 'pong') return;

    let msg: BitgetWsMessage;
    try {
      msg = JSON.parse(text) as BitgetWsMessage;
    } catch {
      return;
    }

    if (msg.event === 'subscribe') {
      this.logger.log(`Subscribed: ${msg.arg?.channel}`);
      return;
    }
    if (msg.event === 'error') {
      this.logger.warn(`WS error event: code=${msg.code} msg=${msg.msg}`);
      return;
    }

    const channel = msg.arg?.channel;
    if (channel === 'ticker') {
      this.handleTicker(msg.data);
    } else if (channel === 'candle15m') {
      this.handleCandle(msg.data);
    }
  }

  private handleTicker(data: unknown): void {
    if (!Array.isArray(data) || data.length === 0) return;
    const row = data[0] as { lastPr?: string };
    if (row?.lastPr) {
      const price = parseFloat(row.lastPr);
      if (Number.isFinite(price)) this.latestPrice = price;
    }
  }

  private handleCandle(data: unknown): void {
    if (!Array.isArray(data) || data.length === 0) return;
    // Each row: [ts, open, high, low, close, baseVol, quoteVol] (strings).
    // The last row is the forming candle. When its ts advances past the one we
    // last saw, the previous 15m candle has CLOSED → trigger a scan.
    const rows = data as string[][];
    const lastRow = rows[rows.length - 1];
    if (!lastRow || lastRow[0] == null) return;
    const ts = Number(lastRow[0]);
    if (!Number.isFinite(ts)) return;

    if (this.lastCandleTs === 0) {
      this.lastCandleTs = ts;
      return;
    }
    if (ts > this.lastCandleTs) {
      const closedTs = this.lastCandleTs;
      this.lastCandleTs = ts;
      this.logger.log(`15m candle closed @ ${new Date(closedTs).toISOString()} — emitting candleClose`);
      this.emit('candleClose', closedTs);
    }
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
