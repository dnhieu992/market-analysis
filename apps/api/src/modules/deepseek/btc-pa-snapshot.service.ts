import { Injectable, Logger } from '@nestjs/common';
import type { Candle } from '@app/core';
import type { AnalysisTimeframe } from '@app/config';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

/**
 * The factual multi-timeframe picture of BTCUSDT the day-trading agent reasons over.
 *
 * Deliberately **indicator-free**: no EMA, RSI, MACD or ATR anywhere in here. The
 * analysis is pure price action — market structure (higher highs / higher lows),
 * trend lines drawn through real pivots, Fibonacci on the last impulse leg, and
 * raw candles with their volume. Everything below is derived from the candles
 * themselves, so every number in the prompt can be pointed at on a chart.
 *
 * What is computed here rather than left to the model is the part that must be
 * identical on every run: which bars are pivots, whether the structure is making
 * higher highs, where a trend line sits today, and what the fib levels of the
 * current leg are. The model reads those and decides what to do — it never has
 * to do arithmetic over 180 candles, which is exactly what it is bad at.
 *
 * Everything is computed on CLOSED candles only. The still-forming 15m candle is
 * carried separately and clearly labelled: it is the live price, not a signal.
 */

export const BTC_SYMBOL = 'BTCUSDT';

/** Timeframes in top-down order — the order the prompt and the UI show them in. */
const TIMEFRAMES: Array<{ timeframe: AnalysisTimeframe; label: string; role: string }> = [
  { timeframe: '1d', label: '1D', role: 'Bối cảnh / xu hướng nền' },
  { timeframe: '4h', label: '4H', role: 'Xu hướng chính (swing)' },
  { timeframe: '1h', label: '1H', role: 'Xu hướng trong ngày' },
  { timeframe: '15m', label: '15m', role: 'Điểm vào lệnh / trigger' },
];

/**
 * Closed candles requested per timeframe. Without EMA200 to warm up there is no
 * reason to pull 260 — this only has to cover the pivot lookback plus a margin.
 */
const KLINE_LIMIT = 180;
/** Lookback for the swing high/low the model uses to place stops. */
export const SWING_LOOKBACK = 20;
/** Recent candles handed to the model per timeframe, for raw price action. */
const RECENT_CANDLES = 8;
/** Candles either side of a bar for it to count as a pivot (a 5-bar fractal). */
const PIVOT_STRENGTH = 2;
/** How far back pivots are searched. Older levels are history, not intraday levels. */
const PIVOT_LOOKBACK = 120;
/** Pivots within this percent of each other are the same level, kept once. */
const LEVEL_CLUSTER_PCT = 0.15;
/** Horizontal levels reported per side. */
const LEVELS_PER_SIDE = 3;
/** Most recent pivots reported, so the model can read the structure sequence itself. */
const PIVOTS_REPORTED = 6;
/**
 * Half-width of the band around a trend line, as a fraction of the timeframe's
 * own swing range. A wick inside the band is a touch; a CLOSE outside it is a
 * break. Scaling by the timeframe's range rather than using a fixed percent
 * matters: a flat 0.15% band is $96 on BTC, which on a quiet 15m chart whose
 * whole swing range is $400 marks almost every bar as a "touch" and reports a
 * two-hour-old line as tested seven times.
 */
const TRENDLINE_BAND_FRACTION = 0.1;
/** A leg smaller than this is noise — no fib is drawn on it. */
const MIN_FIB_LEG_PCT = 0.3;
const FIB_RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.786];
const FIB_EXTENSIONS = [1.272, 1.618];
/** Window for the plain volume average that raw volumes are read against. */
export const VOLUME_AVG_LOOKBACK = 20;

/** Market structure, read from the pivot sequence — never the model's opinion. */
export type MarketStructure = 'uptrend' | 'downtrend' | 'range';
export type PivotKind = 'high' | 'low';
/** Higher high / lower high / higher low / lower low, vs the previous same-kind pivot. */
export type PivotLabel = 'HH' | 'LH' | 'HL' | 'LL';

export type RecentCandle = {
  /** Candle close time, ISO. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Pivot = {
  /** Close time of the pivot bar, ISO. */
  time: string;
  price: number;
  kind: PivotKind;
  label: PivotLabel;
};

