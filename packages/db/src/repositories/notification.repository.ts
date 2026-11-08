import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type NotificationInput = {
  type: string;
  dedupeKey: string;
  exchange?: string | null;
  symbol?: string | null;
  title: string;
  body: string;
  /** JSON-serialisable object (stored as-is). */
  payload?: unknown;
  eventAt: Date;
};

export type NotificationListQuery = {
  /** id of the last row of the previous page (rows are newest-first). */
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
  exchange?: string;
  type?: string;
};

/** In-app notifications (bell + /notifications) and the watchers' cursors. */
export function createNotificationRepository(client = prisma) {
  return {
    findByDedupeKeys(keys: string[]) {
      if (keys.length === 0) return Promise.resolve([]);
      return client.notification.findMany({ where: { dedupeKey: { in: keys } } });
    },

    create(input: NotificationInput) {
      return client.notification.create({
        data: {
          ...input,
          exchange: input.exchange ?? null,
          symbol: input.symbol ?? null,
          payload: input.payload as Prisma.InputJsonValue | undefined,
        },
      });
    },

    /**
     * Replace a notification's content (e.g. an order that filled more since it was written):
     * it becomes unread again and is queued for Telegram again.
     */
    refresh(id: string, input: Pick<NotificationInput, 'title' | 'body' | 'payload' | 'eventAt'>) {
      return client.notification.update({
        where: { id },
        data: {
          ...input,
          payload: input.payload as Prisma.InputJsonValue | undefined,
          readAt: null,
          telegramSent: false,
          telegramTries: 0,
          telegramError: null,
        },
      });
    },

    markTelegram(id: string, result: { sent: boolean; error?: string | null }) {
      return client.notification.update({
        where: { id },
        data: {
          telegramSent: result.sent,
          telegramTries: { increment: 1 },
          telegramError: result.sent ? null : (result.error ?? 'send failed').slice(0, 300),
        },
      });
    },

    /**
     * Rows still waiting for Telegram, oldest first: a failed send (tries ≥ 1), or a row never
     * attempted that is older than `staleBefore` (the writer died before sending). Fresh rows
     * with no attempt are left to the writer so a message is never sent twice.
     */
    listTelegramPending(maxTries: number, since: Date, staleBefore: Date, take = 20) {
      return client.notification.findMany({
        where: {
          telegramSent: false,
          telegramTries: { lt: maxTries },
          createdAt: { gte: since },
          OR: [{ telegramTries: { gte: 1 } }, { updatedAt: { lt: staleBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        take,
      });
    },

    async list(query: NotificationListQuery = {}) {
      const take = Math.min(Math.max(query.limit ?? 30, 1), 100);
      const where: Prisma.NotificationWhereInput = {
        ...(query.unreadOnly ? { readAt: null } : {}),
        ...(query.exchange ? { exchange: query.exchange } : {}),
        ...(query.type ? { type: query.type } : {}),
      };
      const rows = await client.notification.findMany({
        where,
        orderBy: [{ eventAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > take;
      const items = hasMore ? rows.slice(0, take) : rows;
      return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
    },

    unreadCount() {
      return client.notification.count({ where: { readAt: null } });
    },

    async markRead(id: string) {
      const res = await client.notification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });
      return res.count;
    },

    async markAllRead() {
      const res = await client.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
      return res.count;
    },

    async getCursor(id: string): Promise<Date | null> {
      const row = await client.notificationSyncState.findUnique({ where: { id } });
      return row?.cursorAt ?? null;
    },

    async setCursor(id: string, cursorAt: Date): Promise<void> {
      await client.notificationSyncState.upsert({ where: { id }, create: { id, cursorAt }, update: { cursorAt } });
    },
  };
}
