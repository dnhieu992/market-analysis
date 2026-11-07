import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { Skill, Conversation, ChatMessage } from '@web/shared/api/types';
import { redirect } from 'next/navigation';
import { SkillChatClient } from './skill-chat-client';

type Props = {
  skillId: string;
  conversationId: string;
};

async function loadSkillChatData(skillId: string, conversationId: string): Promise<{
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
  // Short Coin Rác lives on /short-junk (coin list + AI chat panel); old links keep working.
  if (skillId === 'short-junk') redirect('/short-junk');
  const { skill, conversations, initialMessages } = await loadSkillChatData(skillId, conversationId);

  return (
    <SkillChatClient
      key={conversationId}
      skillId={skillId}
      conversationId={conversationId}
      skill={skill}
      initialConversations={conversations}
      initialMessages={initialMessages}
    />
  );
}
