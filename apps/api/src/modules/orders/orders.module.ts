import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderJournalService } from './order-journal.service';

@Module({
  imports: [DatabaseModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderJournalService],
  exports: [OrdersService]
})
export class OrdersModule {}
