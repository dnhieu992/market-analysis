import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { ChatController } from './chat.controller';
import { ChatProvider } from './contracts/chat-provider';
import { ChatToolRegistry } from './contracts/chat-tool-registry';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ClaudeChatProvider } from './providers/claude-chat.provider';
import { TradingChatToolRegistry } from './tools/trading-chat-tool-registry';

@Module({
  imports: [DatabaseModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ConversationService,
    ClaudeChatProvider,
    {
      provide: ChatProvider,
      useClass: ClaudeChatProvider
    },
    {
      provide: ChatToolRegistry,
      useClass: TradingChatToolRegistry
    }
  ],
  exports: [ChatService, ConversationService]
})
export class ChatModule {}
