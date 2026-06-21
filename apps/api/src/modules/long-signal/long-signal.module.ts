import { Module } from '@nestjs/common';
import { LongSignalController } from './long-signal.controller';
import { LongSignalService } from './long-signal.service';

@Module({
  controllers: [LongSignalController],
  providers: [LongSignalService],
})
export class LongSignalModule {}
