type DailyAnalysisHardCheckDirection = 'long' | 'short' | 'none';

export type DailyAnalysisHardCheckInput = {
  strategyType: string;
  minimumRr: number;
  preferredBreakoutRr?: number;
  breakoutLevel?: number;
  breakdownLevel?: number;
  direction?: DailyAnalysisHardCheckDirection;
  entry?: number;
  stopLoss?: number;
  takeProfit1?: number;
  atrSetupFrame?: number;
  volumeRatio?: number;
  higherTimeframeAligned?: boolean;
  status?: string;
  narrativeText?: string;
};

export type DailyAnalysisHardCheckResult = {
  valid: boolean;
  issues: string[];
  warnings: string[];
  derivedStatus: 'TRADE_READY' | 'WAIT' | 'NO_TRADE';
};

export function runDailyAnalysisHardChecks(
  input: DailyAnalysisHardCheckInput
): DailyAnalysisHardCheckResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  const rr = calculateRiskReward(input.entry, input.stopLoss, input.takeProfit1);

  if (rr != null) {
    if (rr < input.minimumRr) {
      issues.push(`RR too low: ${rr.toFixed(2)} < ${input.minimumRr}`);
    } else if (input.preferredBreakoutRr != null && rr < input.preferredBreakoutRr) {
      warnings.push(
        `RR below preferred breakout RR: ${rr.toFixed(2)} < ${input.preferredBreakoutRr}`
      );
    }
  }

  if (
    input.strategyType === 'breakout_following' &&
    input.direction === 'long' &&
    input.breakoutLevel != null &&
    input.takeProfit1 != null &&
    input.takeProfit1 <= input.breakoutLevel
  ) {
    issues.push('TP1 is at or below breakout level for a breakout long setup.');
  }

  if (
    input.strategyType === 'breakout_following' &&
    input.direction === 'short' &&
    input.breakdownLevel != null &&
    input.takeProfit1 != null &&
    input.takeProfit1 >= input.breakdownLevel
  ) {
    issues.push('TP1 is at or above breakdown level for a breakout short setup.');
  }

  if (
    input.strategyType === 'breakout_following' &&
    input.atrSetupFrame != null &&
    input.entry != null &&
    input.takeProfit1 != null
  ) {
    const tpDistance = Math.abs(input.takeProfit1 - input.entry);

    if (tpDistance < input.atrSetupFrame * 0.5) {
      issues.push('TP distance is too small relative to setup-frame ATR for a breakout setup.');
    }
  }

  if (input.volumeRatio != null && input.volumeRatio < 0.5 && input.higherTimeframeAligned === false) {
    issues.push('Weak volume combined with timeframe conflict: should prefer WAIT or NO_TRADE.');
  }

  if (
    input.narrativeText &&
    input.status === 'TRADE_READY' &&
    /(wait|unclear|mixed|conflict|compressed|no confirmation)/i.test(input.narrativeText)
  ) {
    issues.push('Narrative suggests caution or no-trade, but status is TRADE_READY.');
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    derivedStatus: deriveStatus(issues, warnings)
  };
}

function calculateRiskReward(
  entry?: number,
  stopLoss?: number,
  takeProfit1?: number
): number | null {
  if (entry == null || stopLoss == null || takeProfit1 == null) {
    return null;
  }

  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit1)) {
    return null;
  }

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit1 - entry);

  if (risk <= 0 || reward <= 0) {
    return 0;
  }

  return reward / risk;
}

function deriveStatus(
  issues: string[],
  warnings: string[]
): 'TRADE_READY' | 'WAIT' | 'NO_TRADE' {
  if (issues.length > 0) {
    const waitOnlyIssues = [
      'Weak volume combined with timeframe conflict: should prefer WAIT or NO_TRADE.',
      'Narrative suggests caution or no-trade, but status is TRADE_READY.'
    ];
    const hasOnlyWaitSignals = issues.every((issue) => waitOnlyIssues.includes(issue));

    if (hasOnlyWaitSignals) {
      return 'WAIT';
    }

    return 'NO_TRADE';
  }

  if (warnings.length > 0) {
    return 'TRADE_READY';
  }

  return 'TRADE_READY';
}
