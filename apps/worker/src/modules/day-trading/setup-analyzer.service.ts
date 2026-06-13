import { Injectable, Logger } from '@nestjs/common';
import type { Candle } from './bitget.service';

export type SetupResult = {
  setupType: 'BREAK_RETEST' | 'LIQUIDITY_SWEEP';
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rrRatio: number;
  riskAmount: number;     // hard loss budget in USD if SL is hit
  quantity: number;       // position size (volume) in base asset (BTC)
  positionValue: number;  // notional in USD = quantity * entryPrice
  setupJson: string;
};

type Trend = 'up' | 'down' | 'neutral';

// Per-scan risk configuration (loaded from DayTradingSettings).
export type RiskConfig = {
  riskPerTrade: number; // hard loss budget in USDT if SL is hit
  minRR: number;        // minimum reward in R — TP must be at least this many R away
};

const DEFAULT_RISK: RiskConfig = { riskPerTrade: 2, minRR: 2 };

@Injectable()
export class SetupAnalyzerService {
  private readonly logger = new Logger(SetupAnalyzerService.name);

  analyze(
    candles15m: Candle[],
    candles1h: Candle[],
    candles4h: Candle[],
    config: RiskConfig = DEFAULT_RISK,
  ): SetupResult | null {
    if (candles15m.length < 30 || candles1h.length < 20 || candles4h.length < 10) {
      this.logger.warn('Insufficient candle data for analysis');
      return null;
    }

    const trend4h = this.detectTrend(candles4h.slice(-20));
    const trend1h = this.detectTrend(candles1h.slice(-20));

    // Collects per-setup rejection reasons for DEBUG visibility.
    const reasons: string[] = [];

    // Try Liquidity Sweep first (cleaner signal)
    const sweep = this.detectLiquiditySweep(candles15m, candles1h, trend4h, trend1h, reasons, config);
    if (sweep) return sweep;

    // Then Break & Retest
    const breakRetest = this.detectBreakRetest(candles15m, candles1h, candles4h, trend4h, trend1h, reasons, config);
    if (breakRetest) return breakRetest;

    const latest = candles15m.at(-1);
    const avg20 = this.avgVolume(candles15m, 20);
    const volMult = latest && avg20 > 0 ? (latest.volume / avg20).toFixed(2) : 'n/a';
    this.logger.debug(
      `Reject @ price=${latest?.close ?? '?'} trend4H=${trend4h} trend1H=${trend1h} vol=${volMult}x | ` +
        reasons.join(' ; '),
    );
    return null;
  }

  private detectTrend(candles: Candle[]): Trend {
    const swingHighs: number[] = [];
    const swingLows: number[] = [];

    for (let i = 2; i < candles.length - 2; i++) {
      const c = candles[i];
      const p1 = candles[i - 1];
      const p2 = candles[i - 2];
      const n1 = candles[i + 1];
      const n2 = candles[i + 2];
      if (!c || !p1 || !p2 || !n1 || !n2) continue;
      if (c.high > p1.high && c.high > p2.high && c.high > n1.high && c.high > n2.high) {
        swingHighs.push(c.high);
      }
      if (c.low < p1.low && c.low < p2.low && c.low < n1.low && c.low < n2.low) {
        swingLows.push(c.low);
      }
    }

    if (swingHighs.length < 2 || swingLows.length < 2) return 'neutral';

    const ph1 = swingHighs.at(-2)!;
    const ph2 = swingHighs.at(-1)!;
    const pl1 = swingLows.at(-2)!;
    const pl2 = swingLows.at(-1)!;

    if (ph2 > ph1 && pl2 > pl1) return 'up';
    if (ph2 < ph1 && pl2 < pl1) return 'down';
    return 'neutral';
  }

  private yn(v: boolean): string {
    return v ? 'Y' : 'N';
  }

  private avgVolume(candles: Candle[], n: number): number {
    const slice = candles.slice(-n - 1, -1);
    if (!slice.length) return 0;
    return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
  }

  private getSwingHighs(candles: Candle[], lookback: number): number[] {
    const result: number[] = [];
    const slice = candles.slice(-lookback);
    for (let i = 3; i < slice.length - 1; i++) {
      const curr = slice[i];
      const p1 = slice[i - 1];
      const p2 = slice[i - 2];
      const p3 = slice[i - 3];
      const n1 = slice[i + 1];
      if (!curr || !p1 || !p2 || !p3 || !n1) continue;
      if (curr.high > p1.high && curr.high > p2.high && curr.high > p3.high && curr.high > n1.high) {
        result.push(curr.high);
      }
    }
    return result;
  }

  private getSwingLows(candles: Candle[], lookback: number): number[] {
    const result: number[] = [];
    const slice = candles.slice(-lookback);
    for (let i = 3; i < slice.length - 1; i++) {
      const curr = slice[i];
      const p1 = slice[i - 1];
      const p2 = slice[i - 2];
      const p3 = slice[i - 3];
      const n1 = slice[i + 1];
      if (!curr || !p1 || !p2 || !p3 || !n1) continue;
      if (curr.low < p1.low && curr.low < p2.low && curr.low < p3.low && curr.low < n1.low) {
        result.push(curr.low);
      }
    }
    return result;
  }

