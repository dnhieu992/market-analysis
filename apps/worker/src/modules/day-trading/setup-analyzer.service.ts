import { Injectable, Logger } from '@nestjs/common';
import type { Candle } from './bitget.service';

export type SetupType = 'LIQUIDITY_SWEEP' | 'TREND_PULLBACK' | 'RANGE_FADE' | 'BREAK_RETEST';

export type SetupResult = {
  setupType: SetupType;
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
type Pivot = { idx: number; price: number };
type SrZone = { price: number; touches: number };

// Per-scan risk configuration (loaded from DayTradingSettings).
export type RiskConfig = {
  riskPerTrade: number;  // hard loss budget in USDT if SL is hit
  minRR: number;         // minimum reward in R — also the fallback TP target
  minStopPct?: number;   // floor on entry→SL distance as a fraction of price (e.g. 0.003 = 0.3%)
  atrMult?: number;      // if set, stop floor = atrMult × ATR(14) on the entry TF (volatility-adaptive)
};

// Hard safety floor kept even in ATR mode, so a tiny-ATR period can't reproduce
// the near-zero-stop fee blow-up.
const ATR_SAFETY_PCT = 0.003; // 0.3%

// Minimum stop distance. Structural SLs can sit a hair from entry, which inflates
// position size (qty = risk/|entry-SL|) into a huge notional whose trading fees
// alone exceed several R. Flooring the stop keeps leverage — and fee drag — sane.
const DEFAULT_MIN_STOP_PCT = 0.005; // 0.5%

// Buffer placed beyond the structural swing for the stop ("đáy/đỉnh gần nhất ± một khoảng").
const SL_BUFFER = 0.001; // 0.1%

// Pivot fractal window (candles required on each side to confirm a swing).
const PIVOT_WING = 2;

const DEFAULT_RISK: RiskConfig = { riskPerTrade: 2, minRR: 2, minStopPct: DEFAULT_MIN_STOP_PCT };

@Injectable()
export class SetupAnalyzerService {
  private readonly logger = new Logger(SetupAnalyzerService.name);

  // ATR(14) of the entry timeframe for the current scan — set at the top of
  // analyze() and read by buildSignal() for the volatility-adaptive stop floor.
  private atrEntry = 0;

  /**
   * Multi-setup intraday scanner for BTCUSDT, modelled on a discretionary PA
   * workflow: read the H4/H1 TREND from trendlines (rising lows / falling highs),
   * find the entry on M15, place the SL beyond the nearest swing, and target the
   * nearest strong S/R zone (or a measured RR). No EMAs are used.
   */
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

    this.atrEntry = this.calcAtr(candles15m, 14);
    const trend4h = this.trendlineTrend(candles4h);
    const trend1h = this.trendlineTrend(candles1h);

    const reasons: string[] = [];

    // Quality order: cleanest reversal first, then continuation, then range fade.
    const sweep = this.detectLiquiditySweep(candles15m, candles1h, trend4h, trend1h, reasons, config);
    if (sweep) return sweep;

    const pullback = this.detectTrendPullback(candles15m, candles1h, trend4h, trend1h, reasons, config);
    if (pullback) return pullback;

    // RANGE_FADE removed: it traded against the trend in "neutral" regimes and
    // backtested as a heavy net loss (PF 0.61). This is a trend-following system.

    const latest = candles15m.at(-1);
    this.logger.debug(
      `Reject @ price=${latest?.close ?? '?'} trend4H=${trend4h} trend1H=${trend1h} | ` + reasons.join(' ; '),
    );
    return null;
  }

  // ── Pivots / trend / S-R ────────────────────────────────────────────────────

  /** Swing pivots with their index, confirmed by `wing` candles on each side. */
  private pivots(candles: Candle[], type: 'high' | 'low', wing = PIVOT_WING): Pivot[] {
    const out: Pivot[] = [];
    for (let i = wing; i < candles.length - wing; i++) {
      const c = candles[i]!;
      let ok = true;
      for (let j = i - wing; j <= i + wing && ok; j++) {
        if (j === i) continue;
        const o = candles[j]!;
        if (type === 'high' ? o.high >= c.high : o.low <= c.low) ok = false;
      }
      if (ok) out.push({ idx: i, price: type === 'high' ? c.high : c.low });
    }
    return out;
  }

  /**
   * Trend from trendlines: an uptrend has rising swing lows whose connecting
   * support line is still holding (price above its projection); a downtrend has
   * falling swing highs whose resistance line still caps price. Conflicts or no
   * clean structure → neutral.
   */
  private trendlineTrend(candles: Candle[]): Trend {
    const lows = this.pivots(candles, 'low');
    const highs = this.pivots(candles, 'high');
    const n = candles.length - 1;
    const close = candles[n]!.close;

    let up = false;
    if (lows.length >= 2) {
      const a = lows[lows.length - 2]!;
      const b = lows[lows.length - 1]!;
      if (b.price > a.price && b.idx > a.idx) {
        const slope = (b.price - a.price) / (b.idx - a.idx);
        const projected = b.price + slope * (n - b.idx);   // rising support line at "now"
        if (close > projected) up = true;                  // price still above the up trendline
      }
    }

    let down = false;
    if (highs.length >= 2) {
      const a = highs[highs.length - 2]!;
      const b = highs[highs.length - 1]!;
      if (b.price < a.price && b.idx > a.idx) {
        const slope = (b.price - a.price) / (b.idx - a.idx);
        const projected = b.price + slope * (n - b.idx);   // falling resistance line at "now"
        if (close < projected) down = true;                // price still below the down trendline
      }
    }

    if (up && !down) return 'up';
    if (down && !up) return 'down';
    return 'neutral';
  }

  /**
   * Strong S/R zones: cluster swing highs+lows into price bands; a zone's
   * "touches" is how many pivots fall in it. Strong = touched ≥ 2 times.
   */
  private srZones(candles: Candle[], tolerancePct = 0.004): SrZone[] {
    const levels = [
      ...this.pivots(candles, 'high').map((p) => p.price),
      ...this.pivots(candles, 'low').map((p) => p.price),
    ].sort((a, b) => a - b);

    const zones: { sum: number; price: number; touches: number }[] = [];
    for (const lv of levels) {
      const z = zones.find((z) => Math.abs(z.price - lv) / z.price <= tolerancePct);
      if (z) { z.sum += lv; z.touches++; z.price = z.sum / z.touches; }
      else zones.push({ sum: lv, price: lv, touches: 1 });
    }
    return zones.map((z) => ({ price: z.price, touches: z.touches }));
  }

  private nearestStrongAbove(price: number, zones: SrZone[], minTouches = 2): number | null {
    const c = zones.filter((z) => z.price > price && z.touches >= minTouches).map((z) => z.price);
    return c.length ? Math.min(...c) : null;
  }

  private nearestStrongBelow(price: number, zones: SrZone[], minTouches = 2): number | null {
    const c = zones.filter((z) => z.price < price && z.touches >= minTouches).map((z) => z.price);
    return c.length ? Math.max(...c) : null;
  }

  /** Average True Range over the last `period` candles (simple mean of TR). */
  private calcAtr(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 0;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i]!;
      const p = candles[i - 1]!;
      trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    }
    return trs.slice(-period).reduce((s, x) => s + x, 0) / period;
  }

  // ── Candle helpers ──────────────────────────────────────────────────────────

  private yn(v: boolean): string { return v ? 'Y' : 'N'; }

  private avgVolume(candles: Candle[], n: number): number {
    const slice = candles.slice(-n - 1, -1);
    if (!slice.length) return 0;
    return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
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
    return body > 0 && upperWick >= 1.5 * body;
  }

  private hasLongLowerWick(c: Candle): boolean {
    const body = Math.abs(c.close - c.open);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    return body > 0 && lowerWick >= 1.5 * body;
  }

  // ── TP / signal building ────────────────────────────────────────────────────

  /**
   * Resolve the take-profit: prefer the nearest STRONG S/R zone in the trade
   * direction when it offers at least minRR; otherwise a measured RR target.
   */
  private resolveTp(
    direction: SetupResult['direction'],
    entry: number,
    risk: number,
    structuralTp: number | null,
    config: RiskConfig,
  ): number {
    const targetRR = Math.max(config.minRR, 1.5);
    const fallback = direction === 'LONG' ? entry + targetRR * risk : entry - targetRR * risk;
    if (structuralTp == null) return fallback;
    const validDir = direction === 'LONG' ? structuralTp > entry : structuralTp < entry;
    if (!validDir) return fallback;
    const structRR = Math.abs(structuralTp - entry) / risk;
    return structRR >= config.minRR ? structuralTp : fallback;
  }

  private buildSignal(
    setupType: SetupType,
    direction: SetupResult['direction'],
    entryPrice: number,
    rawStopLoss: number,
    structuralTp: number | null,
    context: Record<string, unknown>,
    config: RiskConfig,
    reasons: string[],
  ): SetupResult | null {
    let riskPerUnit = Math.abs(entryPrice - rawStopLoss);
    if (riskPerUnit <= 0) {
      reasons.push(`${setupType}-${direction}: invalid SL (risk=0)`);
      return null;
    }

    // Floor the stop distance so position size (and thus fee drag) stays sane.
    const minStop = config.atrMult && this.atrEntry > 0
      ? Math.max(config.atrMult * this.atrEntry, entryPrice * ATR_SAFETY_PCT)
      : entryPrice * (config.minStopPct ?? DEFAULT_MIN_STOP_PCT);
    let stopLoss = rawStopLoss;
    if (riskPerUnit < minStop) {
      stopLoss = direction === 'LONG' ? entryPrice - minStop : entryPrice + minStop;
      riskPerUnit = minStop;
    }

    const takeProfit = this.resolveTp(direction, entryPrice, riskPerUnit, structuralTp, config);
    const rr = Math.abs(takeProfit - entryPrice) / riskPerUnit;
    if (rr < config.minRR) {
      reasons.push(`${setupType}-${direction}: R:R ${rr.toFixed(2)} < minRR ${config.minRR}`);
      return null;
    }

    const riskAmount = config.riskPerTrade;
    const quantity = riskAmount / riskPerUnit;
    const positionValue = quantity * entryPrice;

    return {
      setupType, direction, entryPrice, stopLoss, takeProfit, rrRatio: rr, riskAmount, quantity, positionValue,
      setupJson: JSON.stringify({ ...context, entryPrice, stopLoss, takeProfit, quantity, positionValue, rr }),
    };
  }

  // ── Setup 1: Liquidity Sweep + Reversal ────────────────────────────────────

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
    if (!latest || !prev) return null;
    const avg20 = this.avgVolume(candles15m, 20);
    const swingHighs = this.pivots(candles1h, 'high').map((p) => p.price);
    const swingLows = this.pivots(candles1h, 'low').map((p) => p.price);
    const zones = this.srZones(candles1h);

    // SHORT: sweep above a 1H swing high, close back below it.
    if (trend4h !== 'up') {
      const swingHigh = swingHighs.at(-1);
      if (swingHigh != null) {
        const sweptAbove = latest.high > swingHigh * 1.0012;
        const closedBelow = latest.close < swingHigh;
        const bearishPattern = this.isBearishEngulfing(prev, latest) || this.hasLongUpperWick(latest);
        const volumeSpike = latest.volume > avg20 * 1.15;
        const trendOk = trend1h !== 'up';
        if (sweptAbove && closedBelow && bearishPattern && volumeSpike && trendOk) {
          const sl = latest.high * (1 + SL_BUFFER);
          const tp = this.nearestStrongBelow(latest.close, zones);
          const sig = this.buildSignal('LIQUIDITY_SWEEP', 'SHORT', latest.close, sl, tp, {
            swingHigh, sweepHigh: latest.high, trend4h, trend1h, candleVolume: latest.volume, avg20Volume: avg20,
          }, config, reasons);
          if (sig) return sig;
        } else {
          reasons.push(`Sweep-SHORT[H=${swingHigh}]: swept=${this.yn(sweptAbove)} closeBelow=${this.yn(closedBelow)} bearish=${this.yn(bearishPattern)} vol=${this.yn(volumeSpike)} t1h!=up=${this.yn(trendOk)}`);
        }
      }
    }

    // LONG: sweep below a 1H swing low, close back above it.
    if (trend4h !== 'down') {
      const swingLow = swingLows.at(-1);
      if (swingLow != null) {
        const sweptBelow = latest.low < swingLow * 0.9988;
        const closedAbove = latest.close > swingLow;
        const bullishPattern = this.isBullishEngulfing(prev, latest) || this.hasLongLowerWick(latest);
        const volumeSpike = latest.volume > avg20 * 1.15;
        const trendOk = trend1h !== 'down';
        if (sweptBelow && closedAbove && bullishPattern && volumeSpike && trendOk) {
          const sl = latest.low * (1 - SL_BUFFER);
          const tp = this.nearestStrongAbove(latest.close, zones);
          const sig = this.buildSignal('LIQUIDITY_SWEEP', 'LONG', latest.close, sl, tp, {
            swingLow, sweepLow: latest.low, trend4h, trend1h, candleVolume: latest.volume, avg20Volume: avg20,
          }, config, reasons);
          if (sig) return sig;
        } else {
          reasons.push(`Sweep-LONG[L=${swingLow}]: swept=${this.yn(sweptBelow)} closeAbove=${this.yn(closedAbove)} bullish=${this.yn(bullishPattern)} vol=${this.yn(volumeSpike)} t1h!=down=${this.yn(trendOk)}`);
        }
      }
    }

    return null;
  }

  // ── Setup 2: Trend Pullback (continuation, trendline + swing) ──────────────

  private detectTrendPullback(
    candles15m: Candle[],
    candles1h: Candle[],
    trend4h: Trend,
    trend1h: Trend,
    reasons: string[],
    config: RiskConfig,
  ): SetupResult | null {
    const n = candles15m.length - 1;
    const latest = candles15m[n]!;
    const prev = candles15m[n - 1]!;
    const zones = this.srZones(candles1h);

    // LONG continuation: H4 up & H1 not down. After a pullback to a recent M15
    // swing low, the latest candle reclaims (bullish reclaim of the prior high).
    if (trend4h === 'up' && trend1h !== 'down') {
      const lows = this.pivots(candles15m, 'low');
      const lastLow = lows.at(-1);
      const recent = lastLow != null && lastLow.idx >= n - 8;   // pullback was recent
      const bullishReclaim = latest.close > latest.open && (latest.close > prev.high || this.isBullishEngulfing(prev, latest));
      const aboveLow = lastLow != null && latest.close > lastLow.price;
      if (recent && bullishReclaim && aboveLow) {
        const sl = lastLow!.price * (1 - SL_BUFFER);            // below the nearest swing low
        const tp = this.nearestStrongAbove(latest.close, zones);
        const sig = this.buildSignal('TREND_PULLBACK', 'LONG', latest.close, sl, tp, {
          pullbackLow: lastLow!.price, trend4h, trend1h,
        }, config, reasons);
        if (sig) return sig;
      } else {
        reasons.push(`Pullback-LONG: recentLow=${this.yn(recent)} reclaim=${this.yn(bullishReclaim)} aboveLow=${this.yn(aboveLow)}`);
      }
    }

    // SHORT continuation: H4 down & H1 not up.
    if (trend4h === 'down' && trend1h !== 'up') {
      const highs = this.pivots(candles15m, 'high');
      const lastHigh = highs.at(-1);
      const recent = lastHigh != null && lastHigh.idx >= n - 8;
      const bearishReject = latest.close < latest.open && (latest.close < prev.low || this.isBearishEngulfing(prev, latest));
      const belowHigh = lastHigh != null && latest.close < lastHigh.price;
      if (recent && bearishReject && belowHigh) {
        const sl = lastHigh!.price * (1 + SL_BUFFER);           // above the nearest swing high
        const tp = this.nearestStrongBelow(latest.close, zones);
        const sig = this.buildSignal('TREND_PULLBACK', 'SHORT', latest.close, sl, tp, {
          pullbackHigh: lastHigh!.price, trend4h, trend1h,
        }, config, reasons);
        if (sig) return sig;
      } else {
        reasons.push(`Pullback-SHORT: recentHigh=${this.yn(recent)} reject=${this.yn(bearishReject)} belowHigh=${this.yn(belowHigh)}`);
      }
    }

    return null;
  }

}
