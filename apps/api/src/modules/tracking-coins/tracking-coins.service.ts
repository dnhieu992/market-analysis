import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { computeSmallCapSignal, computeTimeframeTrend, computeLongShortScore, calculateEma, calculateRsi, calculateVolumeRatio, calcUtBotResult } from '@app/core';
import type { PaTrend } from '@app/core';
import { createTrackingCoinsRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

const CANDLE_LIMIT = 220;


export type OrderSuggestionResult = {
  side: 'LONG' | 'SHORT';
  entryLow: number;
  entryHigh: number;
  tp1: number;
  tp2: number | null;
  sl: number;
  rrRatio: number;
  rationale: string;
};

export type OrderSuggestionsResult = {
  symbol: string;
  currentPrice: number;
  swing: OrderSuggestionResult;
  scalp: OrderSuggestionResult;
  generatedAt: string;
};

export type TrackingCoinWithSignal = {
  id: string;
  symbol: string;
  name: string;
  addedAt: Date;
  signal: {
    rsi: number | null;
    volMultiplier: number | null;
    ema34Above: boolean;
    ema89Above: boolean;
    ema200Above: boolean;
    h4Ema34Above: boolean | null;
    h4Ema89Above: boolean | null;
    h4Ema200Above: boolean | null;
    utBotD1Bullish: boolean | null;
    utBotH4Bullish: boolean | null;
    h4Rsi: number | null;
    h4VolMultiplier: number | null;
    longScore: number | null;
    shortScore: number | null;
    signalScore: number;
    sparkline: number[];
    trend: string;
    h4Trend: string;
    m30Trend: string;
    swingStructure: string;
    scannedAt: Date;
  } | null;
};

@Injectable()
export class TrackingCoinsService {
  private readonly logger = new Logger(TrackingCoinsService.name);
  private readonly repo = createTrackingCoinsRepository();

  constructor(private readonly binance: BinanceMarketDataService) {}

  async listCoins(): Promise<TrackingCoinWithSignal[]> {
    const rows = await this.repo.findCoinsWithLatestSignal();
    return rows.map((coin) => {
      const sig = coin.signals[0] ?? null;
      return {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        addedAt: coin.addedAt,
        signal: sig
          ? {
              rsi: sig.rsi,
              volMultiplier: sig.volMultiplier,
              ema34Above: sig.ema34Above,
              ema89Above: sig.ema89Above,
              ema200Above: sig.ema200Above,
              h4Ema34Above: sig.h4Ema34Above,
              h4Ema89Above: sig.h4Ema89Above,
              h4Ema200Above: sig.h4Ema200Above,
              utBotD1Bullish: sig.utBotD1Bullish,
              utBotH4Bullish: sig.utBotH4Bullish,
              h4Rsi: sig.h4Rsi,
              h4VolMultiplier: sig.h4VolMultiplier,
              longScore: sig.longScore,
              shortScore: sig.shortScore,
              signalScore: sig.signalScore,
              sparkline: this.parseSparkline(sig.sparklineJson),
              trend: sig.trend,
              h4Trend: sig.h4Trend,
              m30Trend: sig.m30Trend,
              swingStructure: sig.swingStructure,
              scannedAt: sig.scannedAt,
            }
          : null,
      };
    });
  }

  async addCoin(symbol: string, name?: string): Promise<{ id: string; symbol: string; name: string }> {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.addCoin(upper, name ?? '');
    return { id: coin.id, symbol: coin.symbol, name: coin.name };
  }

  async removeCoin(symbol: string): Promise<void> {
    const upper = symbol.toUpperCase();
    const existing = await this.repo.findCoinBySymbol(upper);
    if (!existing) throw new NotFoundException(`Coin ${upper} not found`);
    await this.repo.removeCoin(upper);
  }

  async listJournal(symbol: string) {
    const coin = await this.repo.findCoinBySymbol(symbol.toUpperCase());
    if (!coin) throw new NotFoundException(`Coin ${symbol.toUpperCase()} not found`);
    const entries = await this.repo.findJournalByCoin(coin.id);
    return entries.map((e) => ({
      id: e.id,
      date: e.date.toISOString().slice(0, 10),
      content: e.content,
      updatedAt: e.updatedAt.toISOString(),
    }));
  }

  async upsertJournalEntry(symbol: string, date: string, content: string) {
    const coin = await this.repo.findCoinBySymbol(symbol.toUpperCase());
    if (!coin) throw new NotFoundException(`Coin ${symbol.toUpperCase()} not found`);
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    const entry = await this.repo.upsertJournalEntry(coin.id, d, content);
    return {
      id: entry.id,
      date: entry.date.toISOString().slice(0, 10),
      content: entry.content,
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  async triggerScan(): Promise<{ scanned: number; failed: number }> {
    const coins = await this.repo.findAllCoins();
    let scanned = 0;
    let failed = 0;

    for (const coin of coins) {
      try {
        await this.scanOneCoin(coin.id, coin.symbol);
        scanned++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`scan failed for ${coin.symbol}: ${msg}`);
      }
    }

    return { scanned, failed };
  }

  async suggestOrders(symbol: string): Promise<OrderSuggestionsResult> {
    const upper = symbol.toUpperCase();
    const coins = await this.repo.findCoinsWithLatestSignal();
    const coin = coins.find((c) => c.symbol === upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);

    const sig = coin.signals[0] ?? null;
    const sparkline = sig ? this.parseSparkline(sig.sparklineJson) : [];

    let currentPrice: number;
    try {
      currentPrice = await this.binance.fetchCurrentPrice(`${upper}USDT`);
    } catch {
      currentPrice = sparkline.length > 0 ? sparkline[sparkline.length - 1]! : 0;
    }

    const swing = this.computeSwingOrder(currentPrice, sparkline, sig);
    const scalp = this.computeScalpOrder(currentPrice, sparkline, sig);

    return { symbol: upper, currentPrice, swing, scalp, generatedAt: new Date().toISOString() };
  }

  private detectSwingLevels(prices: number[], window = 3): { highs: number[]; lows: number[] } {
    const rawHighs: number[] = [];
    const rawLows: number[] = [];
    for (let i = window; i < prices.length - window; i++) {
      const slice = prices.slice(i - window, i + window + 1);
      const max = Math.max(...slice);
      const min = Math.min(...slice);
      if (prices[i]! >= max) rawHighs.push(prices[i]!);
      if (prices[i]! <= min) rawLows.push(prices[i]!);
    }
    return { highs: this.clusterLevels(rawHighs), lows: this.clusterLevels(rawLows) };
  }

  private clusterLevels(levels: number[], threshold = 0.015): number[] {
    if (levels.length === 0) return [];
    const sorted = [...levels].sort((a, b) => a - b);
    const result: number[] = [sorted[0]!];
    for (let i = 1; i < sorted.length; i++) {
      const prev = result[result.length - 1]!;
      const curr = sorted[i]!;
      if (Math.abs(curr - prev) / prev > threshold) {
        result.push(curr);
      } else {
        result[result.length - 1] = (prev + curr) / 2;
      }
    }
    return result;
  }

  private determineSide(
    tf: 'D1' | 'H4',
    sig: { trend: string; utBotD1Bullish: boolean | null; longScore: number | null; shortScore: number | null; h4Trend: string; utBotH4Bullish: boolean | null; m30Trend: string } | null,
  ): 'LONG' | 'SHORT' {
    if (!sig) return 'LONG';
    if (tf === 'D1') {
      const ls = sig.longScore ?? 0;
      const ss = sig.shortScore ?? 0;
      if (ls !== ss) return ls > ss ? 'LONG' : 'SHORT';
      if (sig.utBotD1Bullish != null) return sig.utBotD1Bullish ? 'LONG' : 'SHORT';
      const t = sig.trend.toLowerCase();
      return (t.includes('bull') || t.includes('up')) ? 'LONG' : 'SHORT';
    } else {
      if (sig.utBotH4Bullish != null) return sig.utBotH4Bullish ? 'LONG' : 'SHORT';
      const t = sig.h4Trend.toLowerCase();
      if (t.includes('bull') || t.includes('up')) return 'LONG';
      if (t.includes('bear') || t.includes('down')) return 'SHORT';
      const t30 = sig.m30Trend.toLowerCase();
      return (t30.includes('bull') || t30.includes('up')) ? 'LONG' : 'SHORT';
    }
  }

  private buildRationale(
    side: 'LONG' | 'SHORT',
    tf: 'D1' | 'H4',
    sig: { trend: string; utBotD1Bullish: boolean | null; ema200Above: boolean; rsi: number | null; swingStructure: string; h4Trend: string; utBotH4Bullish: boolean | null; h4Rsi: number | null; m30Trend: string } | null,
  ): string {
    const base = side === 'LONG' ? 'Entry tại vùng hỗ trợ' : 'Entry tại vùng kháng cự';
    if (!sig) return `${base}.`;
    const parts: string[] = [];
    if (tf === 'D1') {
      parts.push(`D1 ${sig.trend}`);
      if (sig.utBotD1Bullish === true) parts.push('UT Bot D1 bullish');
      if (sig.utBotD1Bullish === false) parts.push('UT Bot D1 bearish');
      if (side === 'LONG' && sig.ema200Above) parts.push('trên EMA200');
      if (side === 'SHORT' && !sig.ema200Above) parts.push('dưới EMA200');
      if (sig.rsi != null && side === 'LONG' && sig.rsi < 40) parts.push(`RSI (${Math.round(sig.rsi)})`);
      if (sig.rsi != null && side === 'SHORT' && sig.rsi > 65) parts.push(`RSI (${Math.round(sig.rsi)})`);
      if (sig.swingStructure) parts.push(`swing ${sig.swingStructure}`);
    } else {
      parts.push(`H4 ${sig.h4Trend}`);
      if (sig.utBotH4Bullish === true) parts.push('UT Bot H4 bullish');
      if (sig.utBotH4Bullish === false) parts.push('UT Bot H4 bearish');
      if (sig.m30Trend) parts.push(`M30 ${sig.m30Trend}`);
      if (sig.h4Rsi != null && side === 'LONG' && sig.h4Rsi < 40) parts.push(`H4 RSI (${Math.round(sig.h4Rsi)})`);
      if (sig.h4Rsi != null && side === 'SHORT' && sig.h4Rsi > 65) parts.push(`H4 RSI (${Math.round(sig.h4Rsi)})`);
    }
    return `${base}. ${parts.filter(Boolean).join(', ')}.`;
  }

  private computeSwingOrder(
    currentPrice: number,
    sparkline: number[],
    sig: Parameters<TrackingCoinsService['determineSide']>[1] & Parameters<TrackingCoinsService['buildRationale']>[2],
  ): OrderSuggestionResult {
    const { highs, lows } = this.detectSwingLevels(sparkline);
    const side = this.determineSide('D1', sig);
    const rationale = this.buildRationale(side, 'D1', sig);

    if (side === 'LONG') {
      const supports = lows.filter(l => l < currentPrice * 0.998).sort((a, b) => b - a);
      const resistances = highs.filter(h => h > currentPrice * 1.002).sort((a, b) => a - b);
      const pivot = supports[0] ?? currentPrice * 0.96;
      const entryLow = pivot * 0.995;
      const entryHigh = pivot * 1.005;
      const entryMid = (entryLow + entryHigh) / 2;
      const tp1 = resistances[0] ?? currentPrice * 1.08;
      const tp2 = resistances[1] ?? null;
      const sl = Math.min(supports[1] ?? entryLow * 0.985, entryLow * 0.99);
      const rrRatio = Math.max((tp1 - entryMid) / (entryMid - sl), 0.1);
      return { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale };
    } else {
      const resistances = highs.filter(h => h > currentPrice * 1.002).sort((a, b) => a - b);
      const supports = lows.filter(l => l < currentPrice * 0.998).sort((a, b) => b - a);
      const pivot = resistances[0] ?? currentPrice * 1.04;
      const entryLow = pivot * 0.995;
      const entryHigh = pivot * 1.005;
      const entryMid = (entryLow + entryHigh) / 2;
      const tp1 = supports[0] ?? currentPrice * 0.92;
      const tp2 = supports[1] ?? null;
      const sl = Math.max(resistances[1] ?? entryHigh * 1.015, entryHigh * 1.01);
      const rrRatio = Math.max((entryMid - tp1) / (sl - entryMid), 0.1);
      return { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale };
    }
  }

  private computeScalpOrder(
    currentPrice: number,
    sparkline: number[],
    sig: Parameters<TrackingCoinsService['determineSide']>[1] & Parameters<TrackingCoinsService['buildRationale']>[2],
  ): OrderSuggestionResult {
    const recent = sparkline.slice(-10);
    const { highs, lows } = this.detectSwingLevels(recent.length >= 7 ? recent : sparkline, 2);
    const side = this.determineSide('H4', sig);
    const rationale = this.buildRationale(side, 'H4', sig);

    if (side === 'LONG') {
      const supports = lows.filter(l => l < currentPrice * 0.998).sort((a, b) => b - a);
      const resistances = highs.filter(h => h > currentPrice * 1.002).sort((a, b) => a - b);
      const pivot = supports[0] ?? currentPrice * 0.985;
      const entryLow = pivot * 0.997;
      const entryHigh = pivot * 1.003;
      const entryMid = (entryLow + entryHigh) / 2;
      const tp1 = resistances[0] ?? currentPrice * 1.03;
      const tp2 = resistances[1] ?? null;
      const sl = Math.min(supports[1] ?? entryLow * 0.993, entryLow * 0.993);
      const rrRatio = Math.max((tp1 - entryMid) / (entryMid - sl), 0.1);
      return { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale };
    } else {
      const resistances = highs.filter(h => h > currentPrice * 1.002).sort((a, b) => a - b);
      const supports = lows.filter(l => l < currentPrice * 0.998).sort((a, b) => b - a);
      const pivot = resistances[0] ?? currentPrice * 1.015;
      const entryLow = pivot * 0.997;
      const entryHigh = pivot * 1.003;
      const entryMid = (entryLow + entryHigh) / 2;
      const tp1 = supports[0] ?? currentPrice * 0.97;
      const tp2 = supports[1] ?? null;
      const sl = Math.max(resistances[1] ?? entryHigh * 1.007, entryHigh * 1.007);
      const rrRatio = Math.max((entryMid - tp1) / (sl - entryMid), 0.1);
      return { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale };
    }
  }

  private async scanOneCoin(coinId: string, symbol: string): Promise<void> {
    const binanceSymbol = `${symbol}USDT`;

    const [klines, h4Klines, m30Klines] = await Promise.all([
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '1d', limit: CANDLE_LIMIT }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: '4h', limit: 200 }),
      this.binance.fetchKlines({ symbol: binanceSymbol, timeframe: 'M30', limit: 300 }),
    ]);

    if (klines.length < 210) return;

    const closes = klines.map((k) => parseFloat(k[4]));
    const highs = klines.map((k) => parseFloat(k[2]));
    const lows = klines.map((k) => parseFloat(k[3]));
    const volumes = klines.map((k) => parseFloat(k[5]));

    const result = computeSmallCapSignal(closes, highs, lows, volumes);
    if (!result) return;

    const h4Trend = h4Klines.length >= 20
      ? computeTimeframeTrend(
          h4Klines.map((k) => parseFloat(k[4])),
          h4Klines.map((k) => parseFloat(k[2])),
          h4Klines.map((k) => parseFloat(k[3])),
        )
      : 'Neutral';

    const m30Trend = m30Klines.length >= 20
      ? computeTimeframeTrend(
          m30Klines.map((k) => parseFloat(k[4])),
          m30Klines.map((k) => parseFloat(k[2])),
          m30Klines.map((k) => parseFloat(k[3])),
        )
      : 'Neutral';

    // H4 indicators
    const h4Closes = h4Klines.map((k) => parseFloat(k[4]));
    const h4Highs  = h4Klines.map((k) => parseFloat(k[2]));
    const h4Lows   = h4Klines.map((k) => parseFloat(k[3]));
    const h4LastClose = h4Closes[h4Closes.length - 1] ?? 0;

    const h4Ema34Above  = h4Closes.length >= 34  ? h4LastClose > calculateEma(h4Closes, 34)  : null;
    const h4Ema89Above  = h4Closes.length >= 89  ? h4LastClose > calculateEma(h4Closes, 89)  : null;
    const h4Ema200Above = h4Closes.length >= 200 ? h4LastClose > calculateEma(h4Closes, 200) : null;
    const h4Volumes = h4Klines.map((k) => parseFloat(k[5]));
    const h4Rsi           = h4Closes.length > 14 ? calculateRsi(h4Closes, 14) : null;
    const h4VolMultiplier = h4Volumes.length >= 20 ? calculateVolumeRatio(h4Volumes, 20) : null;

    // UT Bot D1
    const d1Candles = closes.map((c, i) => ({ open: c, high: highs[i]!, low: lows[i]!, close: c }));
    const utBotD1 = calcUtBotResult(d1Candles, 1, 3);
    const utBotD1Bullish = utBotD1?.uptrend ?? null;

    // UT Bot H4
    const h4Candles = h4Closes.length >= 2
      ? h4Closes.map((c, i) => ({ open: c, high: h4Highs[i]!, low: h4Lows[i]!, close: c }))
      : [];
    const utBotH4 = h4Candles.length >= 2 ? calcUtBotResult(h4Candles, 1, 3) : null;
    const utBotH4Bullish = utBotH4?.uptrend ?? null;

    const { longScore, shortScore } = computeLongShortScore({
      closes,
      highs,
      lows,
      rsi: result.rsi,
      volMultiplier: result.volMultiplier,
      ema34Above: result.ema34Above,
      ema89Above: result.ema89Above,
      ema200Above: result.ema200Above,
      d1Trend: result.trend as PaTrend,
      h4Trend: h4Trend as PaTrend,
      m30Trend: m30Trend as PaTrend,
      sparkline: result.sparkline,
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await this.repo.upsertSignal(coinId, today, {
      rsi: result.rsi,
      volMultiplier: result.volMultiplier,
      ema34Above: result.ema34Above,
      ema89Above: result.ema89Above,
      ema200Above: result.ema200Above,
      stage: result.stage,
      signalScore: result.signalScore,
      sparklineJson: JSON.stringify(result.sparkline),
      trend: result.trend,
      h4Trend,
      m30Trend,
      swingStructure: result.swingStructure,
      longScore,
      shortScore,
      h4Ema34Above,
      h4Ema89Above,
      h4Ema200Above,
      utBotD1Bullish,
      utBotH4Bullish,
      h4Rsi,
      h4VolMultiplier,
    });
  }

  private parseSparkline(json: string): number[] {
    try {
      return JSON.parse(json) as number[];
    } catch {
      return [];
    }
  }
}
