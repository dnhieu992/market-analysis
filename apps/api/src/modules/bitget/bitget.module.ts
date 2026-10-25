import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { BitgetController } from './bitget.controller';
import { BitgetJournalService } from './bitget-journal.service';
import { BitgetService } from './bitget.service';
import { BitgetSetupService } from './bitget-setup.service';
import { BitgetSetupChartService } from './bitget-setup-chart.service';
import { BitgetAutoTradeService } from './bitget-auto-trade.service';
import { BitgetAiActionService } from './bitget-ai-action.service';

@Module({
  controllers: [BitgetController],
  providers: [
    BitgetService,
    BitgetJournalService,
    BitgetSetupService,
    BitgetSetupChartService,
    BitgetAutoTradeService,
    BitgetAiActionService,
    BinanceMarketDataService,
  ],
  // The /bitget AI chat tools (ChatModule) read the account through these.
  exports: [BitgetService, BitgetJournalService, BitgetSetupService, BitgetSetupChartService, BitgetAutoTradeService],
})
export class BitgetModule {}
