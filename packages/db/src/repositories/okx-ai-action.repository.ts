import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type OkxAiActionInput = Pick<
  Prisma.OkxAiActionUncheckedCreateInput,
  'conversationId' | 'type' | 'symbol' | 'holdSide' | 'params' | 'reason'
>;

export function createOkxAiActionRepository(client = prisma) {
  return {
    create(data: OkxAiActionInput) {
      return client.okxAiAction.create({ data });
    },

    findById(id: string) {
      return client.okxAiAction.findUnique({ where: { id } });
    },

    listByConversation(conversationId: string) {
      return client.okxAiAction.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
    },

    /** Latest cards across conversations — the AI reads these to know what it already proposed. */
    listRecent(conversationId: string, take = 15) {
      return client.okxAiAction.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take });
    },

    /** Cards proposed while generating a reply (created since `since`) get the reply's id once it is saved. */
    attachToMessage(conversationId: string, messageId: string, since: Date) {
      return client.okxAiAction.updateMany({
        where: { conversationId, messageId: null, createdAt: { gte: since } },
        data: { messageId },
      });
    },

    update(id: string, data: Prisma.OkxAiActionUncheckedUpdateInput) {
      return client.okxAiAction.update({ where: { id }, data });
    },
  };
}
