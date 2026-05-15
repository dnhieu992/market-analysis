import { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createConversationRepository(client = prisma) {
  return {
    create(userId: string, title: string, skillId?: string, metadata?: Record<string, unknown>) {
      return client.conversation.create({
        data: {
          userId,
          title,
          skillId: skillId ?? null,
          ...(metadata !== undefined ? { metadata: metadata as Prisma.InputJsonValue } : {})
        }
      });
    },

    findById(id: string) {
      return client.conversation.findUnique({ where: { id } });
    },

    listByUser(userId: string, skillId?: string) {
      return client.conversation.findMany({
        where: { userId, ...(skillId !== undefined ? { skillId } : {}) },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, skillId: true, createdAt: true, updatedAt: true }
      });
    },

    updateTitle(id: string, title: string) {
      return client.conversation.update({ where: { id }, data: { title } });
    },

    remove(id: string) {
      return client.conversation.delete({ where: { id } });
    },

    touch(id: string) {
      return client.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
    },

    addMessage(conversationId: string, role: string, content: string) {
      return client.conversationMessage.create({ data: { conversationId, role, content } });
    },

    listMessages(conversationId: string) {
      return client.conversationMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' }
      });
    }
  };
}
