import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PortfolioController],
  providers: [PortfolioService],
  exports: [PortfolioService]
})
export class PortfolioModule {}
