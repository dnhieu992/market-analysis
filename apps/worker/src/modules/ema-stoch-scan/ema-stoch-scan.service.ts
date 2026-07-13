import { Injectable, Logger } from '@nestjs/common';
import { detectEmaStackOversoldEntry, EMA_STACK_OVERSOLD_MIN_CANDLES } from '@app/core';
import { createEmaStochScannerRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { TelegramService } from '../telegram/telegram.service';

const CANDLE_LIMIT = 300; // ~50 days of 4h candles — enough for EMA200 + StochRSI warm-up
const TIMEFRAME = '4h';

/** Format a price with sensible significant digits regardless of magnitude. */
function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

@Injectable()
export class EmaStochScanService {
  private readonly logger = new Logger(EmaStochScanService.name);
  private readonly repo = createEmaStochScannerRepository();

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly telegram: TelegramService,
  ) {}

  async scanAll(): Promise<{ scanned: number; failed: number; triggered: number }> {
    const coins = await this.repo.findAllCoins();
    let scanned = 0;
    let failed = 0;
    let triggered = 0;

    for (const coin of coins) {
      try {
        const t = await this.scanOne(coin.id, coin.symbol);
        triggered += t;
        scanned++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`EMA-bounce scan failed for ${coin.symbol}: ${msg}`);
      }
    }

    this.logger.log(`EMA-bounce scan done — scanned: ${scanned}, failed: ${failed}, new signals: ${triggered}`);
    return { scanned, failed, triggered };
  }

  /** Scan one coin: detect a fresh entry on the last CLOSED 4h candle, then refresh its open cards. */
  private async scanOne(coinId: string, symbol: string): Promise<number> {
    const klines = await this.binance.fetchKlines({
      symbol: `${symbol}USDT`,
      timeframe: TIMEFRAME as never,
      limit: CANDLE_LIMIT,
    });

    // Only use CLOSED candles — never the currently-forming one (avoids repaint).
    const now = Date.now();
    const closed = klines.filter((k) => Number(k[6]) <= now);
    if (closed.length < EMA_STACK_OVERSOLD_MIN_CANDLES) return 0;

    const closes = closed.map((k) => parseFloat(k[4]));
    const highs = closed.map((k) => parseFloat(k[2]));
    const closeTimes = closed.map((k) => Number(k[6]));
    const lastClose = closes[closes.length - 1]!;
    const lastCloseTime = closeTimes[closeTimes.length - 1]!;

    let newSignals = 0;

    // 1) Fresh entry on the just-closed candle.
    const entry = detectEmaStackOversoldEntry(closes);
    if (entry) {
      const triggeredAt = new Date(lastCloseTime);
      const res = await this.repo.createSignalIfNew(coinId, {
        symbol,
        triggeredAt,
        entryPrice: entry.price,
        tpPrice: entry.tpPrice,
        distPct: entry.distPct,
        rsi: entry.rsi,
        stochK: entry.stochK,
        stochD: entry.stochD,
        ema34: entry.ema34,
        ema89: entry.ema89,
        ema200: entry.ema200,
        currentPrice: entry.price,
        pnlPct: 0,
      });
      if (res.created) {
        newSignals++;
        this.logger.log(`EMA-bounce signal: ${symbol} @ ${entry.price} (dist -${(entry.distPct * 100).toFixed(1)}%)`);
        await this.notify(symbol, entry);
      }
    }

    // 2) Refresh this coin's OPEN cards — mark-to-market + TP check.
    const openSignals = await this.repo.findOpenSignalsByCoin(coinId);
    for (const sig of openSignals) {
      const trigMs = sig.triggeredAt.getTime();
      // max high across candles that closed strictly after the signal candle
      let maxHighSince = -Infinity;
      for (let i = 0; i < closeTimes.length; i++) {
        if (closeTimes[i]! > trigMs && highs[i]! > maxHighSince) maxHighSince = highs[i]!;
      }
      const pnlPct = ((lastClose - sig.entryPrice) / sig.entryPrice) * 100;
      if (maxHighSince >= sig.tpPrice) {
        const tpPnl = ((sig.tpPrice - sig.entryPrice) / sig.entryPrice) * 100;
        await this.repo.markSignalHitTp(sig.id, lastClose, Number(tpPnl.toFixed(2)), new Date());
      } else {
        await this.repo.updateSignalMark(sig.id, lastClose, Number(pnlPct.toFixed(2)));
      }
    }

    return newSignals;
  }

  /** Text-only Telegram alert for a fresh entry. Never throws into the scan. */
  private async notify(symbol: string, entry: { price: number; tpPrice: number; distPct: number; rsi: number; stochK: number; stochD: number }): Promise<void> {
    try {
      const chatId = process.env.TELEGRAM_CHAT_ID ?? '';
      if (!chatId) return;
      const lines = [
        `🟢 <b>EMA Bounce · ${symbol}</b> (4H)`,
        `Vào LONG: <b>${fmtPrice(entry.price)}</b>`,
        `Cách EMA34: <b>-${(entry.distPct * 100).toFixed(1)}%</b> (dưới cụm EMA34&lt;89&lt;200)`,
        `RSI ${entry.rsi.toFixed(1)} · StochRSI %K ${entry.stochK.toFixed(1)} / %D ${entry.stochD.toFixed(1)} (quá bán, cắt lên)`,
        `🎯 TP +10%: <b>${fmtPrice(entry.tpPrice)}</b>`,
        `⚠️ Chiến lược không cắt lỗ — giữ tới khi chạm TP.`,
      ];
      await this.telegram.sendToChat(chatId, lines.join('\n'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Telegram alert for ${symbol} skipped: ${msg}`);
    }
  }
}
