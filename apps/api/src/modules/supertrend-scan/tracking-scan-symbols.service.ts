import { Injectable } from '@nestjs/common';
import { createTrackingCoinsRepository } from '@app/db';

/**
 * The universe both Supertrend screeners read.
 *
 * It used to be every Binance USDT spot pair (~470 coins). Since 2026-08-11 it is
 * the /tracking-coins watchlist instead: the trader only ever acts on coins that
 * already passed their own selection, so a full-exchange list buried those few in
 * hundreds of names — and a scan now finishes in seconds rather than a minute.
 */

export type ScanSymbol = { symbol: string; baseAsset: string };

@Injectable()
export class TrackingScanSymbolsService {
  private readonly repo = createTrackingCoinsRepository();

  /** Watchlist coins as Binance pairs. Stored bare ("ADA") → "ADAUSDT". */
  async list(): Promise<ScanSymbol[]> {
    const coins = await this.repo.findAllCoins();
    const seen = new Set<string>();
    const out: ScanSymbol[] = [];

    for (const coin of coins) {
      const baseAsset = coin.symbol.trim().toUpperCase().replace(/USDT$/, '');
      if (!baseAsset || seen.has(baseAsset)) continue;
      seen.add(baseAsset);
      out.push({ symbol: `${baseAsset}USDT`, baseAsset });
    }

    return out;
  }
}
