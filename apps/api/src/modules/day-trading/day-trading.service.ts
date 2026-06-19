import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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

  /**
   * Force-close an OPEN position at the current market price (manual override).
   * In PAPER mode this just records the exit; in LIVE mode this is where the
   * market-close order would be sent (see docs: idempotency, REQUIRED before live).
   * The DB write is race-safe (`closeActiveSignal` only fires while ACTIVE), so it
   * can't double-close against a concurrent TP/SL tick in the worker.
   */
  async closeSignal(id: string) {
    const signal = await repo.findById(id);
    if (!signal) throw new NotFoundException(`Signal ${id} not found`);
    if (signal.status !== 'ACTIVE') {
      throw new ConflictException(`Signal is not open (status: ${signal.status})`);
    }

    const { price } = await this.getCurrentPrice();
    if (!Number.isFinite(price) || price <= 0) {
      throw new ServiceUnavailableException('No live price available to close at market');
    }

    const move = signal.direction === 'LONG' ? price - signal.entryPrice : signal.entryPrice - price;
    const riskPerUnit = Math.abs(signal.entryPrice - signal.stopLoss);
    const qty = signal.quantity ?? (riskPerUnit > 0 ? signal.riskAmount / riskPerUnit : 0);
    const pnlUsd = qty * move;

    const closed = await repo.closeActiveSignal(id, {
      status: 'MANUAL_CLOSE',
      closedPrice: price,
      closedAt: new Date(),
      pnlUsd,
    });
    if (!closed) {
      // Lost the race — a TP/SL tick (or another click) closed it first.
      throw new ConflictException('Signal was already closed');
    }

    void repo
      .logAction({
        action: 'MANUAL_CLOSE',
        signalId: id,
        symbol: signal.symbol,
        message: `Manual market close @ ${price} → $${pnlUsd.toFixed(2)}`,
        detailJson: JSON.stringify({ closedPrice: price, pnlUsd, entryPrice: signal.entryPrice, direction: signal.direction }),
      })
      .catch((err) => this.logger.warn(`audit MANUAL_CLOSE failed: ${err instanceof Error ? err.message : String(err)}`));

    this.logger.log(`Signal ${id} manually closed @ ${price} → $${pnlUsd.toFixed(2)}`);
    return repo.findById(id);
  }

  getSettings() {
    return repo.getSettings();
  }

  updateSettings(dto: UpdateDayTradingSettingsDto) {
    return repo.updateSettings(dto);
  }
}
