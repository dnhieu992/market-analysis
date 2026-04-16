import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { MarketModule } from '../market/market.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { PnlController } from './pnl.controller';
import { PnlService } from './pnl.service';

@Module({
  imports: [DatabaseModule, PortfolioModule, MarketModule],
  controllers: [PnlController],
  providers: [PnlService]
})
export class PnlModule {}
