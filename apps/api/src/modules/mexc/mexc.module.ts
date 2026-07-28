import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { MexcController } from './mexc.controller';
import { MexcJournalService } from './mexc-journal.service';
import { MexcService } from './mexc.service';
import { MexcSetupService } from './mexc-setup.service';
import { MexcSetupChartService } from './mexc-setup-chart.service';

@Module({
  controllers: [MexcController],
  providers: [
    MexcService,
    MexcJournalService,
    MexcSetupService,
    MexcSetupChartService,
    BinanceMarketDataService,
  ],
})
export class MexcModule {}
