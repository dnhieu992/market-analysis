import { Injectable } from '@nestjs/common';
import { createDayTradingRepository } from '@app/db';
import type { QuerySignalsDto } from './dto/query-signals.dto';

const repo = createDayTradingRepository();

@Injectable()
export class DayTradingService {
  async getSignals(query: QuerySignalsDto) {
    const { status, from, to, limit = 50, offset = 0 } = query;
    const [data, total] = await Promise.all([
      repo.findSignals({
        status,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        limit,
        offset,
      }),
      repo.countSignals({
        status,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      }),
    ]);
    return { data, total, limit, offset };
  }

  getStats() {
    return repo.getStats();
  }

  getSignalById(id: string) {
    return repo.findById(id);
  }
}
