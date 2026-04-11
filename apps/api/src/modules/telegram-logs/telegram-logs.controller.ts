import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { TelegramLogsService } from './telegram-logs.service';

@ApiTags('Telegram Logs')
@ApiCookieAuth('market_analysis_session')
@Controller('telegram-logs')
export class TelegramLogsController {
  constructor(
    @Inject(TelegramLogsService)
    private readonly telegramLogsService: TelegramLogsService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all Telegram message logs' })
  listTelegramLogs() {
    return this.telegramLogsService.listTelegramLogs();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a Telegram log by ID' })
  getTelegramLogById(@Param('id') id: string) {
    return this.telegramLogsService.getTelegramLogById(id);
  }
}
