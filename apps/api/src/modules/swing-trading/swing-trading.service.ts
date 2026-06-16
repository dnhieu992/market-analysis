import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { createSwingTradingRepository } from '@app/db';
import type { QuerySignalsDto } from './dto/query-signals.dto';
import type { UpdateSwingTradingSettingsDto } from './dto/update-settings.dto';

const repo = createSwingTradingRepository();

// Live price is polled by the UI for open positions; cache briefly so many
// clients refreshing in parallel don't each hit Bitget.
const PRICE_CACHE_MS = 2_000;

type BitgetTickerResponse = {
  code: string;
  data: Array<{ lastPr: string }>;
};

@Injectable()
export class SwingTradingService {
  private readonly logger = new Logger(SwingTradingService.name);
  private readonly http: AxiosInstance = axios.create({
    baseURL: 'https://api.bitget.com',
    timeout: 8_000,
  });
  private priceCache = new Map<string, { price: number; at: number }>();

  /** Live futures mark price for the configured symbol from Bitget public REST (2s cached). */
  async getCurrentPrice(rawSymbol?: string): Promise<{ price: number; at: string }> {
    const symbol = (rawSymbol && rawSymbol.trim() ? rawSymbol : 'ETHUSDT').trim().toUpperCase();
    const cached = this.priceCache.get(symbol);
    if (cached && Date.now() - cached.at < PRICE_CACHE_MS) {
      return { price: cached.price, at: new Date(cached.at).toISOString() };
    }
    try {
      const res = await this.http.get<BitgetTickerResponse>('/api/v2/mix/market/ticker', {
        params: { symbol, productType: 'usdt-futures' },
      });
      const raw = res.data.code === '00000' ? res.data.data[0]?.lastPr : undefined;
      const price = raw != null ? parseFloat(raw) : NaN;
      if (!Number.isFinite(price)) {
        this.logger.warn(`Bitget ticker returned no usable price for ${symbol} (code=${res.data.code})`);
        return this.fallbackPrice(symbol);
      }
      const at = Date.now();
      this.priceCache.set(symbol, { price, at });
      return { price, at: new Date(at).toISOString() };
    } catch (err) {
      this.logger.warn(`Failed to fetch live price: ${err instanceof Error ? err.message : String(err)}`);
      return this.fallbackPrice(symbol);
    }
  }

  /** Serve the last known price (even if stale) rather than failing the request. */
  private fallbackPrice(symbol: string): { price: number; at: string } {
    const cached = this.priceCache.get(symbol);
    if (cached) {
      return { price: cached.price, at: new Date(cached.at).toISOString() };
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

  updateSettings(dto: UpdateSwingTradingSettingsDto) {
    return repo.updateSettings(dto);
  }
}
