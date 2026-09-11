import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { ScalpPaperTradesController } from './scalp-paper-trades.controller';
import { ScalpPaperTradesService } from './scalp-paper-trades.service';

@Module({
  imports: [MarketModule],
  controllers: [ScalpPaperTradesController],
  providers: [ScalpPaperTradesService],
})
export class ScalpPaperTradesModule {}
