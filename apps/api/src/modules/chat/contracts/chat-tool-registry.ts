import type { ChatTool } from './chat-tool';

export abstract class ChatToolRegistry {
  abstract listTools(): readonly ChatTool[];
  abstract getTool(name: string): ChatTool | undefined;
}
