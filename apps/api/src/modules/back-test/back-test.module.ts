import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { BackTestProviders } from './back-test.providers';
import { BackTestController } from './back-test.controller';
import { BackTestService } from './back-test.service';
import { BackTestEngineService } from './back-test-engine.service';
import { StrategyRegistryService } from './strategy-registry.service';

@Module({
  imports: [MarketModule],
  controllers: [BackTestController],
  providers: [
    ...BackTestProviders,
    BackTestService,
    BackTestEngineService,
    StrategyRegistryService
  ]
})
export class BackTestModule {}
