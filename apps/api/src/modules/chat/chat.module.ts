import { Module } from '@nestjs/common';

import { BacktestLabModule } from '../backtest-lab/backtest-lab.module';
import { BitgetModule } from '../bitget/bitget.module';
import { ChartLabModule } from '../chart-lab/chart-lab.module';
import { DatabaseModule } from '../database/database.module';
import { MexcModule } from '../mexc/mexc.module';
import { OkxModule } from '../okx/okx.module';
import { ShortScoreModule } from '../short-score/short-score.module';
import { TradeEntriesModule } from '../trade-entries/trade-entries.module';
import { TradingListModule } from '../trading-list/trading-list.module';
import { ChatController } from './chat.controller';
import { ChatProvider } from './contracts/chat-provider';
import { ChatToolRegistry } from './contracts/chat-tool-registry';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ClaudeChatProvider } from './providers/claude-chat.provider';
import { BacktestChatService } from './tools/backtest.tools';
import { ShortScoreChatService } from './tools/short-score.tools';
import { ChartLabChatService } from './tools/chart-lab.tools';
import { BitgetAiChatService } from './tools/bitget-ai.tools';
import { MexcAiChatService } from './tools/mexc-ai.tools';
import { TradingListAiChatService } from './tools/trading-list-ai.tools';
import { OkxShortAiChatService } from './tools/okx-short-ai.tools';
import { TradingChatToolRegistry } from './tools/trading-chat-tool-registry';

@Module({
  imports: [DatabaseModule, BacktestLabModule, ChartLabModule, BitgetModule, MexcModule, OkxModule, ShortScoreModule, TradingListModule, TradeEntriesModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ConversationService,
    ClaudeChatProvider,
    BitgetAiChatService,
    MexcAiChatService,
    TradingListAiChatService,
    OkxShortAiChatService,
    BacktestChatService,
    ShortScoreChatService,
    ChartLabChatService,
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