  private isBearishEngulfing(prev: Candle, curr: Candle): boolean {
    return curr.close < curr.open && prev.close > prev.open && curr.open >= prev.close && curr.close <= prev.open;
  }

  private isBullishEngulfing(prev: Candle, curr: Candle): boolean {
    return curr.close > curr.open && prev.close < prev.open && curr.open <= prev.close && curr.close >= prev.open;
  }

  private hasLongUpperWick(c: Candle): boolean {
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    return body > 0 && upperWick >= 2 * body;
  }

  private hasLongLowerWick(c: Candle): boolean {
    const body = Math.abs(c.close - c.open);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    return body > 0 && lowerWick >= 2 * body;
  }

  private buildSignal(
    setupType: SetupResult['setupType'],
    direction: SetupResult['direction'],
    entryPrice: number,
    stopLoss: number,
    context: Record<string, unknown>,
    config: RiskConfig,
  ): SetupResult | null {
    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    if (riskPerUnit <= 0) return null;

    // TP placed at the configured minimum R multiple (1R = riskPerUnit distance).
    const takeProfit = direction === 'LONG'
      ? entryPrice + config.minRR * riskPerUnit
      : entryPrice - config.minRR * riskPerUnit;

    // Volume sized so that hitting SL loses exactly riskPerTrade USDT.
    const riskAmount = config.riskPerTrade;
    const quantity = riskAmount / riskPerUnit;
    const positionValue = quantity * entryPrice;

    return {
      setupType,
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      rrRatio: config.minRR,
      riskAmount,
      quantity,
      positionValue,
      setupJson: JSON.stringify({ ...context, entryPrice, stopLoss, takeProfit, quantity, positionValue }),
    };
  }

  // ── Setup 1: Break & Retest ────────────────────────────────────────

  private detectBreakRetest(
    candles15m: Candle[],
    candles1h: Candle[],
    _candles4h: Candle[],
    trend4h: Trend,
    trend1h: Trend,
    reasons: string[],
    config: RiskConfig,
  ): SetupResult | null {
    const latest = candles15m.at(-1);
    if (!latest) {
      reasons.push('BR: missing latest 15m candle');
      return null;
    }
    const avg20 = this.avgVolume(candles15m, 20);

    if (trend4h === 'up' && trend1h !== 'down') {
      // Look for LONG setup: break above resistance, retest confirmed
      const resistanceLevels = this.getSwingHighs(candles1h, 25);
      const resistance = resistanceLevels.at(-1);
      if (resistance == null) {
        reasons.push('BR-LONG: no 1H resistance');
        return null;
      }

      // Find break candle (within last 10 candles): closed above resistance with volume spike
      const recent15m = candles15m.slice(-12, -1);
      const breakIdx = recent15m.findIndex(
        (c) => c.close > resistance && c.volume > avg20 * 1.2,
      );
      if (breakIdx < 0) {
        reasons.push(`BR-LONG[R1=${resistance}]: no break candle (close>R & vol>1.2x)`);
        return null;
      }

      // After break: check for retest (price returning to within 0.4% of resistance)
      const postBreak = recent15m.slice(breakIdx + 1);
      const retestIdx = postBreak.findIndex(
        (c) => c.low <= resistance * 1.004 && c.low >= resistance * 0.996,
      );
      if (retestIdx < 0) {
        reasons.push(`BR-LONG[R1=${resistance}]: broke but no retest`);
        return null;
      }

      // Confirmation: latest candle closes above resistance
      if (latest.close < resistance) {
        reasons.push(`BR-LONG[R1=${resistance}]: retest but close<R (unconfirmed)`);
        return null;
      }

      const retestLow = Math.min(...postBreak.slice(retestIdx, retestIdx + 3).map((c) => c.low));
      const sl = retestLow * 0.9995;

      const breakCandleVolume = recent15m[breakIdx]?.volume ?? 0;
      return this.buildSignal('BREAK_RETEST', 'LONG', latest.close, sl, {
        resistance,
        trend4h,
        trend1h,
        avg20Volume: avg20,
        breakCandleVolume,
      }, config);
    }

    if (trend4h === 'down' && trend1h !== 'up') {
      // SHORT: break below support, retest from below
      const supportLevels = this.getSwingLows(candles1h, 25);
      const support = supportLevels.at(-1);
      if (support == null) {
        reasons.push('BR-SHORT: no 1H support');
        return null;
      }

      const recent15m = candles15m.slice(-12, -1);
      const breakIdx = recent15m.findIndex(
        (c) => c.close < support && c.volume > avg20 * 1.2,
      );
      if (breakIdx < 0) {
        reasons.push(`BR-SHORT[S1=${support}]: no break candle (close<S & vol>1.2x)`);
        return null;
      }

      const postBreak = recent15m.slice(breakIdx + 1);
      const retestIdx = postBreak.findIndex(
        (c) => c.high >= support * 0.996 && c.high <= support * 1.004,
      );
      if (retestIdx < 0) {
        reasons.push(`BR-SHORT[S1=${support}]: broke but no retest`);
        return null;
      }

      if (latest.close > support) {
        reasons.push(`BR-SHORT[S1=${support}]: retest but close>S (unconfirmed)`);
        return null;
      }

      const retestHigh = Math.max(...postBreak.slice(retestIdx, retestIdx + 3).map((c) => c.high));
      const sl = retestHigh * 1.0005;

      const breakCandleVol = recent15m[breakIdx]?.volume ?? 0;
      return this.buildSignal('BREAK_RETEST', 'SHORT', latest.close, sl, {
        support,
        trend4h,
        trend1h,
        avg20Volume: avg20,
        breakCandleVolume: breakCandleVol,
      }, config);
    }

    reasons.push(`BR: trend not aligned (4H=${trend4h}, 1H=${trend1h}; need 4H=up&1H!=down or 4H=down&1H!=up)`);
    return null;
  }