export type TrendLine = {
  /** `support` is drawn under the last two pivot lows, `resistance` over the last two highs. */
  kind: 'support' | 'resistance';
  from: { time: string; price: number };
  to: { time: string; price: number };
  /** The line's value at the current (still forming) bar — where it sits today. */
  priceNow: number;
  /** Rise per candle of this timeframe, in USD. Negative means the line falls. */
  slopePerBar: number;
  /** Later candles that touched the line without closing through it. */
  touches: number;
  /** Live price vs the line, in percent. Positive means price is above the line. */
  distancePct: number;
  /** True once a candle has CLOSED through the line — a drawn line that no longer holds. */
  broken: boolean;
};

export type FibLevel = { ratio: number; price: number };

export type FibRetracement = {
  /** `up` = leg ran from a low to a high, so retracements sit below the high. */
  legDirection: 'up' | 'down';
  from: { time: string; price: number };
  to: { time: string; price: number };
  /** Size of the leg as a percent of its starting price. */
  legSizePct: number;
  retracements: FibLevel[];
  /** Targets beyond the end of the leg (1.272 / 1.618). */
  extensions: FibLevel[];
  /** How much of the leg price has given back: 0% = at the leg's end, 100% = fully retraced. */
  retracedPct: number;
  /** Retracement level closest to the live price. */
  nearest: FibLevel | null;
};

export type TimeframeReport = {
  /** Binance interval id, e.g. `4h`. */
  timeframe: string;
  label: string;
  /** What this timeframe is for in a top-down read. */
  role: string;
  /** Close time of the last CLOSED candle — everything below is as of this. */
  closedAt: string;
  close: number;
  /** Change across the last closed candle, in percent. */
  changePct: number;
  /** Trend read from the pivot sequence: HH+HL = uptrend, LH+LL = downtrend. */
  structure: MarketStructure;
  /** The pivot labels the structure was read from, e.g. "HH + HL". */
  structureNote: string;
  /** Most recent pivots, oldest first — the raw swing sequence. */
  pivots: Pivot[];
  /** Highest high / lowest low of the last `SWING_LOOKBACK` closed candles. */
  swingHigh: number;
  swingLow: number;
  /** Swing range as a percent of price — how much room the timeframe is moving in. */
  swingRangePct: number;
  /** Pivot lows below the live price, nearest first. */
  supports: number[];
  /** Pivot highs above the live price, nearest first. */
  resistances: number[];
  /** Lines through the last two pivot lows / highs. Either may be absent. */
  trendLines: TrendLine[];
  /** Fib on the most recent impulse leg. Null when the leg is too small to matter. */
  fib: FibRetracement | null;
  recentCandles: RecentCandle[];
  /** Plain average volume over the last `VOLUME_AVG_LOOKBACK` candles — the yardstick for the raw volumes above. */
  avgVolume: number;
};

export type BtcPaSnapshot = {
  symbol: string;
  capturedAt: string;
  /** Live price = close of the still-forming 15m candle. */
  price: number;
  /** Rolling 24h stats derived from the 1H candles (no extra API call). */
  change24hPct: number | null;
  high24h: number | null;
  low24h: number | null;
  /** The 15m candle that has not closed yet — labelled so it is never treated as data. */
  forming: RecentCandle | null;
  timeframes: TimeframeReport[];
};

/**
 * What `build()` returns: the snapshot the model reads, plus the raw closed
 * candles per timeframe. The candles are kept OUT of the snapshot on purpose —
 * they are only for drawing the chart, and shipping ~180 bars × 4 timeframes
 * through the prompt and the API response would be pure weight.
 */
export type BtcPaSnapshotResult = {
  snapshot: BtcPaSnapshot;
  candles: Record<string, Candle[]>;
};

/** A pivot plus its position in the window, which the trend lines need. */
type PivotPoint = Pivot & { index: number };

