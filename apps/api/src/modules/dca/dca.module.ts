import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { MarketModule } from '../market/market.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TransactionModule } from '../transaction/transaction.module';
import { DcaController } from './dca.controller';
import { DcaService } from './dca.service';
import { DcaPlanService } from './dca-plan.service';
import { DcaLlmService } from './dca-llm.service';

@Module({
  imports: [DatabaseModule, PortfolioModule, TransactionModule, MarketModule],
  controllers: [DcaController],
  providers: [DcaService, DcaPlanService, DcaLlmService]
})
export class DcaModule {}
