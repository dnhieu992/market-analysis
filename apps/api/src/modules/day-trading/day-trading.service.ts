import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { createDayTradingRepository } from '@app/db';
import type { QuerySignalsDto } from './dto/query-signals.dto';
import type { UpdateDayTradingSettingsDto } from './dto/update-settings.dto';

const repo = createDayTradingRepository();

// Live price is polled by the UI for open positions; cache briefly so many
// clients refreshing in parallel don't each hit Bitget.
const PRICE_CACHE_MS = 2_000;

type BitgetTickerResponse = {
  code: string;
  data: Array<{ lastPr: string }>;
};

@Injectable()
export class DayTradingService {
  private readonly logger = new Logger(DayTradingService.name);
  private readonly http: AxiosInstance = axios.create({
    baseURL: 'https://api.bitget.com',
    timeout: 8_000,
  });
  private priceCache: { price: number; at: number } | null = null;

  /** Live BTCUSDT futures mark price from Bitget public REST (2s cached). */
  async getCurrentPrice(): Promise<{ price: number; at: string }> {
    if (this.priceCache && Date.now() - this.priceCache.at < PRICE_CACHE_MS) {
      return { price: this.priceCache.price, at: new Date(this.priceCache.at).toISOString() };
    }
    try {
      const res = await this.http.get<BitgetTickerResponse>('/api/v2/mix/market/ticker', {
        params: { symbol: 'BTCUSDT', productType: 'usdt-futures' },
      });
      const raw = res.data.code === '00000' ? res.data.data[0]?.lastPr : undefined;
      const price = raw != null ? parseFloat(raw) : NaN;
      if (!Number.isFinite(price)) {
        this.logger.warn(`Bitget ticker returned no usable price (code=${res.data.code})`);
        return this.fallbackPrice();
      }
      const at = Date.now();
      this.priceCache = { price, at };
      return { price, at: new Date(at).toISOString() };
    } catch (err) {
      this.logger.warn(`Failed to fetch live price: ${err instanceof Error ? err.message : String(err)}`);
      return this.fallbackPrice();
    }
  }

  /** Serve the last known price (even if stale) rather than failing the request. */
  private fallbackPrice(): { price: number; at: string } {
    if (this.priceCache) {
      return { price: this.priceCache.price, at: new Date(this.priceCache.at).toISOString() };
    }
    return { price: 0, at: new Date().toISOString() };
  }

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

  updateNote(id: string, note: string | null | undefined) {
    // Treat empty/whitespace as clearing the note.
    const value = note && note.trim() !== '' ? note : null;
    return repo.updateNote(id, value);
  }

  getSettings() {
    return repo.getSettings();
  }

  updateSettings(dto: UpdateDayTradingSettingsDto) {
    return repo.updateSettings(dto);
  }
}
