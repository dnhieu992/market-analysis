import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { CompoundPortfolioModule } from '../compound-portfolio/compound-portfolio.module';
import { CompoundHoldingsController } from './compound-holdings.controller';
import { CompoundHoldingsService } from './compound-holdings.service';

@Module({
  imports: [DatabaseModule, CompoundPortfolioModule],
  controllers: [CompoundHoldingsController],
  providers: [CompoundHoldingsService],
  exports: [CompoundHoldingsService]
})
export class CompoundHoldingsModule {}
