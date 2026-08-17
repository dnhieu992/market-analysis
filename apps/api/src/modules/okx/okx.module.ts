import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { OkxController } from './okx.controller';
import { OkxJournalService } from './okx-journal.service';
import { OkxService } from './okx.service';
import { OkxSetupService } from './okx-setup.service';
import { OkxSetupChartService } from './okx-setup-chart.service';

@Module({
  controllers: [OkxController],
  providers: [
    OkxService,
    OkxJournalService,
    OkxSetupService,
    OkxSetupChartService,
    BinanceMarketDataService,
  ],
})
export class OkxModule {}
