import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { CompoundPortfolioController } from './compound-portfolio.controller';
import { CompoundPortfolioService } from './compound-portfolio.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CompoundPortfolioController],
  providers: [CompoundPortfolioService],
  exports: [CompoundPortfolioService]
})
export class CompoundPortfolioModule {}
