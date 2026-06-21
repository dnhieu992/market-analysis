import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { createLongSignalRepository } from '@app/db';
import { BitgetTradeClient } from '../day-trading/bitget-trade.client';
import type { QuerySignalsDto } from './dto/query-signals.dto';
import type { UpdateLongSignalSettingsDto } from './dto/update-settings.dto';

const repo = createLongSignalRepository();
const PRICE_CACHE_MS = 2_000;

type BitgetTickerResponse = { code: string; data: Array<{ symbol: string; lastPr: string }> };

@Injectable()
export class LongSignalService {
  private readonly logger = new Logger(LongSignalService.name);
  private readonly http: AxiosInstance = axios.create({ baseURL: 'https://api.bitget.com', timeout: 8_000 });
  private priceCache: { prices: Record<string, number>; at: number } | null = null;
  private readonly trade = new BitgetTradeClient();

  /**
   * Live prices for the configured basket (2s cached). The UI polls this while
   * any position is open to show unrealized P&L and TP distance per card.
   */
  async getCurrentPrices(): Promise<{ prices: Record<string, number>; at: string }> {
    if (this.priceCache && Date.now() - this.priceCache.at < PRICE_CACHE_MS) {
      return { prices: this.priceCache.prices, at: new Date(this.priceCache.at).toISOString() };
    }
    const settings = await repo.getSettings();
    const symbols = settings.symbols.split(',').map((s) => s.trim()).filter(Boolean);
    const prices: Record<string, number> = {};
    try {
      const res = await this.http.get<BitgetTickerResponse>('/api/v2/mix/market/tickers', {
        params: { productType: 'usdt-futures' },
      });
      if (res.data.code === '00000') {
        const bySymbol = new Map(res.data.data.map((t) => [t.symbol, parseFloat(t.lastPr)]));
        for (const sym of symbols) {
          const px = bySymbol.get(sym);
          if (px != null && Number.isFinite(px)) prices[sym] = px;
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch live prices: ${err instanceof Error ? err.message : String(err)}`);
      if (this.priceCache) return { prices: this.priceCache.prices, at: new Date(this.priceCache.at).toISOString() };
    }
    const at = Date.now();
    this.priceCache = { prices, at };
    return { prices, at: new Date(at).toISOString() };
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
    const value = note && note.trim() !== '' ? note : null;
    return repo.updateNote(id, value);
  }

  /**
   * Force-close an OPEN position at market (manual override). LIVE first flash-
   * closes the real Bitget position (so the click can never orphan it), then
   * records it; the exchange close happens BEFORE the DB write on purpose.
   */
  async closeSignal(id: string) {
    const signal = await repo.findById(id);
    if (!signal) throw new NotFoundException(`Signal ${id} not found`);
    if (signal.status !== 'ACTIVE') {
      throw new ConflictException(`Signal is not open (status: ${signal.status})`);
    }

    if (signal.mode === 'LIVE') {
      await this.closeLivePosition(signal.symbol, id);
    }

    const price = await this.getSymbolPrice(signal.symbol);
    if (!Number.isFinite(price) || price <= 0) {
      throw new ServiceUnavailableException('No live price available to close at market');
    }

    const qty = signal.quantity ?? 0;
    const pnlUsd = qty * (price - signal.entryPrice); // LONG only

    const closed = await repo.closeActiveSignal(id, {
      status: 'MANUAL_CLOSE',
      closedPrice: price,
      closedAt: new Date(),
      pnlUsd,
    });
    if (!closed) throw new ConflictException('Signal was already closed');

    this.logger.log(`Long signal ${id} manually closed @ ${price} → $${pnlUsd.toFixed(2)}`);
    return repo.findById(id);
  }

  private async closeLivePosition(symbol: string, id: string): Promise<void> {
    if (!this.trade.isConfigured()) {
      throw new ServiceUnavailableException('Bitget credentials not configured — cannot close a LIVE position');
    }
    try {
      const size = await this.trade.getPositionSize(symbol, 'long');
      if (size <= 0) {
        throw new ConflictException('Position already closed on the exchange — it will be reconciled');
      }
      await this.trade.closePosition(symbol, 'long');
      this.logger.log(`LIVE long flash-closed on Bitget: ${symbol} (signal ${id})`);
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to close LIVE position ${symbol} (signal ${id}): ${msg}`);
      throw new ServiceUnavailableException(`Could not close LIVE position on Bitget: ${msg}`);
    }
  }

  private async getSymbolPrice(symbol: string): Promise<number> {
    const { prices } = await this.getCurrentPrices();
    if (prices[symbol] != null) return prices[symbol]!;
    // Fall back to a direct single-symbol ticker if the basket call missed it.
    try {
      const res = await this.http.get<BitgetTickerResponse>('/api/v2/mix/market/ticker', {
        params: { symbol, productType: 'usdt-futures' },
      });
      const raw = res.data.code === '00000' ? res.data.data[0]?.lastPr : undefined;
      return raw != null ? parseFloat(raw) : 0;
    } catch {
      return 0;
    }
  }

  getSettings() {
    return repo.getSettings();
  }

  updateSettings(dto: UpdateLongSignalSettingsDto) {
    return repo.updateSettings(dto);
  }
}
