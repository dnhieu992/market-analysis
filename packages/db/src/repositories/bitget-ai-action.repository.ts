import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type BitgetAiActionInput = Pick<
  Prisma.BitgetAiActionUncheckedCreateInput,
  'conversationId' | 'type' | 'symbol' | 'holdSide' | 'params' | 'reason'
>;

export function createBitgetAiActionRepository(client = prisma) {
  return {
    create(data: BitgetAiActionInput) {
      return client.bitgetAiAction.create({ data });
    },

    findById(id: string) {
      return client.bitgetAiAction.findUnique({ where: { id } });
    },

    listByConversation(conversationId: string) {
      return client.bitgetAiAction.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
    },

    /** Latest cards across conversations — the AI reads these to know what it already proposed. */
    listRecent(conversationId: string, take = 15) {
      return client.bitgetAiAction.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take });
    },

    /** Cards proposed while generating a reply (created since `since`) get the reply's id once it is saved. */
    attachToMessage(conversationId: string, messageId: string, since: Date) {
      return client.bitgetAiAction.updateMany({
        where: { conversationId, messageId: null, createdAt: { gte: since } },
        data: { messageId },
      });
    },

    update(id: string, data: Prisma.BitgetAiActionUncheckedUpdateInput) {
      return client.bitgetAiAction.update({ where: { id }, data });
    },
  };
}
