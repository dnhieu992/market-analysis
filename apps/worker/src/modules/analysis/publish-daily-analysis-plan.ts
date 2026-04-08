import type {
  DailyAnalysisAnalystDraft,
  DailyAnalysisHardCheckResult,
  DailyAnalysisMarketData,
  DailyAnalysisPlan,
  DailyAnalysisValidatorResult
} from '@app/core';
import { runDailyAnalysisHardChecks } from '@app/core';

type PublishDailyAnalysisPlanInput = {
  marketData: DailyAnalysisMarketData;
  analystDraft: DailyAnalysisAnalystDraft;
  validatorResult: DailyAnalysisValidatorResult;
  hardCheckResult?: DailyAnalysisHardCheckResult;
};

type PublishDailyAnalysisPlanResult = {
  plan: DailyAnalysisPlan;
  decision: 'PUBLISHED' | 'SAFE_FALLBACK';
  debug: {
    marketData: DailyAnalysisMarketData;
    analystDraft: DailyAnalysisAnalystDraft;
    validatorResult: DailyAnalysisValidatorResult;
    hardCheckResult: DailyAnalysisHardCheckResult;
  };
};

export function publishDailyAnalysisPlan(
  input: PublishDailyAnalysisPlanInput
): PublishDailyAnalysisPlanResult {
  const hardCheckResult =
    input.hardCheckResult ??
    runDailyAnalysisHardChecks(buildHardCheckInput(input.marketData, input.analystDraft, input.validatorResult));

  const canPublish =
    input.validatorResult.validationResult !== 'REJECTED' && hardCheckResult.valid;

  if (canPublish) {
    const plan = buildPublishedPlan({
      marketData: input.marketData,
      analystDraft: input.analystDraft,
      validatorResult: input.validatorResult,
      hardCheckResult
    });

    return {
      plan,
      decision: 'PUBLISHED',
      debug: {
        marketData: input.marketData,
        analystDraft: input.analystDraft,
        validatorResult: input.validatorResult,
        hardCheckResult
      }
    };
  }

  const plan = buildFallbackPlan({
    marketData: input.marketData,
    analystDraft: input.analystDraft,
    validatorResult: input.validatorResult,
    hardCheckResult
  });

  return {
    plan,
    decision: 'SAFE_FALLBACK',
    debug: {
      marketData: input.marketData,
      analystDraft: input.analystDraft,
      validatorResult: input.validatorResult,
      hardCheckResult
    }
  };
}

function buildPublishedPlan(input: {
  marketData: DailyAnalysisMarketData;
  analystDraft: DailyAnalysisAnalystDraft;
  validatorResult: DailyAnalysisValidatorResult;
  hardCheckResult: DailyAnalysisHardCheckResult;
}): DailyAnalysisPlan {
  const correctedPlan = input.validatorResult.correctedPlan;

  return {
    summary: correctedPlan.summary ?? input.validatorResult.summary ?? input.analystDraft.summary,
    bias: correctedPlan.bias ?? input.analystDraft.bias,
    confidence: correctedPlan.confidence ?? input.analystDraft.confidence,
    status: correctedPlan.status ?? input.analystDraft.status,
    timeframeContext: input.analystDraft.timeframeContext,
    marketState: input.analystDraft.marketState,
    setupType: correctedPlan.setupType ?? input.analystDraft.setupType,
    noTradeZone: input.analystDraft.noTradeZone,
    primarySetup: correctedPlan.primarySetup ?? input.analystDraft.primarySetup,
    secondarySetup: input.analystDraft.secondarySetup,
    finalAction: correctedPlan.finalAction ?? input.analystDraft.finalAction,
    reasoning: mergeReasoning(
      input.analystDraft.reasoning,
      input.validatorResult.summary,
      input.hardCheckResult
    ),
    atrConsistencyCheck: normalizePublishedCheck(
      input.analystDraft.atrConsistencyCheck,
      input.hardCheckResult,
      'atr'
    ),
    logicConsistencyCheck: normalizePublishedCheck(
      input.analystDraft.logicConsistencyCheck,
      input.hardCheckResult,
      'logic'
    )
  };
}

function buildFallbackPlan(input: {
  marketData: DailyAnalysisMarketData;
  analystDraft: DailyAnalysisAnalystDraft;
  validatorResult: DailyAnalysisValidatorResult;
  hardCheckResult: DailyAnalysisHardCheckResult;
}): DailyAnalysisPlan {
  const status = input.hardCheckResult.derivedStatus === 'NO_TRADE' ? 'NO_TRADE' : 'WAIT';
  const summary = buildFallbackSummary(status, input.validatorResult, input.hardCheckResult);
  const fallbackPlan: DailyAnalysisPlan = {
    summary,
    bias: 'Neutral',
    confidence: Math.min(input.analystDraft.confidence, 30),
    status,
    timeframeContext: input.analystDraft.timeframeContext,
    marketState: input.analystDraft.marketState,
    setupType: 'no-trade',
    noTradeZone: input.analystDraft.noTradeZone,
    primarySetup: {
      direction: 'none',
      trigger: 'No valid trigger yet',
      entry: 'Wait for confirmation.',
      stopLoss: 'N/A',
      takeProfit1: 'N/A',
      takeProfit2: 'N/A',
      riskReward: 'N/A',
      invalidation: 'N/A'
    },
    secondarySetup: input.analystDraft.secondarySetup,
    finalAction: status === 'NO_TRADE' ? 'Stand aside and wait for a new structure.' : 'Wait for stronger confirmation and better volume.',
    reasoning: mergeReasoning(
      input.analystDraft.reasoning,
      input.validatorResult.summary,
      input.hardCheckResult
    ),
    atrConsistencyCheck: normalizePublishedCheck(
      input.analystDraft.atrConsistencyCheck,
      input.hardCheckResult,
      'atr'
    ),
    logicConsistencyCheck: normalizePublishedCheck(
      input.analystDraft.logicConsistencyCheck,
      input.hardCheckResult,
      'logic'
    )
  };

  return fallbackPlan;
}

