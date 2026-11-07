import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { JunkShortCoin } from '@web/shared/api/types';
import { JunkCoinsButton } from '@web/widgets/short-junk/junk-coins-dialog';

import { SkillChatClient } from '../skills-page/skill-chat-client';
import { loadSkillChatData } from '../skills-page/skill-chat-page';

const SKILL_ID = 'short-junk';

/** /short-junk — the "Short Coin Rác" skill chat on its own page, plus the coin list it scans. */
export default async function ShortJunkPage({ conversationId }: { conversationId: string }) {
  const [data, coins] = await Promise.all([
    loadSkillChatData(SKILL_ID, conversationId),
    createServerApiClient()
      .fetchJunkCoins()
      .catch((): JunkShortCoin[] => []),
  ]);

  return (
    <SkillChatClient
      key={conversationId}
      skillId={SKILL_ID}
      conversationId={conversationId}
      skill={data.skill}
      initialConversations={data.conversations}
      initialMessages={data.initialMessages}
      basePath="/short-junk/chat"
      backLink={{ href: '/skills', label: '← Skills' }}
      headerExtra={<JunkCoinsButton initialCoins={coins} />}
    />
  );
}
