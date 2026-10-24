import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

/** Statuses of a setup that is still alive (shown as "active" on the page and to chat skills). */
export const TRACKING_ACTIVE_STATUSES = ['PROPOSED', 'WATCHING', 'PENDING', 'OPEN'] as const;

export function createTrackingSetupRepository(client = prisma) {
  return {
    create(data: Prisma.TrackingSetupUncheckedCreateInput) {
      return client.trackingSetup.create({ data });
    },

    findById(id: string) {
      return client.trackingSetup.findUnique({ where: { id } });
    },

    update(id: string, data: Prisma.TrackingSetupUncheckedUpdateInput) {
      return client.trackingSetup.update({ where: { id }, data });
    },

    /**
     * Writes only if the row hasn't changed since it was read (the monitor and a manual action
     * must not overwrite each other). Returns false when someone else got there first.
     */
    async updateIfUnchanged(id: string, readAt: Date, data: Prisma.TrackingSetupUncheckedUpdateInput): Promise<boolean> {
      const res = await client.trackingSetup.updateMany({ where: { id, updatedAt: readAt }, data });
      return res.count === 1;
    },

    /** Newest first; narrowed to a coin and/or statuses when given. */
    list(filter: { symbol?: string; statuses?: readonly string[] } = {}, take = 500) {
      return client.trackingSetup.findMany({
        where: {
          ...(filter.symbol ? { symbol: filter.symbol } : {}),
          ...(filter.statuses ? { status: { in: [...filter.statuses] } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
    },

    listByConversation(conversationId: string) {
      return client.trackingSetup.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
    },

    /** Setups proposed while generating a reply (created since `since`) get the reply's id once it is saved. */
    attachToMessage(conversationId: string, messageId: string, since: Date) {
      return client.trackingSetup.updateMany({
        where: { conversationId, messageId: null, createdAt: { gte: since } },
        data: { messageId },
      });
    },

    /** Closed setups oldest first by close time — the order lesson batches are cut in. */
    listClosed() {
      return client.trackingSetup.findMany({ where: { status: 'CLOSED' }, orderBy: { closedAt: 'asc' } });
    },

    assignLessonBatch(ids: string[], batchId: string) {
      return client.trackingSetup.updateMany({ where: { id: { in: ids } }, data: { lessonBatchId: batchId } });
    },

    // ── Timeline ─────────────────────────────────────────────────────────

    addEvent(data: Prisma.TrackingSetupEventUncheckedCreateInput) {
      return client.trackingSetupEvent.create({ data });
    },

    updateEvent(id: string, data: Prisma.TrackingSetupEventUncheckedUpdateInput) {
      return client.trackingSetupEvent.update({ where: { id }, data });
    },

    deleteEvent(id: string) {
      return client.trackingSetupEvent.delete({ where: { id } });
    },

    findEvent(id: string) {
      return client.trackingSetupEvent.findUnique({ where: { id } });
    },

    /** Newest first. */
    listEvents(filter: { symbol?: string; setupId?: string }, take = 300) {
      return client.trackingSetupEvent.findMany({
        where: { ...(filter.symbol ? { symbol: filter.symbol } : {}), ...(filter.setupId ? { setupId: filter.setupId } : {}) },
        // Events written in the same millisecond keep their write order (cuid ids grow).
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
    },

    // ── Lessons ──────────────────────────────────────────────────────────

    listLessonBatches() {
      return client.trackingLessonBatch.findMany({ orderBy: { createdAt: 'desc' } });
    },

    findLessonBatch(id: string) {
      return client.trackingLessonBatch.findUnique({ where: { id } });
    },

    createLessonBatch(data: Prisma.TrackingLessonBatchUncheckedCreateInput) {
      return client.trackingLessonBatch.create({ data });
    },

    updateLessonBatch(id: string, data: Prisma.TrackingLessonBatchUncheckedUpdateInput) {
      return client.trackingLessonBatch.update({ where: { id }, data });
    },

    approvedLessons() {
      return client.trackingLessonBatch.findMany({ where: { status: 'APPROVED' }, orderBy: { approvedAt: 'desc' } });
    },

    // ── Config ───────────────────────────────────────────────────────────

    async getConfig() {
      return (
        (await client.trackingTradeConfig.findUnique({ where: { id: 'singleton' } })) ??
        client.trackingTradeConfig.create({ data: { id: 'singleton' } })
      );
    },

    updateConfig(data: { riskUsd: number }) {
      return client.trackingTradeConfig.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
    },
  };
}
