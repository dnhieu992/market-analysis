import { prisma } from '../client';

export type ChatSkillVersionInput = {
  skillId: string;
  content: string;
  note?: string | null;
  author?: 'USER' | 'LLM';
  conversationId?: string | null;
};

/**
 * Append-only versions of an AI chat's editable analysis skill. The highest
 * `version` of a skillId is the active one; nothing is ever updated in place.
 */
export function createChatSkillVersionRepository(client = prisma) {
  return {
    latest(skillId: string) {
      return client.chatSkillVersion.findFirst({ where: { skillId }, orderBy: { version: 'desc' } });
    },

    findVersion(skillId: string, version: number) {
      return client.chatSkillVersion.findUnique({ where: { skillId_version: { skillId, version } } });
    },

    /** Newest first, content included (the skill text is small). */
    list(skillId: string, take = 50) {
      return client.chatSkillVersion.findMany({ where: { skillId }, orderBy: { version: 'desc' }, take });
    },

    /** Writes the next version number in one transaction (unique index guards a race). */
    async append(input: ChatSkillVersionInput) {
      return client.$transaction(async (tx) => {
        const last = await tx.chatSkillVersion.findFirst({ where: { skillId: input.skillId }, orderBy: { version: 'desc' } });
        return tx.chatSkillVersion.create({
          data: {
            skillId: input.skillId,
            version: (last?.version ?? 0) + 1,
            content: input.content,
            note: input.note?.slice(0, 500) ?? null,
            author: input.author ?? 'USER',
            conversationId: input.conversationId ?? null,
          },
        });
      });
    },
  };
}
