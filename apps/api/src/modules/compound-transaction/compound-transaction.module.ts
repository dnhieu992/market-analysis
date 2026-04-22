import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { CompoundHoldingsModule } from '../compound-holdings/compound-holdings.module';
import { CompoundPortfolioModule } from '../compound-portfolio/compound-portfolio.module';
import { CompoundTransactionController } from './compound-transaction.controller';
import { CompoundTransactionService } from './compound-transaction.service';

@Module({
  imports: [DatabaseModule, CompoundPortfolioModule, CompoundHoldingsModule],
  controllers: [CompoundTransactionController],
  providers: [CompoundTransactionService]
})
export class CompoundTransactionModule {}
