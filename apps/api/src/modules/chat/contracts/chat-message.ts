export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = Readonly<{
  role: ChatRole;
  content: string;
}>;
