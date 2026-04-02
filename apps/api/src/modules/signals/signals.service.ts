import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { SIGNAL_REPOSITORY } from '../database/database.providers';
import type { QuerySignalsDto } from './dto/query-signals.dto';

type SignalRepository = {
  findById: (id: string) => Promise<unknown | null>;
  listLatest: (limit?: number) => Promise<unknown[]>;
};

@Injectable()
export class SignalsService {
  constructor(
    @Inject(SIGNAL_REPOSITORY)
    private readonly signalRepository: SignalRepository
  ) {}

  async listSignals(query: QuerySignalsDto) {
    const rows = await this.signalRepository.listLatest(50);

    return rows.filter((row) => {
      const candidate = row as { symbol?: string; timeframe?: string };
      return (
        (!query.symbol || candidate.symbol === query.symbol) &&
        (!query.timeframe || candidate.timeframe === query.timeframe)
      );
    });
  }

  async getSignalById(id: string) {
    const signal = await this.signalRepository.findById(id);

    if (!signal) {
      throw new NotFoundException(`Signal ${id} not found`);
    }

    return signal;
  }

  async getLatestSignal(symbol: string, timeframe: string) {
    const signals = await this.listSignals({ symbol, timeframe });
    return signals[0] ?? null;
  }
}
