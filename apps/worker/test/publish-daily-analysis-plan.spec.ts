import type {
  DailyAnalysisAnalystDraft,
  DailyAnalysisMarketData,
  DailyAnalysisValidatorResult
} from '@app/core';

import { publishDailyAnalysisPlan } from '../src/modules/analysis/publish-daily-analysis-plan';
import type { DailyAnalysisHardCheckResult } from '@app/core';

function makeMarketData(): DailyAnalysisMarketData {
  const candles = Array.from({ length: 120 }, (_, index) => ({
    time: `2026-04-${String((index % 28) + 1).padStart(2, '0')}T00:00:00+07:00`,
    open: 68000 + index,
    high: 68050 + index,
    low: 67950 + index,
    close: 68010 + index,
    volume: 1000 + index
  }));

  return {
    symbol: 'BTCUSDT',
    exchange: 'Binance',
    timestamp: '2026-04-07T20:30:00+07:00',
    currentPrice: 68395.2,
    session: 'Asia',
    strategyProfile: {
      biasFrame: 'D1',
      setupFrame: 'H4',
      entryRefinementFrame: 'none',
      strategyType: 'breakout_following',
      allowNoTrade: true,
      minimumRr: 1.5,
      preferredBreakoutRr: 2,
      avoidScalpingLogic: true
    },
    timeframes: {
      D1: {
        trend: 'bullish',
        ohlcv: candles,
        ema20: 67520.4,
        ema50: 66210.8,
        ema200: 59880.1,
        rsi14: 61.2,
        macd: {
          line: 820.3,
          signal: 760.1,
          histogram: 60.2
        },
        atr14: 1850.4,
        volumeRatio: 1.02,
        levels: {
          support: [67360.66, 66611.66],
          resistance: [68698.7, 69310]
        },
        swingHigh: 69310,
        swingLow: 66611.66
      },
      H4: {
        trend: 'bearish',
        ohlcv: candles,
        ema20: 68356.07,
        ema50: 68050.34,
        ema200: 68438,
        rsi14: 53.13,
        macd: {
          line: 395.15,
          signal: 423.37,
          histogram: -28.23
        },
        atr14: 912.08,
        volumeRatio: 0.2177,
        levels: {
          support: [68273.34, 68153],
          resistance: [68169.65, 68408.37]
        },
        swingHigh: 68408.37,
        swingLow: 68153
      }
    },
    marketFlags: {
      majorNewsNearby: false,
      liquidityCondition: 'normal',
      marketRegime: 'compressed'
    }
  };
}

function makeDraft(): DailyAnalysisAnalystDraft {
  return {
    summary: 'Draft summary',
    bias: 'Neutral',
    confidence: 42,
    status: 'WAIT',
    timeframeContext: {
      biasFrame: 'D1',
      setupFrame: 'H4',
      entryRefinementFrame: 'none',
      higherTimeframeView: 'D1 bullish.',
      setupTimeframeView: 'H4 bearish.',
      alignment: 'conflicting'
    },
    marketState: {
      trendCondition: 'compressed',
      volumeCondition: 'very_weak',
      volatilityCondition: 'normal',
      keyObservation: 'Setup is still compressed.'
    },
    setupType: 'breakout',
    noTradeZone: 'Avoid the current compression range.',
    primarySetup: {
      direction: 'long',
      trigger: 'H4 close above 68408.37',
      entry: 'Wait for confirmation.',
      stopLoss: 'Below 68153',
      takeProfit1: '68698.7',
      takeProfit2: '69310',
      riskReward: '2.0',
      invalidation: 'Close back below 68153'
    },
    secondarySetup: {
      direction: 'none',
      trigger: 'No secondary setup',
      entry: 'N/A',
      stopLoss: 'N/A',
      takeProfit1: 'N/A',
      takeProfit2: 'N/A',
      riskReward: 'N/A',
      invalidation: 'N/A'
    },
    atrConsistencyCheck: {
      result: 'WARNING',
      details: 'ATR is acceptable but breakout still lacks confirmation.'
    },
    logicConsistencyCheck: {
      result: 'PASS',
      details: 'Draft follows breakout-following logic.'
    },
    reasoning: ['D1 bullish, H4 compressed.', 'Wait for breakout confirmation.'],
    finalAction: 'Wait for breakout confirmation.'
  };
}

