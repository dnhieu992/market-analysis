import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SignalsController],
  providers: [SignalsService],
  exports: [SignalsService]
})
export class SignalsModule {}
