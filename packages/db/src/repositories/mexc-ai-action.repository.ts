import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type MexcAiActionInput = Pick<
  Prisma.MexcAiActionUncheckedCreateInput,
  'conversationId' | 'type' | 'symbol' | 'holdSide' | 'params' | 'reason'
>;

export function createMexcAiActionRepository(client = prisma) {
  return {
    create(data: MexcAiActionInput) {
      return client.mexcAiAction.create({ data });
    },

    findById(id: string) {
      return client.mexcAiAction.findUnique({ where: { id } });
    },

    listByConversation(conversationId: string) {
      return client.mexcAiAction.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
    },

    /** Latest cards across conversations — the AI reads these to know what it already proposed. */
    listRecent(conversationId: string, take = 15) {
      return client.mexcAiAction.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take });
    },

    /** Cards proposed while generating a reply (created since `since`) get the reply's id once it is saved. */
    attachToMessage(conversationId: string, messageId: string, since: Date) {
      return client.mexcAiAction.updateMany({
        where: { conversationId, messageId: null, createdAt: { gte: since } },
        data: { messageId },
      });
    },

    update(id: string, data: Prisma.MexcAiActionUncheckedUpdateInput) {
      return client.mexcAiAction.update({ where: { id }, data });
    },
  };
}
