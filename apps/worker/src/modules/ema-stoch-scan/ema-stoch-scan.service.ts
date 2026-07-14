import { Injectable, Logger } from '@nestjs/common';
import {
  detectEmaStackOversoldSignal,
  EMA_STACK_OVERSOLD_MIN_CANDLES,
  type EmaStackSignalStage,
} from '@app/core';
import { createEmaStochScannerRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { TelegramService } from '../telegram/telegram.service';

const CANDLE_LIMIT = 300; // enough for EMA200 + StochRSI warm-up on any timeframe

/** How close to the +10% TP counts as the "risk" (near-TP) stage. */
const RISK_BAND = 0.02;

/** Stage ordering — a card only ever advances (never falls back). */
type Stage = EmaStackSignalStage | 'risk';
const STAGE_RANK: Record<string, number> = { near: 0, reach: 1, risk: 2 };

/** Human label for a scan timeframe, shown on cards and in Telegram. */
function tfLabel(tf: string): string {
  return tf === '1d' ? '1D' : tf === '4h' ? '4H' : tf.toUpperCase();
}

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

  async scanAll(timeframe = '4h'): Promise<{ scanned: number; failed: number; triggered: number }> {
    const coins = await this.repo.findAllCoins();
    let scanned = 0;
    let failed = 0;
    let triggered = 0;

    for (const coin of coins) {
      try {
        const t = await this.scanOne(coin.id, coin.symbol, timeframe);
        triggered += t;
        scanned++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`EMA-bounce scan (${timeframe}) failed for ${coin.symbol}: ${msg}`);
      }
    }

    this.logger.log(`EMA-bounce scan (${timeframe}) done — scanned: ${scanned}, failed: ${failed}, new signals: ${triggered}`);
    return { scanned, failed, triggered };
  }

  /**
   * Scan one coin on `timeframe`:
   *  - if it already has an OPEN card → refresh mark-to-market, TP-check, and advance its
   *    stage (near → reach → risk), alerting once per new stage;
   *  - otherwise, if the detector fires, create a fresh card at its detected stage
   *    (near / reach) and alert.
   * At most one open card per coin+timeframe, so a "near" watch flips in place to "reach"
   * when the entry actually triggers — no duplicate cards.
   */
  private async scanOne(coinId: string, symbol: string, timeframe: string): Promise<number> {
    const klines = await this.binance.fetchKlines({
      symbol: `${symbol}USDT`,
      timeframe: timeframe as never,
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

    const signal = detectEmaStackOversoldSignal(closes);
    const openSignals = await this.repo.findOpenSignalsByCoinAndTimeframe(coinId, timeframe);

    // 1) Refresh + advance existing open cards.
    for (const sig of openSignals) {
      const trigMs = sig.triggeredAt.getTime();
      let maxHighSince = -Infinity;
      for (let i = 0; i < closeTimes.length; i++) {
        if (closeTimes[i]! > trigMs && highs[i]! > maxHighSince) maxHighSince = highs[i]!;
      }
      const pnlPct = ((lastClose - sig.entryPrice) / sig.entryPrice) * 100;

      if (maxHighSince >= sig.tpPrice) {
        const tpPnl = ((sig.tpPrice - sig.entryPrice) / sig.entryPrice) * 100;
        await this.repo.markSignalHitTp(sig.id, lastClose, Number(tpPnl.toFixed(2)), new Date());
        continue;
      }

      await this.repo.updateSignalMark(sig.id, lastClose, Number(pnlPct.toFixed(2)));

      // Stage progression — monotonic (near → reach → risk).
      const curRank = STAGE_RANK[sig.stage] ?? STAGE_RANK.reach!;
      let nextStage: Stage = sig.stage as Stage;
      let nextNote = sig.note ?? '';
      if (lastClose >= sig.tpPrice * (1 - RISK_BAND)) {
        nextStage = 'risk';
        nextNote = `Giá +${pnlPct.toFixed(1)}% — gần chạm TP +10%`;
      } else if (signal && signal.stage === 'reach') {
        nextStage = 'reach';
        nextNote = signal.note;
      }
      if ((STAGE_RANK[nextStage] ?? 0) > curRank) {
        await this.repo.updateSignalStage(sig.id, nextStage, nextNote);
        this.logger.log(`EMA-bounce ${symbol} (${timeframe}) ${sig.stage} → ${nextStage}`);
        await this.notifyStage(symbol, timeframe, nextStage, {
          price: lastClose,
          tpPrice: sig.tpPrice,
          distPct: sig.distPct,
          rsi: sig.rsi ?? 0,
          stochK: sig.stochK ?? 0,
          stochD: sig.stochD ?? 0,
          pnlPct,
          note: nextNote,
        });
      }
    }

    // 2) No open card yet → create one at its detected stage.
    if (openSignals.length === 0 && signal) {
      const res = await this.repo.createSignalIfNew(coinId, {
        symbol,
        timeframe,
        triggeredAt: new Date(lastCloseTime),
        stage: signal.stage,
        note: signal.note,
        entryPrice: signal.price,
        tpPrice: signal.tpPrice,
        distPct: signal.distPct,
        rsi: signal.rsi,
        stochK: signal.stochK,
        stochD: signal.stochD,
        ema34: signal.ema34,
        ema89: signal.ema89,
        ema200: signal.ema200,
        currentPrice: signal.price,
        pnlPct: 0,
      });
      if (res.created) {
        this.logger.log(`EMA-bounce ${signal.stage} (${timeframe}): ${symbol} @ ${signal.price} (dist -${(signal.distPct * 100).toFixed(1)}%)`);
        await this.notifyStage(symbol, timeframe, signal.stage, {
          price: signal.price,
          tpPrice: signal.tpPrice,
          distPct: signal.distPct,
          rsi: signal.rsi,
          stochK: signal.stochK,
          stochD: signal.stochD,
          pnlPct: 0,
          note: signal.note,
        });
        return 1;
      }
    }

    return 0;
  }

  /** Labeled Telegram alert per stage transition. Never throws into the scan. */
  private async notifyStage(
    symbol: string,
    timeframe: string,
    stage: Stage,
    m: { price: number; tpPrice: number; distPct: number; rsi: number; stochK: number; stochD: number; pnlPct: number; note: string },
  ): Promise<void> {
    try {
      const chatId = process.env.TELEGRAM_CHAT_ID ?? '';
      if (!chatId) return;
      const tf = tfLabel(timeframe);
      let lines: string[];
      if (stage === 'near') {
        lines = [
          `⏳ <b>GẦN THOẢ MÃN · ${symbol}</b> (${tf})`,
          `Giá: <b>${fmtPrice(m.price)}</b> · cách EMA34 <b>-${(m.distPct * 100).toFixed(1)}%</b>`,
          `StochRSI %K ${m.stochK.toFixed(1)} / %D ${m.stochD.toFixed(1)}`,
          `📝 ${m.note}`,
          `👀 Chưa vào — mở chart xem có nên chờ không.`,
        ];
      } else if (stage === 'reach') {
        lines = [
          `🟢 <b>THOẢ MÃN · ${symbol}</b> (${tf})`,
          `Vào LONG: <b>${fmtPrice(m.price)}</b>`,
          `Cách EMA34: <b>-${(m.distPct * 100).toFixed(1)}%</b> (dưới cụm EMA34&lt;89&lt;200)`,
          `RSI ${m.rsi.toFixed(1)} · StochRSI %K ${m.stochK.toFixed(1)} / %D ${m.stochD.toFixed(1)} (quá bán, cắt lên)`,
          `🎯 TP +10%: <b>${fmtPrice(m.tpPrice)}</b>`,
          `⚠️ Chiến lược không cắt lỗ — giữ tới khi chạm TP.`,
        ];
      } else {
        lines = [
          `🔔 <b>GẦN TP · ${symbol}</b> (${tf})`,
          `Giá: <b>${fmtPrice(m.price)}</b> (${m.pnlPct >= 0 ? '+' : ''}${m.pnlPct.toFixed(1)}%)`,
          `🎯 TP +10%: <b>${fmtPrice(m.tpPrice)}</b> — đã gần chạm, cân nhắc chốt/theo dõi.`,
        ];
      }
      await this.telegram.sendToChat(chatId, lines.join('\n'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Telegram alert for ${symbol} skipped: ${msg}`);
    }
  }
}
