import { Injectable } from '@nestjs/common';
import { createNotificationRepository } from '@app/db';

export type NotificationListParams = {
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
  exchange?: string;
};

/** In-app notifications written by the worker (order fills on Bitget/MEXC for /trading-list). */
@Injectable()
export class NotificationsService {
  private readonly repo = createNotificationRepository();

  async list(params: NotificationListParams) {
    const page = await this.repo.list(params);
    return {
      items: page.items.map((r) => ({
        id: r.id,
        type: r.type,
        exchange: r.exchange,
        symbol: r.symbol,
        title: r.title,
        body: r.body,
        payload: this.publicPayload(r.payload),
        eventAt: r.eventAt.toISOString(),
        readAt: r.readAt?.toISOString() ?? null,
        telegramSent: r.telegramSent,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async unreadCount() {
    return { count: await this.repo.unreadCount() };
  }

  async markRead(id: string) {
    return { updated: await this.repo.markRead(id) };
  }

  async markAllRead() {
    return { updated: await this.repo.markAllRead() };
  }

  /** Drop the bulky fill list + Telegram text from what the web gets. */
  private publicPayload(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== 'object') return null;
    const rest: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
    const fills = rest.fills;
    delete rest.fills;
    delete rest.telegram;
    delete rest.meta;
    return { ...rest, fillCount: Array.isArray(fills) ? fills.length : 0 };
  }
}
