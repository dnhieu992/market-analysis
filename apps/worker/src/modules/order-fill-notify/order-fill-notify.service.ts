import { Injectable, Logger } from '@nestjs/common';
import { createNotificationRepository } from '@app/db';

import { TelegramService } from '../telegram/telegram.service';
import { BitgetFillSource } from './bitget-fill.source';
import { MexcFillSource } from './mexc-fill.source';
import { formatOrderFill, groupFillsByOrder, summarizeOrderFills, type OrderFillSummary } from './order-fill.format';
import type { FillExchange, FillSource, OrderMeta, PositionSnap, RawFill } from './order-fill.types';

/**
 * Order-fill notifications for /trading-list (Bitget + MEXC futures).
 *
 * Every run (SchedulerService, ~15s) reads each exchange's fills since its cursor (minus an
 * overlap), groups them per order and writes ONE `notifications` row per order
 * (`dedupeKey = <exchange>:<orderId>`), then pushes it to Telegram. Fill ids are kept in the
 * payload, so the overlap never duplicates; an order that fills more later is refreshed
 * (unread again, re-sent as "khớp thêm").
 *
 * The first run on an exchange only anchors the cursor — old fills are never replayed.
 * Covers every fill on the account (orders from the app, the exchange app, TP/SL, liquidation).
 */

export const NOTIFICATION_TYPE_ORDER_FILLED = 'order_filled';
/** Re-read this far behind the cursor: fills can show up in the history a little late. */
const OVERLAP_MS = 5 * 60_000;
/** Never look back further than this after downtime (Bitget caps a fill-history window at 7d). */
const MAX_LOOKBACK_MS = 3 * 24 * 60 * 60_000;
const TELEGRAM_MAX_TRIES = 3;
const TELEGRAM_RETRY_WINDOW_MS = 6 * 60 * 60_000;

/** Compact fill as stored in the payload (enough to re-aggregate when the order fills more). */
type StoredFill = { id: string; p: number; v: number; q: number; pr: number; f: number; t: number };

export type OrderFillPayload = {
  orderId: string;
  side: string | null;
  action: string;
  phase: string | null;
  kind: string | null;
  orderType: string | null;
  price: number;
  size: number;
  quote: number;
  profit: number;
  fee: number;
  position: PositionSnap | null;
  meta: OrderMeta | null;
  revision: number;
  fills: StoredFill[];
  telegram: string;
};

/** The fields of a stored notification row this service reads back. */
type StoredRow = { id: string; dedupeKey: string; title: string; body: string; payload: unknown };

function toStored(f: RawFill): StoredFill {
  return { id: f.id, p: f.price, v: f.size, q: f.quote, pr: f.profit, f: f.fee, t: f.ts };
}

function fromStored(s: StoredFill, base: RawFill): RawFill {
  return { ...base, id: s.id, price: s.p, size: s.v, quote: s.q, profit: s.pr, fee: s.f, ts: s.t };
}

@Injectable()
export class OrderFillNotifyService {
  private readonly logger = new Logger(OrderFillNotifyService.name);
  private readonly repo = createNotificationRepository();
  private sources: FillSource[] = [new BitgetFillSource(), new MexcFillSource()];
  private readonly running = new Set<FillExchange>();
  private retrying = false;

  constructor(private readonly telegram: TelegramService) {}

  private get chatId(): string {
    return process.env.TELEGRAM_NOTIFY_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';
  }

  /** Sync every configured exchange independently — one failing never blocks the other. */
  async syncAll(): Promise<void> {
    await Promise.all(
      this.sources.map((src) =>
        this.syncExchange(src).catch((err) =>
          this.logger.warn(`Order-fill sync ${src.exchange} failed: ${err instanceof Error ? err.message : String(err)}`),
        ),
      ),
    );
  }

