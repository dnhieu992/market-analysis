import { Injectable } from '@nestjs/common';

import { ChatToolRegistry } from '../contracts/chat-tool-registry';
import type { ChatTool } from '../contracts/chat-tool';

@Injectable()
export class NoopChatToolRegistry extends ChatToolRegistry {
  listTools(): readonly ChatTool[] {
    return [];
  }

  getTool(name: string): ChatTool | undefined {
    void name;
    return undefined;
  }
}
