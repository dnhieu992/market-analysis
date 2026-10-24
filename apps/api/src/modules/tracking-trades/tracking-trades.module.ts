import { Module } from '@nestjs/common';

import { ChatModule } from '../chat/chat.module';
import { MarketModule } from '../market/market.module';
import { TrackingTradesController } from './tracking-trades.controller';
import { TrackingTradesService } from './tracking-trades.service';

@Module({
  imports: [MarketModule, ChatModule],
  controllers: [TrackingTradesController],
  providers: [TrackingTradesService],
})
export class TrackingTradesModule {}
