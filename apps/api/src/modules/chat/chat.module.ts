import { Module } from '@nestjs/common';

import { BitgetModule } from '../bitget/bitget.module';
import { DatabaseModule } from '../database/database.module';
import { MexcModule } from '../mexc/mexc.module';
import { TradingListModule } from '../trading-list/trading-list.module';
import { ChatController } from './chat.controller';
import { ChatProvider } from './contracts/chat-provider';
import { ChatToolRegistry } from './contracts/chat-tool-registry';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ClaudeChatProvider } from './providers/claude-chat.provider';
import { BitgetAiChatService } from './tools/bitget-ai.tools';
import { MexcAiChatService } from './tools/mexc-ai.tools';
import { TradingListAiChatService } from './tools/trading-list-ai.tools';
import { TradingChatToolRegistry } from './tools/trading-chat-tool-registry';

@Module({
  imports: [DatabaseModule, BitgetModule, MexcModule, TradingListModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ConversationService,
    ClaudeChatProvider,
    BitgetAiChatService,
    MexcAiChatService,
    TradingListAiChatService,
    {
      provide: ChatProvider,
      useClass: ClaudeChatProvider
    },
    {
      provide: ChatToolRegistry,
      useClass: TradingChatToolRegistry
    }
  ],
  exports: [ChatService, ConversationService, ClaudeChatProvider]
})
export class ChatModule {}
