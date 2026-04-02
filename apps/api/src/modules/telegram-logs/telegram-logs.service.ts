import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { TELEGRAM_LOG_REPOSITORY } from '../database/database.providers';

type TelegramLogRepository = {
  findById: (id: string) => Promise<unknown | null>;
  listLatest: (limit?: number) => Promise<unknown[]>;
};

@Injectable()
export class TelegramLogsService {
  constructor(
    @Inject(TELEGRAM_LOG_REPOSITORY)
    private readonly telegramLogRepository: TelegramLogRepository
  ) {}

  listTelegramLogs() {
    return this.telegramLogRepository.listLatest(50);
  }

  async getTelegramLogById(id: string) {
    const log = await this.telegramLogRepository.findById(id);

    if (!log) {
      throw new NotFoundException(`Telegram log ${id} not found`);
    }

    return log;
  }
}
