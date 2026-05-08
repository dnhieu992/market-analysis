// ─── AI Response Types ────────────────────────────────────────────────────────

export type TakeProfit = {
  price: number;
  size_pct: number;
  reason: string;
};

export type BuySetup = {
  type: 'Aggressive Breakout' | 'Conservative Retest' | 'Patient Pullback';
  entry_zone: [number, number];
  entry_target: number;
  stop_loss: number;
  stop_loss_reason: string;
  take_profit: TakeProfit[];
  risk_reward: number;
  confidence: number;
  confluence_factors: string[];
  reasoning: string;
  warnings?: string[];
};

export type PatternDetected = {
  name: string;
  timeframe: 'Daily' | '4H';
  duration_candles: number;
  quality_score: number;
  breakout_status: 'none' | 'imminent' | 'confirmed' | 'failed';
  key_level: number;
  volume_confirmation: boolean;
  notes: string;
};

export type TrendAlignment = {
  weekly: string;
  daily: string;
  fourHour: string;
  aligned: boolean;
};

export type Recommendation = 'BUY_NOW' | 'WAIT_FOR_PULLBACK' | 'WAIT_FOR_BREAKOUT' | 'SKIP';
export type OverallAssessment = 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNCLEAR';

export type SwingSignalAiResponse = {
  symbol: string;
  current_price: number;
  overall_assessment: OverallAssessment;
  trend_alignment: TrendAlignment;
  patterns_detected: PatternDetected[];
  buy_setups: BuySetup[];
  risk_factors: string[];
  recommendation: Recommendation;
  summary: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_RISK_REWARD = 2.0;
const MIN_SL_DISTANCE_PCT = 1.5;
const MAX_SL_DISTANCE_PCT = 15;
const MAX_ENTRY_DISTANCE_PCT = 10;
const MIN_CONFIDENCE_WARN = 6;

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseAiResponse(raw: string): SwingSignalAiResponse | null {
  try {
    const trimmed = raw.trim();
    // Strip markdown fences if AI added them
    const jsonStr = trimmed.startsWith('```')
      ? trimmed
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/, '')
          .trim()
      : trimmed;

    const parsed = JSON.parse(jsonStr) as unknown;

    if (!isValidShape(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isValidShape(value: unknown): value is SwingSignalAiResponse {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['symbol'] === 'string' &&
    typeof obj['current_price'] === 'number' &&
    typeof obj['recommendation'] === 'string' &&
    Array.isArray(obj['buy_setups'])
  );
}

// ─── Hard Rules ───────────────────────────────────────────────────────────────

function validateSetup(
  setup: BuySetup,
  currentPrice: number
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // RULE 1: TP1 > current_price
  const tp1 = setup.take_profit[0];
  if (!tp1 || tp1.price <= currentPrice) {
    return { valid: false, warnings: ['TP1 below or at current price'] };
  }

  // RULE 2: SL < entry_target
  if (setup.stop_loss >= setup.entry_target) {
    return { valid: false, warnings: ['SL not below entry target'] };
  }

  // RULE 3: R:R recompute and override
  const risk = setup.entry_target - setup.stop_loss;
  const reward = tp1.price - setup.entry_target;
  if (risk <= 0) {
    return { valid: false, warnings: ['Risk is zero or negative'] };
  }
  const actualRr = reward / risk;
  setup.risk_reward = parseFloat(actualRr.toFixed(2));

  if (actualRr < MIN_RISK_REWARD) {
    return { valid: false, warnings: [`R:R too low: ${actualRr.toFixed(2)}`] };
  }

  // RULE 4: SL distance 1.5%–15%
  const slDistancePct = ((setup.entry_target - setup.stop_loss) / setup.entry_target) * 100;
  if (slDistancePct < MIN_SL_DISTANCE_PCT) {
    return { valid: false, warnings: [`SL too tight: ${slDistancePct.toFixed(2)}%`] };
  }
  if (slDistancePct > MAX_SL_DISTANCE_PCT) {
    return { valid: false, warnings: [`SL too wide: ${slDistancePct.toFixed(2)}%`] };
  }

  // RULE 5: TPs ascending order
  for (let i = 1; i < setup.take_profit.length; i++) {
    if ((setup.take_profit[i]?.price ?? 0) <= (setup.take_profit[i - 1]?.price ?? 0)) {
      return { valid: false, warnings: ['TPs not in ascending order'] };
    }
  }

  // RULE 6: TP percentages normalize to 100
  const totalPct = setup.take_profit.reduce((sum, tp) => sum + tp.size_pct, 0);
  if (Math.abs(totalPct - 100) > 2) {
    const factor = 100 / totalPct;
    setup.take_profit = setup.take_profit.map((tp) => ({
      ...tp,
      size_pct: parseFloat((tp.size_pct * factor).toFixed(1))
    }));
  }

  // RULE 7: Entry target within entry zone
  let [zoneLow, zoneHigh] = setup.entry_zone;
  if (zoneLow !== undefined && zoneHigh !== undefined && zoneLow > zoneHigh) {
    setup.entry_zone = [zoneHigh, zoneLow];
    [zoneLow, zoneHigh] = [zoneHigh, zoneLow];
  }
  if (
    zoneLow !== undefined &&
    zoneHigh !== undefined &&
    (setup.entry_target < zoneLow || setup.entry_target > zoneHigh)
  ) {
    return { valid: false, warnings: ['Entry target outside entry zone'] };
  }

  // Soft rules — warn but keep
  const entryDistancePct =
    (Math.abs(setup.entry_target - currentPrice) / currentPrice) * 100;
  if (entryDistancePct > MAX_ENTRY_DISTANCE_PCT) {
    warnings.push(`Entry ${entryDistancePct.toFixed(1)}% from current price`);
  }
  if (setup.confidence < MIN_CONFIDENCE_WARN) {
    warnings.push(`Low confidence: ${setup.confidence}/10`);
  }

  return { valid: true, warnings };
}

// ─── Validation Result with Rejection Details ─────────────────────────────────

export type ValidationResult = {
  analysis: SwingSignalAiResponse;
  rawSetupCount: number;
  rejections: string[];
};

export function validateAnalysisWithDetails(
  analysis: SwingSignalAiResponse,
  currentPrice: number
): ValidationResult {
  const rawSetupCount = analysis.buy_setups.length;
  const rejections: string[] = [];

  const mtfWarning = !analysis.trend_alignment.aligned
    ? ['Multi-timeframe trends not aligned']
    : [];

  const validSetups: BuySetup[] = [];

  for (const setup of analysis.buy_setups) {
    const { valid, warnings } = validateSetup(setup, currentPrice);
    if (valid) {
      setup.warnings = [...mtfWarning, ...warnings];
      validSetups.push(setup);
    } else {
      rejections.push(`${setup.type}: ${warnings.join(', ')}`);
    }
  }

  validSetups.sort((a, b) => b.confidence - a.confidence);
  analysis.buy_setups = validSetups;

  if (validSetups.length === 0) {
    analysis.recommendation = 'SKIP';
  }

  const validRecs: Recommendation[] = ['BUY_NOW', 'WAIT_FOR_PULLBACK', 'WAIT_FOR_BREAKOUT', 'SKIP'];
  if (!validRecs.includes(analysis.recommendation)) {
    analysis.recommendation = 'SKIP';
  }

  return { analysis, rawSetupCount, rejections };
}

// ─── Main Validator ───────────────────────────────────────────────────────────

export function validateAnalysis(
  analysis: SwingSignalAiResponse,
  currentPrice: number
): SwingSignalAiResponse {
  // Add MTF alignment warning to each setup if not aligned
  const mtfWarning = !analysis.trend_alignment.aligned
    ? ['Multi-timeframe trends not aligned']
    : [];

  const validSetups: BuySetup[] = [];

  for (const setup of analysis.buy_setups) {
    const { valid, warnings } = validateSetup(setup, currentPrice);
    if (valid) {
      setup.warnings = [...(mtfWarning), ...warnings];
      validSetups.push(setup);
    }
  }

  // Sort by confidence descending
  validSetups.sort((a, b) => b.confidence - a.confidence);
  analysis.buy_setups = validSetups;

  // If no valid setups remain, force SKIP
  if (validSetups.length === 0) {
    analysis.recommendation = 'SKIP';
  }

  // Normalize recommendation
  const validRecs: Recommendation[] = ['BUY_NOW', 'WAIT_FOR_PULLBACK', 'WAIT_FOR_BREAKOUT', 'SKIP'];
  if (!validRecs.includes(analysis.recommendation)) {
    analysis.recommendation = 'SKIP';
  }

  return analysis;
}
