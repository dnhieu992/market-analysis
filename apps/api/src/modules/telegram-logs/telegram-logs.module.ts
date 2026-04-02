import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { TelegramLogsController } from './telegram-logs.controller';
import { TelegramLogsService } from './telegram-logs.service';

@Module({
  imports: [DatabaseModule],
  controllers: [TelegramLogsController],
  providers: [TelegramLogsService],
  exports: [TelegramLogsService]
})
export class TelegramLogsModule {}
