import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { HoldingsController } from './holdings.controller';
import { HoldingsService } from './holdings.service';

@Module({
  imports: [DatabaseModule, PortfolioModule],
  controllers: [HoldingsController],
  providers: [HoldingsService],
  exports: [HoldingsService]
})
export class HoldingsModule {}
