import type { ChatMessage } from './chat-message';

export type ChatReply = Readonly<{
  reply: string;
  model: string;
}>;

export abstract class ChatProvider {
  abstract chat(messages: readonly ChatMessage[]): Promise<ChatReply>;
}
