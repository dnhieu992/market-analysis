import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  scoreEmaStackOversoldSetup,
  EMA_STACK_OVERSOLD_MIN_CANDLES,
  extractSupportAndResistanceLevels,
} from '@app/core';
import { createEmaStochScannerRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { renderEmaBounceChart, type OhlcCandle } from './chart-renderer';

const CANDLE_LIMIT = 300;

// How many candles to show in the "view chart" dialog. Centered on the setup
// candle when a focus time is provided, otherwise the most recent ones.
const CHART_DISPLAY_CANDLES = 140;

/** Standard EMA series aligned 1:1 with `closes` (NaN before it has enough data). */
function computeEmaSeries(closes: number[], period: number): number[] {
  const smoothing = 2 / (period + 1);
  const result: number[] = [];
  let ema = 0;

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    if (i === period - 1) {
      ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    } else {
      ema = closes[i]! * smoothing + ema * (1 - smoothing);
    }
    result.push(Number(ema.toFixed(8)));
  }

  return result;
}

export type EmaStochSignalDto = {
  id: string;
  symbol: string;
  timeframe: string;
  status: string;
  stage: string;
  note: string | null;
  score: number;
  triggeredAt: string;
  entryPrice: number;
  tpPrice: number;
  distPct: number;
  rsi: number | null;
  stochK: number | null;
  stochD: number | null;
  ema34: number | null;
  ema89: number | null;
  ema200: number | null;
  currentPrice: number | null;
  pnlPct: number | null;
  hitTpAt: string | null;
  lastCheckedAt: string | null;
};

@Injectable()
export class EmaStochScannerService {
  private readonly logger = new Logger(EmaStochScannerService.name);
  private readonly repo = createEmaStochScannerRepository();

  constructor(private readonly binance: BinanceMarketDataService) {}