const num = (v: string | number | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toCandle(k: [number, string, string, string, string, string, number, ...unknown[]]): Candle {
  return {
    open: num(k[1]),
    high: num(k[2]),
    low: num(k[3]),
    close: num(k[4]),
    volume: num(k[5]),
    openTime: new Date(k[0]),
    closeTime: new Date(k[6]),
  };
}

function toRecent(c: Candle): RecentCandle {
  return {
    time: (c.closeTime ?? new Date()).toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  };
}

const pct = (from: number, to: number): number => (from > 0 ? ((to - from) / from) * 100 : 0);

const isoOf = (c: Candle): string => (c.closeTime ?? new Date()).toISOString();

@Injectable()
export class BtcPaSnapshotService {
  private readonly logger = new Logger(BtcPaSnapshotService.name);

  constructor(private readonly binance: BinanceMarketDataService) {}

  /**
   * Fetch every timeframe in parallel and reduce each to one report. A failure
   * on any timeframe is fatal: a "multi-timeframe" signal built on three of the
   * four is a different, weaker analysis wearing the same name.
   */
  async build(): Promise<BtcPaSnapshotResult> {
    const series = await Promise.all(
      TIMEFRAMES.map(async (tf) => {
        const raw = await this.binance.fetchKlines({
          symbol: BTC_SYMBOL,
          timeframe: tf.timeframe,
          // +1 because the last row is the candle that has not closed yet.
          limit: KLINE_LIMIT + 1,
        });
        const candles = raw.map((k) => toCandle(k as Parameters<typeof toCandle>[0]));
        const forming = candles[candles.length - 1];
        if (candles.length < 30 || !forming) {
          throw new Error(`Binance chỉ trả về ${candles.length} nến ${tf.timeframe} cho ${BTC_SYMBOL}`);
        }
        return { tf, closed: candles.slice(0, -1), forming };
      }),
    );

    const intraday = series.find((s) => s.tf.timeframe === '15m');
    const hourly = series.find((s) => s.tf.timeframe === '1h');
    const price = intraday?.forming.close ?? series[0]?.forming.close ?? 0;

    const reports = series.map((s) => this.report(s.tf, s.closed, price));

    this.logger.log(
      `BTC PA snapshot: price ${price}, ` +
        reports.map((r) => `${r.label} ${r.structure}`).join(', '),
    );

    return {
      snapshot: {
        symbol: BTC_SYMBOL,
        capturedAt: new Date().toISOString(),
        price,
        ...this.rolling24h(hourly?.closed ?? [], price),
        forming: intraday ? toRecent(intraday.forming) : null,
        timeframes: reports,
      },
      candles: Object.fromEntries(series.map((s) => [s.tf.timeframe, s.closed])),
    };
  }

  /**
   * 24h change/high/low from the last 24 closed hourly candles. Cheaper than a
   * ticker call and, more importantly, consistent with everything else here —
   * `/ticker/24hr` measures a rolling window that ends *now*, which would not
   * line up with the closed-candle numbers the rest of the snapshot reports.
   */
  private rolling24h(
    hourly: Candle[],
    price: number,
  ): Pick<BtcPaSnapshot, 'change24hPct' | 'high24h' | 'low24h'> {
    const window = hourly.slice(-24);
    const first = window[0];
    if (window.length < 24 || !first) return { change24hPct: null, high24h: null, low24h: null };
    return {
      change24hPct: pct(first.open, price),
      high24h: Math.max(...window.map((c) => c.high), price),
      low24h: Math.min(...window.map((c) => c.low), price),
    };
  }

  /** Reduce one timeframe's closed candles to the row the model reads. */
  private report(tf: (typeof TIMEFRAMES)[number], closed: Candle[], price: number): TimeframeReport {
    const last = closed[closed.length - 1];
    if (!last) throw new Error(`Không có nến đã đóng nào cho khung ${tf.label}`);

    const window = closed.slice(-PIVOT_LOOKBACK);
    const pivots = this.pivots(window);
    const swing = closed.slice(-SWING_LOOKBACK);
    const swingHigh = Math.max(...swing.map((c) => c.high));
    const swingLow = Math.min(...swing.map((c) => c.low));
    const volumes = closed.slice(-VOLUME_AVG_LOOKBACK).map((c) => c.volume ?? 0);

    return {
      timeframe: tf.timeframe,
      label: tf.label,
      role: tf.role,
      closedAt: isoOf(last),
      close: last.close,
      changePct: pct(last.open, last.close),
      ...this.structureOf(pivots),
      pivots: pivots.slice(-PIVOTS_REPORTED).map((p) => ({
        time: p.time,
        price: p.price,
        kind: p.kind,
        label: p.label,
      })),
      swingHigh,
      swingLow,
      swingRangePct: price > 0 ? ((swingHigh - swingLow) / price) * 100 : 0,
      ...this.levels(pivots, price),
      trendLines: this.trendLines(pivots, window, price, (swingHigh - swingLow) * TRENDLINE_BAND_FRACTION),
      fib: this.fib(pivots, price),
      recentCandles: closed.slice(-RECENT_CANDLES).map(toRecent),
      avgVolume: volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0,
    };
  }

  /**
   * Fractal pivots: a bar whose high is the highest (or low the lowest) of the
   * `PIVOT_STRENGTH` bars either side of it. This is the one primitive the whole
   * file rests on — structure, horizontal levels, trend lines and the fib leg are
   * all read off this sequence, so they can never disagree with each other.
   */
  private pivots(window: Candle[]): PivotPoint[] {
    const found: Array<Omit<PivotPoint, 'label'>> = [];

    for (let i = PIVOT_STRENGTH; i < window.length - PIVOT_STRENGTH; i++) {
      const bar = window[i];
      if (!bar) continue;
      const neighbours = window.slice(i - PIVOT_STRENGTH, i + PIVOT_STRENGTH + 1);
      if (neighbours.every((n) => bar.high >= n.high)) {
        found.push({ index: i, price: bar.high, kind: 'high', time: isoOf(bar) });
      }
      if (neighbours.every((n) => bar.low <= n.low)) {
        found.push({ index: i, price: bar.low, kind: 'low', time: isoOf(bar) });
      }
    }

    found.sort((a, b) => a.index - b.index);

    // Label each pivot against the previous pivot of the same kind — that pair of
    // comparisons IS the structure read a price action trader does by eye.
    let prevHigh: number | null = null;
    let prevLow: number | null = null;
    return found.map((p) => {
      let label: PivotLabel;
      if (p.kind === 'high') {
        label = prevHigh != null && p.price <= prevHigh ? 'LH' : 'HH';
        prevHigh = p.price;
      } else {
        label = prevLow != null && p.price >= prevLow ? 'HL' : 'LL';
        prevLow = p.price;
      }
      return { ...p, label };
    });
  }

  /**
   * Trend from the last two highs and the last two lows. Both have to agree:
   * higher highs alone are not an uptrend if the lows are also being taken out,
   * and that disagreement is exactly the "range" case a day trader should skip.
   */
  private structureOf(pivots: PivotPoint[]): Pick<TimeframeReport, 'structure' | 'structureNote'> {
    const lastHigh = [...pivots].reverse().find((p) => p.kind === 'high');
    const lastLow = [...pivots].reverse().find((p) => p.kind === 'low');
    if (!lastHigh || !lastLow) {
      return { structure: 'range', structureNote: 'không đủ pivot để đọc cấu trúc' };
    }

    const note = `${lastHigh.label} + ${lastLow.label}`;
    if (lastHigh.label === 'HH' && lastLow.label === 'HL') {
      return { structure: 'uptrend', structureNote: note };
    }
    if (lastHigh.label === 'LH' && lastLow.label === 'LL') {
      return { structure: 'downtrend', structureNote: note };
    }
    return { structure: 'range', structureNote: `${note} (mâu thuẫn)` };
  }

  /**
   * Horizontal levels split by where price actually is: supports below,
   * resistances above, nearest first, near-duplicates collapsed. A level the
   * market left behind two days ago is history — a stop or a target placed on it
   * is placed on nothing.
   */
  private levels(
    pivots: PivotPoint[],
    price: number,
  ): Pick<TimeframeReport, 'supports' | 'resistances'> {
    const lows = pivots.filter((p) => p.kind === 'low' && p.price < price).map((p) => p.price);
    const highs = pivots.filter((p) => p.kind === 'high' && p.price > price).map((p) => p.price);
    return {
      supports: this.nearest(lows, price),
      resistances: this.nearest(highs, price),
    };
  }

  /** Nearest levels to price, with near-duplicates collapsed into one. */
  private nearest(levels: number[], price: number): number[] {
    const sorted = [...levels].sort((a, b) => Math.abs(a - price) - Math.abs(b - price));
    const kept: number[] = [];
    for (const level of sorted) {
      if (kept.some((k) => (Math.abs(k - level) / price) * 100 < LEVEL_CLUSTER_PCT)) continue;
      kept.push(level);
      if (kept.length === LEVELS_PER_SIDE) break;
    }
    return kept;
  }

  /** The line under the last two pivot lows and the one over the last two highs. */
  private trendLines(
    pivots: PivotPoint[],
    window: Candle[],
    price: number,
    band: number,
  ): TrendLine[] {
    return [
      this.trendLine(pivots.filter((p) => p.kind === 'low'), 'support', window, price, band),
      this.trendLine(pivots.filter((p) => p.kind === 'high'), 'resistance', window, price, band),
    ].filter((line): line is TrendLine => line !== null);
  }

  /**
   * A trend line through the last two same-kind pivots, projected to today.
   *
   * Touches and breaks are counted only on bars AFTER the second pivot — bars
   * before it are what the line was drawn from, so counting them would score
   * every line as validated by construction. A break needs a *close* outside the
   * band: wicks through a trend line are how they get tested, not how they fail.
   */
  private trendLine(
    points: PivotPoint[],
    kind: TrendLine['kind'],
    window: Candle[],
    price: number,
    band: number,
  ): TrendLine | null {
    const [from, to] = points.slice(-2);
    if (!from || !to || to.index === from.index) return null;

    const slopePerBar = (to.price - from.price) / (to.index - from.index);
    const at = (index: number): number => to.price + slopePerBar * (index - to.index);
    // Projected to the forming bar, so it can be compared against the live price.
    const priceNow = at(window.length);
    if (!Number.isFinite(priceNow) || priceNow <= 0) return null;

    let touches = 0;
    let broken = false;
    for (let i = to.index + 1; i < window.length; i++) {
      const bar = window[i];
      if (!bar) continue;
      const line = at(i);
      if (line <= 0 || band <= 0) continue;
      const wick = kind === 'support' ? bar.low : bar.high;
      if (Math.abs(wick - line) <= band) touches++;
      const through = kind === 'support' ? bar.close < line - band : bar.close > line + band;
      if (through) broken = true;
    }

    return {
      kind,
      from: { time: from.time, price: from.price },
      to: { time: to.time, price: to.price },
      priceNow,
      slopePerBar,
      touches,
      distancePct: pct(priceNow, price),
      broken,
    };
  }

  /**
   * Fib on the most recent impulse leg: the last pivot, back to the nearest
   * opposite pivot before it. Anchoring on the latest leg rather than the biggest
   * one is the day-trading choice — the levels that matter today are the ones the
   * market is currently retracing, not the ones from last month's swing.
   */
  private fib(pivots: PivotPoint[], price: number): FibRetracement | null {
    const end = pivots[pivots.length - 1];
    if (!end) return null;
    const start = [...pivots].reverse().find((p) => p.kind !== end.kind && p.index < end.index);
    if (!start) return null;

    const size = Math.abs(end.price - start.price);
    const legSizePct = start.price > 0 ? (size / start.price) * 100 : 0;
    if (size <= 0 || legSizePct < MIN_FIB_LEG_PCT) return null;

    const up = end.kind === 'high';
    const retracements = FIB_RETRACEMENTS.map((ratio) => ({
      ratio,
      price: up ? end.price - size * ratio : end.price + size * ratio,
    }));
    const extensions = FIB_EXTENSIONS.map((ratio) => ({
      ratio,
      price: up ? end.price + size * (ratio - 1) : end.price - size * (ratio - 1),
    }));
    const nearest =
      [...retracements].sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))[0] ??
      null;

    return {
      legDirection: up ? 'up' : 'down',
      from: { time: start.time, price: start.price },
      to: { time: end.time, price: end.price },
      legSizePct,
      retracements,
      extensions,
      retracedPct: up ? ((end.price - price) / size) * 100 : ((price - end.price) / size) * 100,
      nearest,
    };
  }
}
