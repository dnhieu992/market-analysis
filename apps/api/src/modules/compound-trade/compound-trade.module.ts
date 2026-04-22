import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { CompoundTradeController } from './compound-trade.controller';
import { CompoundTradeService } from './compound-trade.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CompoundTradeController],
  providers: [CompoundTradeService]
})
export class CompoundTradeModule {}
