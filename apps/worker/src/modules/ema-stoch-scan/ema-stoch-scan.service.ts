import { Injectable, Logger } from '@nestjs/common';
import {
  scoreEmaStackOversoldSetup,
  computeTimeframeTrend,
  formatEmaStackPa,
  EMA_STACK_OVERSOLD_MIN_CANDLES,
  type EmaStackSignalStage,
  type PaTrend,
} from '@app/core';
import { createEmaStochScannerRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { TelegramService } from '../telegram/telegram.service';

const CANDLE_LIMIT = 300; // enough for EMA200 + StochRSI warm-up on any timeframe

/** Candles fetched for the higher-timeframe PA trend (EMA89 + swing pivots need far less). */
const HTF_CANDLE_LIMIT = 200;

/** The timeframe whose PA trend gives a setup its context: a 4H bounce is read against D1, a D1 bounce against W1. */
const HTF_OF: Record<string, { tf: string; label: string }> = {
  '4h': { tf: '1d', label: 'D1' },
  '1d': { tf: '1w', label: 'W1' },
};

/** DB `note` column is VARCHAR(255) — reasons now include PA text, so clamp defensively. */
const NOTE_MAX = 255;

/** How close to the +10% TP counts as the "risk" (near-TP) stage. */
const RISK_BAND = 0.02;

/** Only send Telegram for a low-completeness card once its score reaches this. */
const ALERT_MIN_SCORE = 70;

/** Stage ordering — a card only ever advances (never falls back). */
type Stage = EmaStackSignalStage | 'risk';
const STAGE_RANK: Record<string, number> = { near: 0, reach: 1, risk: 2 };

/** Human label for a scan timeframe, shown on cards and in Telegram. */
function tfLabel(tf: string): string {
  return tf === '1d' ? '1D' : tf === '4h' ? '4H' : tf.toUpperCase();
}

/** Human-readable StochRSI reading: zone + momentum direction (%K above %D = đà tăng). */
function stochLabel(k: number, d: number): string {
  const zone =
    k < 20 ? 'Quá bán' : k < 30 ? 'Gần quá bán' : k > 80 ? 'Quá mua' : k > 70 ? 'Gần quá mua' : 'Trung tính';
  const dir = k > d ? 'đà tăng ↑' : k < d ? 'đà giảm ↓' : 'đi ngang';
  return `${zone}, ${dir}`;
}

/** Join reason labels into the card note, clamped to the column width. */
function noteOf(reasons: string[]): string {
  return reasons.join(' • ').slice(0, NOTE_MAX);
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
   *  - if it already has an OPEN card → refresh mark-to-market + recomputed score, advance
   *    its stage (near → reach → risk), and alert once per new stage (or once the score
   *    first reaches {@link ALERT_MIN_SCORE}); a faded near card that lost every signal
   *    condition and is not in profit is expired to keep the page clean;
   *  - otherwise, when the scored detector fires (below EMA34 + ≥1 signal condition), create
   *    a fresh card at its stage with its score. Telegram only fires for score ≥ ALERT_MIN
   *    or a reach entry — low-score cards are page-only.
   * At most one open card per coin+timeframe, so a low-score watch flips in place to a
   * higher score / reach — no duplicate cards.
   */
  /**
   * PA trend of the timeframe ABOVE the one being scanned — the context that separates a
   * pullback from a knife. Only CLOSED higher-TF candles are used (a 4h scan runs while the
   * D1 candle is still forming), so the read never repaints. Falls back to 'Neutral' — a
   * young coin without weekly history shouldn't be scored as if the HTF were bearish.
   */
  private async htfTrend(symbol: string, timeframe: string, now: number): Promise<PaTrend> {
    const htf = HTF_OF[timeframe];
    if (!htf) return 'Neutral';
    const klines = await this.binance.fetchKlines({
      symbol: `${symbol}USDT`,
      timeframe: htf.tf as never,
      limit: HTF_CANDLE_LIMIT,
    });
    const closed = klines.filter((k) => Number(k[6]) <= now);
    if (closed.length < 20) return 'Neutral';
    return computeTimeframeTrend(
      closed.map((k) => parseFloat(k[4])),
      closed.map((k) => parseFloat(k[2])),
      closed.map((k) => parseFloat(k[3])),
    );
  }

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
    const lows = closed.map((k) => parseFloat(k[3]));
    const closeTimes = closed.map((k) => Number(k[6]));
    const lastClose = closes[closes.length - 1]!;
    const lastCloseTime = closeTimes[closeTimes.length - 1]!;

    const htf = HTF_OF[timeframe] ?? { tf: '1d', label: 'D1' };
    const setup = scoreEmaStackOversoldSetup(closes, {
      highs,
      lows,
      htfTrend: await this.htfTrend(symbol, timeframe, now),
      htfLabel: htf.label,
    });
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

      // A never-reached near card whose setup fully faded (and not in profit) → expire it.
      if (!setup && sig.stage === 'near' && pnlPct <= 0) {
        await this.repo.expireSignal(sig.id);
        continue;
      }

      const score = setup?.score ?? sig.score ?? 0;
      const reasonNote = setup ? noteOf(setup.reasons) : sig.note ?? '';

      // Stage progression — monotonic (near → reach → risk).
      const curRank = STAGE_RANK[sig.stage] ?? STAGE_RANK.reach!;
      let nextStage: Stage = sig.stage as Stage;
      let nextNote = reasonNote;
      if (lastClose >= sig.tpPrice * (1 - RISK_BAND)) {
        nextStage = 'risk';
        nextNote = `Giá +${pnlPct.toFixed(1)}% — gần chạm TP +10%`;
      } else if (setup && setup.stage === 'reach') {
        nextStage = 'reach';
        nextNote = noteOf(setup.reasons);
      }
      const advanced = (STAGE_RANK[nextStage] ?? 0) > curRank;
      const heatedUp = !advanced && nextStage === 'near' && (sig.score ?? 0) < ALERT_MIN_SCORE && score >= ALERT_MIN_SCORE;

      await this.repo.updateSignalMark(sig.id, {
        currentPrice: lastClose,
        pnlPct: Number(pnlPct.toFixed(2)),
        score,
        note: nextNote,
        stage: advanced ? nextStage : undefined,
        // PA moves while a card is open — keep the badge in sync with the score it fed.
        htfTrend: setup?.htfTrend,
        swingStructure: setup?.swingStructure,
      });

      if (advanced || heatedUp) {
        const alertStage = advanced ? nextStage : 'near';
        if (advanced) this.logger.log(`EMA-bounce ${symbol} (${timeframe}) ${sig.stage} → ${nextStage} (score ${score})`);
        await this.notifyStage(symbol, timeframe, alertStage, {
          price: lastClose,
          tpPrice: sig.tpPrice,
          distPct: sig.distPct,
          rsi: sig.rsi ?? 0,
          stochK: sig.stochK ?? 0,
          stochD: sig.stochD ?? 0,
          pnlPct,
          score,
          note: nextNote,
          pa: setup ? formatEmaStackPa(setup) : null,
        });
      }
    }

    // 2) No open card yet → create one at its detected stage + score.
    if (openSignals.length === 0 && setup) {
      const note = noteOf(setup.reasons);
      const res = await this.repo.createSignalIfNew(coinId, {
        symbol,
        timeframe,
        triggeredAt: new Date(lastCloseTime),
        stage: setup.stage,
        note,
        score: setup.score,
        htfTrend: setup.htfTrend,
        swingStructure: setup.swingStructure,
        entryPrice: setup.price,
        tpPrice: setup.tpPrice,
        distPct: setup.distPct,
        rsi: setup.rsi,
        stochK: setup.stochK,
        stochD: setup.stochD,
        ema34: setup.ema34,
        ema89: setup.ema89,
        ema200: setup.ema200,
        currentPrice: setup.price,
        pnlPct: 0,
      });
      if (res.created) {
        this.logger.log(`EMA-bounce ${setup.stage} ${setup.score}đ (${timeframe}): ${symbol} @ ${setup.price} (dist -${(setup.distPct * 100).toFixed(1)}%)`);
        if (setup.score >= ALERT_MIN_SCORE || setup.stage === 'reach') {
          await this.notifyStage(symbol, timeframe, setup.stage, {
            price: setup.price,
            tpPrice: setup.tpPrice,
            distPct: setup.distPct,
            rsi: setup.rsi,
            stochK: setup.stochK,
            stochD: setup.stochD,
            pnlPct: 0,
            score: setup.score,
            note,
            pa: formatEmaStackPa(setup),
          });
        }
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
    m: { price: number; tpPrice: number; distPct: number; rsi: number; stochK: number; stochD: number; pnlPct: number; score: number; note: string; pa?: string | null },
  ): Promise<void> {
    try {
      const chatId = process.env.TELEGRAM_CHAT_ID ?? '';
      if (!chatId) return;
      const tf = tfLabel(timeframe);
      let lines: string[];
      if (stage === 'near') {
        lines = [
          `⏳ <b>GẦN THOẢ MÃN · ${symbol}</b> (${tf}) · <b>${m.score}đ</b>`,
          `Giá: <b>${fmtPrice(m.price)}</b> · cách EMA34 <b>-${(m.distPct * 100).toFixed(1)}%</b>`,
          `StochRSI: <b>${stochLabel(m.stochK, m.stochD)}</b> (${m.stochK.toFixed(1)}/${m.stochD.toFixed(1)})`,
          ...(m.pa ? [`📊 ${m.pa}`] : []),
          `📝 ${m.note}`,
          `👀 Chưa vào — mở chart xem có nên chờ không.`,
        ];
      } else if (stage === 'reach') {
        lines = [
          `🟢 <b>THOẢ MÃN · ${symbol}</b> (${tf}) · <b>${m.score}đ</b>`,
          `Vào LONG: <b>${fmtPrice(m.price)}</b>`,
          `Cách EMA34: <b>-${(m.distPct * 100).toFixed(1)}%</b> (dưới cụm EMA34&lt;89&lt;200)`,
          `RSI ${m.rsi.toFixed(1)} · StochRSI: <b>${stochLabel(m.stochK, m.stochD)}</b> (${m.stochK.toFixed(1)}/${m.stochD.toFixed(1)})`,
          ...(m.pa ? [`📊 ${m.pa}`] : []),
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
