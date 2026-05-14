import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { HoldingsModule } from '../holdings/holdings.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';

@Module({
  imports: [DatabaseModule, PortfolioModule, HoldingsModule],
  controllers: [TransactionController],
  providers: [TransactionService],
  exports: [TransactionService]
})
export class TransactionModule {}
