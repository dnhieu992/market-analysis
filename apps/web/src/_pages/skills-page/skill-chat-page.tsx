import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { Skill, Conversation, ChatMessage } from '@web/shared/api/types';
import { SkillChatClient } from './skill-chat-client';

type Props = {
  skillId: string;
  conversationId: string;
};

async function loadData(skillId: string, conversationId: string): Promise<{
  skill: Skill | null;
  conversations: Conversation[];
  initialMessages: ChatMessage[];
}> {
  const api = createServerApiClient();

  if (conversationId === 'new') {
    const [skillResult, conversations] = await Promise.allSettled([
      api.fetchSkills().then((skills) => skills.find((s) => s.id === skillId) ?? null),
      api.listConversations(skillId),
    ]);
    return {
      skill: skillResult.status === 'fulfilled' ? skillResult.value : null,
      conversations: conversations.status === 'fulfilled' ? conversations.value : [],
      initialMessages: [],
    };
  }

  const [skillResult, conversations, initialMessages] = await Promise.allSettled([
    api.fetchSkills().then((skills) => skills.find((s) => s.id === skillId) ?? null),
    api.listConversations(skillId),
    api.getMessages(conversationId),
  ]);

  return {
    skill: skillResult.status === 'fulfilled' ? skillResult.value : null,
    conversations: conversations.status === 'fulfilled' ? conversations.value : [],
    initialMessages: initialMessages.status === 'fulfilled' ? initialMessages.value : [],
  };
}

export default async function SkillChatPage({ skillId, conversationId }: Props) {
  const { skill, conversations, initialMessages } = await loadData(skillId, conversationId);

  return (
    <SkillChatClient
      skillId={skillId}
      conversationId={conversationId}
      skill={skill}
      initialConversations={conversations}
      initialMessages={initialMessages}
    />
  );
}
