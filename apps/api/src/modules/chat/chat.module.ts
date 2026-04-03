import { Module } from '@nestjs/common';

import { ChatController } from './chat.controller';
import { ChatProvider } from './contracts/chat-provider';
import { ChatToolRegistry } from './contracts/chat-tool-registry';
import { ChatService } from './chat.service';
import { NoopChatToolRegistry } from './providers/noop-chat-tool-registry';
import { OpenAiChatProvider } from './providers/openai-chat.provider';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    {
      provide: ChatProvider,
      useClass: OpenAiChatProvider
    },
    {
      provide: ChatToolRegistry,
      useClass: NoopChatToolRegistry
    }
  ],
  exports: [ChatService, ChatProvider, ChatToolRegistry]
})
export class ChatModule {}