function buildFallbackSummary(
  status: 'WAIT' | 'NO_TRADE',
  validatorResult: DailyAnalysisValidatorResult,
  hardCheckResult: DailyAnalysisHardCheckResult
): string {
  const issueText = hardCheckResult.issues.length > 0 ? hardCheckResult.issues[0] : validatorResult.summary;

  if (status === 'NO_TRADE') {
    return `No-trade fallback: ${issueText}`;
  }

  return `Wait for confirmation: ${issueText}`;
}

function mergeReasoning(
  reasoning: string[],
  validatorSummary: string,
  hardCheckResult: DailyAnalysisHardCheckResult
): string[] {
  const merged = [...reasoning];

  if (!merged.includes(validatorSummary)) {
    merged.push(validatorSummary);
  }

  for (const issue of hardCheckResult.issues) {
    if (!merged.includes(issue)) {
      merged.push(issue);
    }
  }

  for (const warning of hardCheckResult.warnings) {
    if (!merged.includes(warning)) {
      merged.push(warning);
    }
  }

  return merged;
}

function normalizePublishedCheck(
  source: DailyAnalysisAnalystDraft['atrConsistencyCheck'],
  hardCheckResult: DailyAnalysisHardCheckResult,
  kind: 'atr' | 'logic'
): DailyAnalysisAnalystDraft['atrConsistencyCheck'] {
  const hasRelevantIssue =
    kind === 'atr'
      ? hardCheckResult.issues.some((issue) => issue.includes('ATR') || issue.includes('RR too low'))
      : hardCheckResult.issues.some(
          (issue) =>
            issue.includes('breakout') ||
            issue.includes('Weak volume') ||
            issue.includes('Narrative suggests')
        );

  if (!hasRelevantIssue) {
    return source;
  }

  return {
    result: hardCheckResult.valid ? source.result : 'WARNING',
    details: [...hardCheckResult.issues, ...hardCheckResult.warnings].join(' | ') || source.details
  };
}

function buildHardCheckInput(
  marketData: DailyAnalysisMarketData,
  analystDraft: DailyAnalysisAnalystDraft,
  validatorResult: DailyAnalysisValidatorResult
) {
  const h4 = marketData.timeframes.H4;
  const direction = normalizeDirection(
    validatorResult.correctedPlan.primarySetup.direction ?? analystDraft.primarySetup.direction
  );

  return {
    strategyType: marketData.strategyProfile.strategyType,
    minimumRr: marketData.strategyProfile.minimumRr,
    preferredBreakoutRr: marketData.strategyProfile.preferredBreakoutRr,
    breakoutLevel: direction === 'long' ? getBreakoutLevel(h4.levels.resistance) : undefined,
    breakdownLevel: direction === 'short' ? getBreakdownLevel(h4.levels.support) : undefined,
    direction,
    entry: parsePrice(validatorResult.correctedPlan.primarySetup.entry ?? analystDraft.primarySetup.entry),
    stopLoss: parsePrice(
      validatorResult.correctedPlan.primarySetup.stopLoss ?? analystDraft.primarySetup.stopLoss
    ),
    takeProfit1: parsePrice(
      validatorResult.correctedPlan.primarySetup.takeProfit1 ?? analystDraft.primarySetup.takeProfit1
    ),
    atrSetupFrame: h4.atr14,
    volumeRatio: h4.volumeRatio,
    higherTimeframeAligned: marketData.timeframes.D1.trend === marketData.timeframes.H4.trend &&
      marketData.timeframes.D1.trend !== 'neutral',
    status: validatorResult.correctedPlan.status ?? analystDraft.status,
    narrativeText: [validatorResult.correctedPlan.summary, validatorResult.summary, analystDraft.summary]
      .filter(Boolean)
      .join(' ')
  };
}

function normalizeDirection(value: string): 'long' | 'short' | 'none' {
  if (value === 'long' || value === 'short') {
    return value;
  }

  return 'none';
}

function parsePrice(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const match = value.match(/-?\d+(?:\.\d+)?/);

  if (!match) {
    return undefined;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getBreakoutLevel(levels: number[]): number | undefined {
  const finiteLevels = levels.filter((value) => Number.isFinite(value));

  if (finiteLevels.length === 0) {
    return undefined;
  }

  return Math.max(...finiteLevels);
}

function getBreakdownLevel(levels: number[]): number | undefined {
  const finiteLevels = levels.filter((value) => Number.isFinite(value));

  if (finiteLevels.length === 0) {
    return undefined;
  }

  return Math.min(...finiteLevels);
}
