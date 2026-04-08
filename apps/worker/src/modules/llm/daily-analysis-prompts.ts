import type { DailyAnalysisAnalystDraft, DailyAnalysisMarketData } from '@app/core';

function stringifyMarketData(marketData: DailyAnalysisMarketData): string {
  return JSON.stringify(marketData);
}

export function buildDailyAnalysisAnalystPrompt(marketData: DailyAnalysisMarketData): string {
  return [
    'You are the Analyst for a daily crypto trading plan.',
    'Follow the declared strategy profile exactly:',
    '- bias_frame = D1',
    '- setup_frame = H4',
    '- entry_refinement_frame = none',
    '- strategy_type = breakout_following',
    '- do not use scalping logic or lower-timeframe noise',
    '',
    'Business rules:',
    '- breakout-following only',
    '- WAIT and NO_TRADE are valid and preferred when conditions are weak, conflicting, compressed, or unconfirmed',
    '- respect risk/reward discipline',
    '- respect ATR discipline',
    '- respect volume confirmation discipline',
    '- the narrative and final action must agree',
    '',
    'Output rules:',
    '- return JSON only',
    '- do not use markdown',
    '- do not wrap the output in code fences',
    '- fill every required field in the draft schema',
    '- keep the response concise, technical, and consistent with the market data',
    '',
    'market_data:',
    stringifyMarketData(marketData)
  ].join('\n');
}

export function buildDailyAnalysisValidatorPrompt(input: {
  marketData: DailyAnalysisMarketData;
  draftPlan: DailyAnalysisAnalystDraft;
}): string {
  return [
    'You are the Validator for a daily crypto trading plan.',
    'Audit the analyst draft against the original market_data.',
    '',
    'Validation rules:',
    '- keep timeframe discipline: D1 for bias, H4 for setup',
    '- keep breakout-following discipline',
    '- reject any scalping-style logic',
    '- reject plans that force TRADE_READY when WAIT or NO_TRADE is the correct outcome',
    '- apply RR caution, ATR caution, and volume caution',
    '- preserve narrative/action consistency',
    '- prefer a safe adjusted plan or WAIT when the draft is weak',
    '',
    'Output rules:',
    '- return JSON only',
    '- do not use markdown',
    '- do not wrap the output in code fences',
    '- fill every required field in the validator schema',
    '',
    'market_data:',
    stringifyMarketData(input.marketData),
    '',
    'draft_plan:',
    JSON.stringify(input.draftPlan)
  ].join('\n');
}
