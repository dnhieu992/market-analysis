import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { TrackedSetupsController } from './tracked-setups.controller';
import { TrackedSetupsService } from './tracked-setups.service';

@Module({
  imports: [DatabaseModule],
  controllers: [TrackedSetupsController],
  providers: [TrackedSetupsService]
})
export class TrackedSetupsModule {}