  // ── Setup 3: Liquidity Sweep + Reversal ───────────────────────────

  private detectLiquiditySweep(
    candles15m: Candle[],
    candles1h: Candle[],
    trend4h: Trend,
    trend1h: Trend,
    reasons: string[],
    config: RiskConfig,
  ): SetupResult | null {
    const latest = candles15m.at(-1);
    const prev = candles15m.at(-2);
    if (!latest || !prev) {
      reasons.push('Sweep: missing latest/prev 15m candle');
      return null;
    }
    const avg20 = this.avgVolume(candles15m, 20);

    // SHORT: sweep above 1H swing high, close back below it
    if (trend4h === 'up') {
      reasons.push('Sweep-SHORT: trend4H=up (need !=up)');
    } else {
      const swingHighs = this.getSwingHighs(candles1h, 20);
      const swingHigh = swingHighs.at(-1);
      if (swingHigh == null) {
        reasons.push('Sweep-SHORT: no 1H swing high');
      } else {
        const sweptAbove = latest.high > swingHigh * 1.003;
        const closedBelow = latest.close < swingHigh;
        const bearishPattern = this.isBearishEngulfing(prev, latest) || this.hasLongUpperWick(latest);
        const volumeSpike = latest.volume > avg20 * 1.3;
        const trendOk = trend1h !== 'up';

        if (sweptAbove && closedBelow && bearishPattern && volumeSpike && trendOk) {
          const sl = latest.high * 1.0005;
          return this.buildSignal('LIQUIDITY_SWEEP', 'SHORT', latest.close, sl, {
            swingHigh,
            sweepHigh: latest.high,
            sweepPct: ((latest.high / swingHigh - 1) * 100).toFixed(3),
            trend4h,
            trend1h,
            avg20Volume: avg20,
            candleVolume: latest.volume,
          }, config);
        }
        reasons.push(
          `Sweep-SHORT[H1=${swingHigh}]: swept=${this.yn(sweptAbove)} closeBelow=${this.yn(closedBelow)} ` +
            `bearish=${this.yn(bearishPattern)} vol1.3x=${this.yn(volumeSpike)} t1h!=up=${this.yn(trendOk)}`,
        );
      }
    }

    // LONG: sweep below 1H swing low, close back above it
    if (trend4h === 'down') {
      reasons.push('Sweep-LONG: trend4H=down (need !=down)');
    } else {
      const swingLows = this.getSwingLows(candles1h, 20);
      const swingLow = swingLows.at(-1);
      if (swingLow == null) {
        reasons.push('Sweep-LONG: no 1H swing low');
      } else {
        const sweptBelow = latest.low < swingLow * 0.997;
        const closedAbove = latest.close > swingLow;
        const bullishPattern = this.isBullishEngulfing(prev, latest) || this.hasLongLowerWick(latest);
        const volumeSpike = latest.volume > avg20 * 1.3;
        const trendOk = trend1h !== 'down';

        if (sweptBelow && closedAbove && bullishPattern && volumeSpike && trendOk) {
          const sl = latest.low * 0.9995;
          return this.buildSignal('LIQUIDITY_SWEEP', 'LONG', latest.close, sl, {
            swingLow,
            sweepLow: latest.low,
            sweepPct: ((1 - latest.low / swingLow) * 100).toFixed(3),
            trend4h,
            trend1h,
            avg20Volume: avg20,
            candleVolume: latest.volume,
          }, config);
        }
        reasons.push(
          `Sweep-LONG[L1=${swingLow}]: swept=${this.yn(sweptBelow)} closeAbove=${this.yn(closedAbove)} ` +
            `bullish=${this.yn(bullishPattern)} vol1.3x=${this.yn(volumeSpike)} t1h!=down=${this.yn(trendOk)}`,
        );
      }
    }

    return null;
  }
}
