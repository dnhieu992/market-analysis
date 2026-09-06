import { Injectable, Logger } from '@nestjs/common';
import { isSupertrendBullish, type Candle } from '@app/core';

import { DailyCandleCacheService } from '../market/daily-candle-cache.service';

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

/**
 * A coin needs this many closed daily candles before its Supertrend is trusted;
 * fresh listings would otherwise report whatever the seed bar dictates. Same
 * threshold the daily Supertrend screener uses, so the two never disagree.
 */
const MIN_CLOSED_CANDLES = 60;

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

  constructor(private readonly dailyCandles: DailyCandleCacheService) {}

  /** Rule ids and labels, for a UI that wants to name what it is showing. */
  listRules(): { id: string; label: string }[] {
    return RULES.map(({ id, label }) => ({ id, label }));
  }

  /**
   * Candles come from the shared daily cache, so all symbols are fetched once
   * and concurrently rather than one blocking round trip each.
   */
  async getScores(symbols: string[]): Promise<TrackingCoinScore[]> {
    const unique = [...new Set(symbols.map(bareSymbol).filter(Boolean))];
    const candlesBySymbol = await this.dailyCandles.getMany(unique);

    return unique.map((bare) => {
      const candles = candlesBySymbol.get(bare);
      if (!candles) {
        this.logger.warn(`No daily candles available for ${bare} — score left blank`);
        return blankScore(bare);
      }
      return scoreFrom(bare, dropUnclosedCandle(candles));
    });
  }
}

function scoreFrom(bare: string, d1Closed: Candle[]): TrackingCoinScore {
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

  return {
    symbol: bare,
    score: judged === 0 ? null : passed,
    maxScore: MAX_SCORE,
    rules,
  };
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