function makeValidatorResult(): DailyAnalysisValidatorResult {
  return {
    validationResult: 'REJECTED',
    summary: 'Validator prefers WAIT.',
    majorIssues: ['Weak volume plus timeframe conflict.'],
    minorIssues: [],
    checks: {
      timeframeConsistency: {
        result: 'FAIL',
        details: 'D1/H4 conflict is not good enough for TRADE_READY.'
      },
      breakoutLogic: {
        result: 'PASS',
        details: 'Breakout structure is valid.'
      },
      riskReward: {
        result: 'PASS',
        details: 'RR is acceptable on paper.'
      },
      atrConsistency: {
        result: 'WARNING',
        details: 'ATR is decent but not compelling.'
      },
      volumeConfirmation: {
        result: 'FAIL',
        details: 'Volume is too weak.'
      },
      narrativeVsAction: {
        result: 'PASS',
        details: 'Narrative matches a cautious stance.'
      },
      structureQuality: {
        result: 'PASS',
        details: 'Structure is clear enough for a watchlist entry.'
      }
    },
    correctedPlan: {
      summary: 'Prefer WAIT until the market confirms breakout with stronger participation.',
      bias: 'Neutral',
      confidence: 30,
      status: 'WAIT',
      setupType: 'no-trade',
      primarySetup: {
        direction: 'none',
        trigger: 'No valid trigger yet',
        entry: 'Wait',
        stopLoss: 'N/A',
        takeProfit1: 'N/A',
        takeProfit2: 'N/A',
        riskReward: 'N/A',
        invalidation: 'N/A'
      },
      finalAction: 'Stand aside until the structure improves.'
    },
    finalDecisionNote: 'Reject for now and wait for better confirmation.'
  };
}

function makeHardCheckResult(): DailyAnalysisHardCheckResult {
  return {
    valid: false,
    issues: ['Weak volume combined with timeframe conflict: should prefer WAIT or NO_TRADE.'],
    warnings: [],
    derivedStatus: 'WAIT'
  };
}

describe('publishDailyAnalysisPlan', () => {
  it('publishes the corrected plan when validator approves and hard checks pass', () => {
    const marketData = makeMarketData();
    const draft = makeDraft();
    const validatorResult = {
      ...makeValidatorResult(),
      validationResult: 'APPROVED_WITH_ADJUSTMENTS' as const,
      correctedPlan: {
        ...makeValidatorResult().correctedPlan,
        status: 'WAIT' as const
      }
    };
    const hardCheckResult = {
      valid: true,
      issues: [],
      warnings: ['RR is acceptable but not ideal'],
      derivedStatus: 'TRADE_READY' as const
    };

    const result = publishDailyAnalysisPlan({
      marketData,
      analystDraft: draft,
      validatorResult,
      hardCheckResult
    });

    expect(result.plan.status).toBe('WAIT');
    expect(result.plan.summary).toContain('Prefer WAIT');
    expect(result.plan.timeframeContext.biasFrame).toBe('D1');
    expect(result.plan.marketState.keyObservation).toContain('compressed');
    expect(result.plan.primarySetup.direction).toBe('none');
    expect(result.debug.hardCheckResult).toEqual(hardCheckResult);
  });

  it('falls back to a safe no-trade plan when validator rejects or hard checks fail', () => {
    const marketData = makeMarketData();
    const draft = makeDraft();
    const result = publishDailyAnalysisPlan({
      marketData,
      analystDraft: draft,
      validatorResult: makeValidatorResult(),
      hardCheckResult: makeHardCheckResult()
    });

    expect(result.plan.status).toBe('WAIT');
    expect(result.plan.setupType).toBe('no-trade');
    expect(result.plan.bias).toBe('Neutral');
    expect(result.plan.confidence).toBeLessThanOrEqual(30);
    expect(result.plan.summary).toContain('Wait for confirmation:');
    expect(result.plan.finalAction).toContain('Wait for stronger confirmation');
    expect(result.debug.validatorResult.validationResult).toBe('REJECTED');
  });
});