  async listCoins() {
    const rows = await this.repo.findAllCoins();
    return rows.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, addedAt: c.addedAt.toISOString() }));
  }

  async addCoin(symbol: string, name?: string) {
    const upper = symbol.trim().toUpperCase().replace(/USDT$/, '');
    const coin = await this.repo.addCoin(upper, name ?? '');
    return { id: coin.id, symbol: coin.symbol, name: coin.name, addedAt: coin.addedAt.toISOString() };
  }

  async removeCoin(symbol: string) {
    const upper = symbol.trim().toUpperCase();
    const existing = await this.repo.findCoinBySymbol(upper);
    if (!existing) throw new NotFoundException(`Coin ${upper} not found`);
    await this.repo.removeCoin(upper);
  }

  /** List persisted signal cards (worker-produced), newest first. */
  async listSignals(onlyOpen = false): Promise<EmaStochSignalDto[]> {
    const rows = await this.repo.findSignals(onlyOpen);
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      timeframe: r.timeframe,
      status: r.status,
      stage: r.stage,
      note: r.note ?? null,
      score: r.score ?? 0,
      triggeredAt: r.triggeredAt.toISOString(),
      entryPrice: r.entryPrice,
      tpPrice: r.tpPrice,
      distPct: r.distPct,
      rsi: r.rsi ?? null,
      stochK: r.stochK ?? null,
      stochD: r.stochD ?? null,
      ema34: r.ema34 ?? null,
      ema89: r.ema89 ?? null,
      ema200: r.ema200 ?? null,
      currentPrice: r.currentPrice ?? null,
      pnlPct: r.pnlPct ?? null,
      hitTpAt: r.hitTpAt ? r.hitTpAt.toISOString() : null,
      lastCheckedAt: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null,
    }));
  }

  /**
   * Live, non-persisting check: run the detector on the last CLOSED candle of BOTH the
   * 4h and 1d timeframes for every watched coin, returning the coins that match right now
   * (each match tagged with its timeframe). Cards/Telegram are only produced by the worker
   * crons — this is just an immediate preview.
   */
  async preview() {
    const coins = await this.repo.findAllCoins();
    const now = Date.now();
    const timeframes = ['4h', '1d'];
    const matches: Array<{
      symbol: string; timeframe: string; stage: string; note: string; score: number; price: number; tpPrice: number; distPct: number;
      rsi: number; stochK: number; stochD: number; ema34: number; ema89: number; ema200: number;
    }> = [];
    let scanned = 0;
    let failed = 0;

    for (const coin of coins) {
      for (const tf of timeframes) {
        try {
          const klines = await this.binance.fetchKlines({ symbol: `${coin.symbol}USDT`, timeframe: tf as never, limit: CANDLE_LIMIT });
          scanned++;
          const closed = klines.filter((k) => Number(k[6]) <= now);
          if (closed.length < EMA_STACK_OVERSOLD_MIN_CANDLES) continue;
          const closes = closed.map((k) => parseFloat(k[4]));
          const setup = scoreEmaStackOversoldSetup(closes);
          if (setup) {
            matches.push({
              symbol: coin.symbol,
              timeframe: tf,
              stage: setup.stage,
              note: setup.reasons.join(' • '),
              score: setup.score,
              price: setup.price,
              tpPrice: setup.tpPrice,
              distPct: setup.distPct,
              rsi: setup.rsi,
              stochK: setup.stochK,
              stochD: setup.stochD,
              ema34: setup.ema34,
              ema89: setup.ema89,
              ema200: setup.ema200,
            });
          }
        } catch (err) {
          failed++;
          this.logger.warn(`preview (${tf}) failed for ${coin.symbol}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return { scannedAt: new Date().toISOString(), scanned, failed, matches };
  }

  /**
   * Renders a full-indicator PNG chart (EMA34/89/200 + S/R + optional entry/TP
   * lines) for the given symbol/timeframe. When `focusTime` is supplied the
   * visible window is centered on the candle that satisfied the setup so the
   * "vùng giá thoả mãn" sits in the middle; otherwise the latest candles show.
   */
  async generateChart(params: {
    symbol: string;
    timeframe: string;
    focusTime?: number | null;
    entry?: number | null;
    tp?: number | null;
  }): Promise<Buffer> {
    const bare = params.symbol.trim().toUpperCase().replace(/USDT$/, '');
    const pair = `${bare}USDT`;
    const timeframe = params.timeframe === '1d' ? '1d' : '4h';

    const klines = await this.binance.fetchKlines({
      symbol: pair,
      timeframe: timeframe as never,
      limit: CANDLE_LIMIT,
    });
    if (klines.length === 0) {
      throw new NotFoundException(`No candles for ${pair} ${timeframe}`);
    }

    const candles: OhlcCandle[] = klines.map((k) => ({
      time: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));

    const closes = candles.map((c) => c.close);
    const ema34Full = computeEmaSeries(closes, 34);
    const ema89Full = computeEmaSeries(closes, 89);
    const ema200Full = computeEmaSeries(closes, 200);

    // Locate the candle whose window contains `focusTime` (falls back to nearest
    // open ≤ focusTime). null → no valid focus, show the latest candles.
    let fullFocusIdx: number | null = null;
    if (params.focusTime != null && Number.isFinite(params.focusTime)) {
      const t = params.focusTime;
      const closeTimes = klines.map((k) => Number(k[6]));
      for (let i = 0; i < candles.length; i++) {
        if (t >= candles[i]!.time && t <= closeTimes[i]!) {
          fullFocusIdx = i;
          break;
        }
        if (candles[i]!.time <= t) fullFocusIdx = i;
      }
    }

    // Build the display window, centered on the focus candle when present.
    let startIdx: number;
    if (fullFocusIdx != null) {
      startIdx = Math.round(fullFocusIdx - CHART_DISPLAY_CANDLES / 2);
    } else {
      startIdx = candles.length - CHART_DISPLAY_CANDLES;
    }
    startIdx = Math.max(0, Math.min(startIdx, Math.max(0, candles.length - CHART_DISPLAY_CANDLES)));
    const endIdx = Math.min(candles.length, startIdx + CHART_DISPLAY_CANDLES);

    const displayCandles = candles.slice(startIdx, endIdx);
    const ema34 = ema34Full.slice(startIdx, endIdx);
    const ema89 = ema89Full.slice(startIdx, endIdx);
    const ema200 = ema200Full.slice(startIdx, endIdx);
    const focusIndex = fullFocusIdx != null ? fullFocusIdx - startIdx : null;

    const { supportLevels, resistanceLevels } = extractSupportAndResistanceLevels(displayCandles, 2);
    const currentPrice = candles[candles.length - 1]!.close;

    return renderEmaBounceChart({
      symbol: pair,
      timeframe: timeframe === '1d' ? 'D1' : 'H4',
      candles: displayCandles,
      ema34,
      ema89,
      ema200,
      supportLevels: supportLevels.filter(Number.isFinite),
      resistanceLevels: resistanceLevels.filter(Number.isFinite),
      currentPrice,
      entryPrice: params.entry ?? null,
      tpPrice: params.tp ?? null,
      focusIndex,
    });
  }
}
