import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { BitgetController } from './bitget.controller';
import { BitgetJournalService } from './bitget-journal.service';
import { BitgetService } from './bitget.service';
import { BitgetSetupService } from './bitget-setup.service';
import { BitgetSetupChartService } from './bitget-setup-chart.service';

@Module({
  controllers: [BitgetController],
  providers: [
    BitgetService,
    BitgetJournalService,
    BitgetSetupService,
    BitgetSetupChartService,
    BinanceMarketDataService,
  ],
})
export class BitgetModule {}
