import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type SkillTradeSetupInput = Pick<
  Prisma.SkillTradeSetupUncheckedCreateInput,
  | 'conversationId'
  | 'skillId'
  | 'symbol'
  | 'direction'
  | 'orderType'
  | 'entryPrice'
  | 'stopLoss'
  | 'takeProfit1'
  | 'takeProfit2'
  | 'setupType'
  | 'confidence'
  | 'note'
>;

export function createSkillTradeSetupRepository(client = prisma) {
  return {
    create(data: SkillTradeSetupInput) {
      return client.skillTradeSetup.create({ data });
    },

    findById(id: string) {
      return client.skillTradeSetup.findUnique({ where: { id } });
    },

    findByPaperTradeId(paperTradeId: string) {
      return client.skillTradeSetup.findFirst({ where: { paperTradeId } });
    },

    listByConversation(conversationId: string) {
      return client.skillTradeSetup.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
    },

    /** Setups proposed while generating a reply (created since `since`) get the reply's id once it is saved. */
    attachToMessage(conversationId: string, messageId: string, since: Date) {
      return client.skillTradeSetup.updateMany({
        where: { conversationId, messageId: null, createdAt: { gte: since } },
        data: { messageId },
      });
    },

    update(id: string, data: Prisma.SkillTradeSetupUncheckedUpdateInput) {
      return client.skillTradeSetup.update({ where: { id }, data });
    },
  };
}
