import { Injectable, Logger } from '@nestjs/common';
import { isSupertrendBullish, type Candle } from '@app/core';

import { MarketDataService } from '../market/market-data.service';

/**
 * The "Scores" column on /tracking-coins: how many checks a coin currently
 * passes, shown as `passed/total` (e.g. `1/1`).
 *
 * Rules live in the `RULES` list below and each contributes exactly one point.
 * Adding a check means appending one entry — the denominator, the per-rule
 * breakdown the UI shows on hover, and the API shape all follow from the list.
 * As of 2026-08-11 there is deliberately only one rule.
 */

const SUPERTREND_PERIOD = 10;
const SUPERTREND_MULTIPLIER = 3;

/** Daily candles pulled per coin — plenty of warm-up for a 10-period ATR. */
const CANDLE_LIMIT = 200;

/**
 * A coin needs this many closed daily candles before its Supertrend is trusted;
 * fresh listings would otherwise report whatever the seed bar dictates. Same
 * threshold the daily Supertrend screener uses, so the two never disagree.
 */
const MIN_CLOSED_CANDLES = 60;

/** Every rule reads a closed daily candle, so a score only moves on a daily close. */
const SCORE_CACHE_TTL_MS = 5 * 60_000;

type RuleContext = {
  /** Daily candles with the in-progress one dropped. */
  d1Closed: Candle[];
};

/** `true` = point earned, `false` = not earned, `null` = not enough data to judge. */
type ScoreRule = {
  id: string;
  label: string;
  evaluate: (ctx: RuleContext) => boolean | null;
};

const RULES: ScoreRule[] = [
  {
    id: 'supertrendD1',
    label: 'Supertrend(10,3) D1 bullish',
    evaluate: ({ d1Closed }) =>
      d1Closed.length < MIN_CLOSED_CANDLES
        ? null
        : isSupertrendBullish(d1Closed, SUPERTREND_PERIOD, SUPERTREND_MULTIPLIER),
  },
];

/** The denominator in `passed/total` — derived, never hard-coded. */
export const MAX_SCORE = RULES.length;

export type TrackingCoinScore = {
  symbol: string;
  /** Rules passed, or `null` when no rule could be evaluated at all. */
  score: number | null;
  maxScore: number;
  /** Per-rule outcome keyed by rule id, so the UI can explain the number. */
  rules: Record<string, boolean | null>;
};

@Injectable()
export class TrackingCoinScoreService {
  private readonly logger = new Logger(TrackingCoinScoreService.name);
  private readonly cache = new Map<string, { at: number; value: TrackingCoinScore }>();

  constructor(private readonly marketData: MarketDataService) {}

  /** Rule ids and labels, for a UI that wants to name what it is showing. */
  listRules(): { id: string; label: string }[] {
    return RULES.map(({ id, label }) => ({ id, label }));
  }

  async getScores(symbols: string[]): Promise<TrackingCoinScore[]> {
    const unique = [...new Set(symbols.map(bareSymbol).filter(Boolean))];
    const out: TrackingCoinScore[] = [];
    for (const bare of unique) {
      out.push(await this.scoreFor(bare));
    }
    return out;
  }

  private async scoreFor(bare: string): Promise<TrackingCoinScore> {
    const cached = this.cache.get(bare);
    if (cached && Date.now() - cached.at < SCORE_CACHE_TTL_MS) return cached.value;

    let d1Closed: Candle[];
    try {
      const candles = await this.marketData.getCandles(`${bare}USDT`, '1d', CANDLE_LIMIT);
      d1Closed = dropUnclosedCandle(candles);
    } catch (error) {
      this.logger.warn(
        `Score fetch failed for ${bare}: ${error instanceof Error ? error.message : String(error)}`
      );
      // Transient failure: keep the last-known score rather than blanking the column.
      return cached?.value ?? blankScore(bare);
    }

    const rules: Record<string, boolean | null> = {};
    let passed = 0;
    let judged = 0;
    for (const rule of RULES) {
      const result = rule.evaluate({ d1Closed });
      rules[rule.id] = result;
      if (result === null) continue;
      judged += 1;
      if (result) passed += 1;
    }

    const value: TrackingCoinScore = {
      symbol: bare,
      score: judged === 0 ? null : passed,
      maxScore: MAX_SCORE,
      rules,
    };
    this.cache.set(bare, { at: Date.now(), value });
    return value;
  }
}

function blankScore(symbol: string): TrackingCoinScore {
  return {
    symbol,
    score: null,
    maxScore: MAX_SCORE,
    rules: Object.fromEntries(RULES.map((r) => [r.id, null])),
  };
}

/**
 * Binance returns the in-progress candle last; every rule reads closed candles
 * only, so anything whose close time is still in the future is dropped.
 */
function dropUnclosedCandle(candles: Candle[]): Candle[] {
  const now = Date.now();
  return candles.filter((candle) => !candle.closeTime || candle.closeTime.getTime() <= now);
}

/** Coins are stored bare ("ADA"); accept either form and normalise to bare. */
function bareSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/USDT$/, '');
}