  async syncExchange(source: FillSource, now = Date.now()): Promise<{ created: number; updated: number }> {
    const result = { created: 0, updated: 0 };
    if (!source.isConfigured() || this.running.has(source.exchange)) return result;
    this.running.add(source.exchange);
    try {
      const cursorKey = `order_fill:${source.exchange}`;
      const cursor = await this.repo.getCursor(cursorKey);
      if (!cursor) {
        await this.repo.setCursor(cursorKey, new Date(now));
        this.logger.log(`Order-fill watcher ${source.exchange}: anchored at ${new Date(now).toISOString()} (no replay)`);
        return result;
      }

      const since = Math.max(cursor.getTime() - OVERLAP_MS, now - MAX_LOOKBACK_MS);
      const groups = groupFillsByOrder(await source.fetchFills(since, now));
      if (groups.size > 0) {
        const keyOf = (orderId: string) => `${source.exchange}:${orderId}`;
        const rows: StoredRow[] = await this.repo.findByDedupeKeys([...groups.keys()].map(keyOf));
        const existing = new Map(rows.map((r) => [r.dedupeKey, r]));

        // Orders with at least one fill not yet recorded.
        const pending: Array<{ orderId: string; fills: RawFill[]; prev: StoredRow | undefined }> = [];
        for (const [orderId, fills] of groups) {
          const prev = existing.get(keyOf(orderId));
          const known = new Set(((prev?.payload as OrderFillPayload | null)?.fills ?? []).map((f) => f.id));
          if (fills.some((f) => !known.has(f.id))) pending.push({ orderId, fills, prev });
        }

        if (pending.length > 0) {
          const positions = await source.fetchPositions();
          for (const { orderId, fills, prev } of pending) {
            const base = fills[0];
            if (!base) continue;
            const prevPayload = (prev?.payload as OrderFillPayload | null) ?? null;
            const merged = new Map<string, RawFill>();
            for (const s of prevPayload?.fills ?? []) merged.set(s.id, fromStored(s, base));
            for (const f of fills) merged.set(f.id, f);
            const allFills = [...merged.values()].sort((a, b) => a.ts - b.ts);

            const meta =
              prevPayload?.meta ??
              (await source.fetchOrderMeta(base.symbol, orderId).catch((err) => {
                this.logger.debug(`Order meta ${source.exchange}:${orderId} failed: ${(err as Error).message}`);
                return null;
              }));
            const summary = summarizeOrderFills(source.exchange, allFills, meta, positions);
            const revision = (prevPayload?.revision ?? 0) + 1;
            const content = formatOrderFill(summary, revision);
            const payload = this.payloadOf(summary, meta, revision, allFills, content.telegram);

            let rowId: string;
            if (prev) {
              rowId = (await this.repo.refresh(prev.id, { title: content.title, body: content.body, payload, eventAt: new Date(summary.lastTs) })).id;
              result.updated++;
            } else {
              const row = await this.repo
                .create({
                  type: NOTIFICATION_TYPE_ORDER_FILLED,
                  dedupeKey: keyOf(orderId),
                  exchange: source.exchange,
                  symbol: summary.symbol,
                  title: content.title,
                  body: content.body,
                  payload,
                  eventAt: new Date(summary.lastTs),
                })
                .catch((err) => {
                  // Unique-key race with a concurrent writer: the other one owns it.
                  this.logger.warn(`Notification create ${keyOf(orderId)} failed: ${(err as Error).message}`);
                  return null;
                });
              if (!row) continue;
              rowId = row.id;
              result.created++;
            }
            await this.deliver(rowId, content.telegram);
          }
          this.logger.log(`Order-fill ${source.exchange}: ${result.created} new, ${result.updated} updated`);
        }
      }

      await this.repo.setCursor(cursorKey, new Date(now));
      return result;
    } finally {
      this.running.delete(source.exchange);
    }
  }

  /** Re-send notifications whose Telegram push failed (or was never attempted). */
  async retryTelegram(now = Date.now()): Promise<void> {
    if (this.retrying) return;
    this.retrying = true;
    try {
      const rows = await this.repo.listTelegramPending(
        TELEGRAM_MAX_TRIES,
        new Date(now - TELEGRAM_RETRY_WINDOW_MS),
        new Date(now - 2 * 60_000),
      );
      for (const row of rows) {
        const text = (row.payload as OrderFillPayload | null)?.telegram ?? `${row.title}\n${row.body}`;
        await this.deliver(row.id, text);
      }
    } finally {
      this.retrying = false;
    }
  }

  private async deliver(id: string, text: string): Promise<void> {
    if (!this.chatId) {
      await this.repo.markTelegram(id, { sent: false, error: 'TELEGRAM_CHAT_ID not set' });
      return;
    }
    const res = await this.telegram.sendToChat(this.chatId, text).catch(() => ({ success: false }));
    await this.repo.markTelegram(id, { sent: res.success, error: res.success ? null : 'telegram send failed' });
  }

  private payloadOf(
    s: OrderFillSummary,
    meta: OrderMeta | null,
    revision: number,
    fills: RawFill[],
    telegram: string,
  ): OrderFillPayload {
    return {
      orderId: s.orderId,
      side: s.side,
      action: s.action,
      phase: s.phase,
      kind: s.kind ?? null,
      orderType: s.orderType,
      price: s.avgPrice,
      size: s.size,
      quote: s.quote,
      profit: s.profit,
      fee: s.fee,
      position: s.position,
      meta,
      revision,
      fills: fills.map(toStored),
      telegram,
    };
  }
}
