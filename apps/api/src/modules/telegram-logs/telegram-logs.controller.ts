import { Controller, Get, Inject, Param } from '@nestjs/common';

import { TelegramLogsService } from './telegram-logs.service';

@Controller('telegram-logs')
export class TelegramLogsController {
  constructor(
    @Inject(TelegramLogsService)
    private readonly telegramLogsService: TelegramLogsService
  ) {}

  @Get()
  listTelegramLogs() {
    return this.telegramLogsService.listTelegramLogs();
  }

  @Get(':id')
  getTelegramLogById(@Param('id') id: string) {
    return this.telegramLogsService.getTelegramLogById(id);
  }
}
