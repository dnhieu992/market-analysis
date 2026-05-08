import SkillChatPage from '@web/pages/skills-page/skill-chat-page';

type PageProps = Readonly<{
  params: { skillId: string; conversationId: string };
}>;

export default function Page({ params }: PageProps) {
  return <SkillChatPage skillId={params.skillId} conversationId={params.conversationId} />;
}
