# D1 H4 Breakout Daily Analysis Design

**Goal:** Refine structured daily analysis so the AI receives a smaller, clearer signal set focused on breakout-following trend behavior using only `D1` and `H4`.

**Why Change**

The current structured daily analysis is still too close to a plain market-structure summary:

- `D1` trend and levels
- `H4` trend and levels

That is useful context, but not enough to consistently produce a higher-quality breakout-following trend plan. At the same time, adding too many timeframes or too many overlapping indicators would make the LLM noisy and inconsistent.

The new design should improve signal quality without overloading the model.

**Direction Chosen**

Use exactly two timeframes:

- `D1` for context
- `H4` for primary planning

Do not include `H1` for now.

This keeps the prompt compact and aligned with the desired trading style:

- follow dominant trend
- watch for breakout continuation
- avoid counter-trend bias from lower-timeframe noise

**Input Design**

### D1: Context Frame

Use `D1` only to describe the larger directional environment and major levels:

- `trend`
- `S1`, `S2`
- `R1`, `R2`

`D1` should answer:

- what is the broader bias?
- what are the higher-timeframe breakout or rejection areas?

### H4: Primary Planning Frame

Use `H4` as the main planning frame. It should include:

- `trend`
- `S1`, `S2`
- `R1`, `R2`
- `EMA20`
- `EMA50`
- `EMA200`
- `RSI14`
- `MACD`
- `ATR14`
- `volumeRatio`

`H4` should answer:

- is the current trend structurally healthy?
- does momentum support a breakout-following continuation?
- is the move likely to have participation and enough volatility?

**Trading Style Rules For The LLM**

The prompt should explicitly prioritize:

- breakout-following trend
- alignment with `D1` bias and `H4` structure
- waiting for confirmation instead of forcing trades

The prompt should explicitly discourage:

- counter-trend setups
- reversal-catching logic
- over-weighting oscillator conflicts against clear trend structure

If `D1` and `H4` disagree, the AI should downgrade confidence and become more conservative instead of inventing a strong plan.

**Expected Effect On Output**

The structured output format can stay the same:

- `analysis`
- `bias`
- `confidence`
- `tradePlan`
- `scenarios`
- `riskNote`
- `timeHorizon`

But the quality of those fields should improve because the model sees:

- broader context from `D1`
- actual breakout confirmation inputs from `H4`

This should make the `tradePlan` more actionable:

- clearer breakout level
- better invalidation
- better distinction between “ready” and “wait”

**Implementation Approach**

1. Keep the existing `DailyAnalysis` storage model and output shape.
2. Extend the daily-analysis gateway input so it carries:
   - `d1` structure
   - `h4` structure
   - `h4Indicators`
3. Reuse existing core indicator utilities instead of creating new formulas.
4. Update the Claude prompt to emphasize breakout-following trend logic.
5. Keep Telegram formatting unchanged at the interface level, but let it reflect the richer AI plan text.

**Non-Goals**

- adding `H1`
- adding more timeframes
- adding many extra indicators with overlapping meaning
- changing the stored AI output schema again

This is a prompt/input-quality improvement, not another persistence refactor.
