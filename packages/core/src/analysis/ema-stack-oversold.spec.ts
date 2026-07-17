import {
  scoreEmaStackOversoldSetup,
  formatEmaStackPa,
  EMA_STACK_SCORE_WEIGHTS,
  EMA_STACK_OVERSOLD_MIN_CANDLES,
  type EmaStackPaInput,
} from './ema-stack-oversold';

/**
 * Builds a series that lands in the scanner's universe: a long decline (bearish EMA stack,
 * price stretched below EMA34) so `scoreEmaStackOversoldSetup` returns a setup and we can
 * assert on the PA block in isolation.
 */
function decliningCloses(n = EMA_STACK_OVERSOLD_MIN_CANDLES + 20): number[] {
  const closes: number[] = [];
  for (let i = 0; i < n; i++) closes.push(1000 * Math.exp(-0.004 * i));
  return closes;
}

/** PA input whose swing structure is driven by the highs/lows we pass in. */
function paOf(closes: number[], over: Partial<EmaStackPaInput> = {}): EmaStackPaInput {
  return {
    highs: closes.map((c) => c * 1.01),
    lows: closes.map((c) => c * 0.99),
    htfTrend: 'Neutral',
    htfLabel: 'D1',
    ...over,
  };
}

describe('scoreEmaStackOversoldSetup — PA block', () => {
  const closes = decliningCloses();

  it('scores a setup and never exceeds 100', () => {
    const s = scoreEmaStackOversoldSetup(closes, paOf(closes, { htfTrend: 'StrongUp' }));
    expect(s).not.toBeNull();
    expect(s!.score).toBeGreaterThan(0);
    expect(s!.score).toBeLessThanOrEqual(100);
  });

  it('gives a bounce WITH the higher timeframe more points than one against it', () => {
    const withHtf = scoreEmaStackOversoldSetup(closes, paOf(closes, { htfTrend: 'StrongUp' }));
    const against = scoreEmaStackOversoldSetup(closes, paOf(closes, { htfTrend: 'StrongDown' }));

    expect(withHtf!.breakdown.htfTrend).toBe(EMA_STACK_SCORE_WEIGHTS.htfTrend);
    expect(against!.breakdown.htfTrend).toBe(0);
    // Only the HTF differs, so the whole gap is the PA trend's doing.
    expect(withHtf!.score - against!.score).toBe(EMA_STACK_SCORE_WEIGHTS.htfTrend);
  });

  it('ranks the 5 HTF trends monotonically', () => {
    const pts = (['StrongUp', 'Up', 'Neutral', 'Down', 'StrongDown'] as const).map(
      (t) => scoreEmaStackOversoldSetup(closes, paOf(closes, { htfTrend: t }))!.breakdown.htfTrend,
    );
    expect(pts).toEqual([...pts].sort((a, b) => b - a));
    expect(new Set(pts).size).toBe(pts.length);
  });

  it('PA alone cannot surface a coin — the signal gate still rules', () => {
    // Flat series: below no EMA34, no stretch/oversold/cross → null regardless of a perfect HTF.
    const flat = new Array(EMA_STACK_OVERSOLD_MIN_CANDLES + 20).fill(100);
    expect(scoreEmaStackOversoldSetup(flat, paOf(flat, { htfTrend: 'StrongUp' }))).toBeNull();
  });

  it('does not let PA change the stage (stage = strict entry only)', () => {
    const good = scoreEmaStackOversoldSetup(closes, paOf(closes, { htfTrend: 'StrongUp' }));
    const bad = scoreEmaStackOversoldSetup(closes, paOf(closes, { htfTrend: 'StrongDown' }));
    expect(good!.stage).toBe(bad!.stage);
  });

  it('reports the structure it scored and reflects it in the score', () => {
    const s = scoreEmaStackOversoldSetup(closes, paOf(closes));
    expect(s!.swingStructure).toBeDefined();
    expect(s!.breakdown.structure).toBe(
      { HH_HL: 8, LH_HL: 6, Mixed: 4, HH_LL: 2, LH_LL: 0 }[s!.swingStructure],
    );
  });

  it('surfaces the higher timeframe it read, and flags an opposing one', () => {
    const s = scoreEmaStackOversoldSetup(closes, paOf(closes, { htfTrend: 'StrongDown', htfLabel: 'W1' }));
    expect(s!.htfLabel).toBe('W1');
    expect(s!.reasons.some((r) => r.includes('W1') && r.includes('ngược'))).toBe(true);
    expect(formatEmaStackPa(s!)).toContain('⚠️');
  });
});
