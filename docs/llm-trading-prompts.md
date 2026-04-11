# LLM Trading Prompts

A production-ready two-prompt system for BTCUSDT trading analysis.

This file is designed for implementation, not just discussion. It contains:
- a recommended data contract for market input
- a two-step LLM pipeline
- an Analyst prompt
- a Validator prompt
- backend hard-rule guidance
- JSON schema recommendations
- publishing rules
- common failure patterns to avoid

The system is built to reduce common LLM mistakes such as:
- mixing H4/D1 context with M5/M15-style scalping logic
- using support/resistance levels that are too tight for the declared timeframe
- generating breakout setups whose TP sits at or below the breakout trigger
- producing low-quality plans when the correct answer should be `WAIT` or `NO_TRADE`
- writing an analysis that says “mixed/unclear” but still returning `TRADE_READY`
- using stale or context-free indicator values without enough candle history

---

## 1. Recommended Architecture

Use a 2-step review pipeline:

1. Backend prepares `market_data` as structured JSON.
2. Send `market_data` to the **Analyst** prompt.
3. Receive `draft_plan` JSON.
4. Send `market_data + draft_plan` to the **Validator** prompt.
5. Apply code-side hard checks.
6. Publish only when the validator returns:
   - `APPROVED`
   - or `APPROVED_WITH_ADJUSTMENTS`
7. If the validator returns `REJECTED`, the final published status should be `WAIT` or `NO_TRADE`.

Recommended trust order:
1. code-side hard rules
2. validator prompt
3. analyst prompt

This means:
- LLMs are used for interpretation and structured reasoning.
- Backend rules are used for final acceptance or rejection.

---

## 2. What Data You Should Send to the LLM

To improve accuracy, do not send only prose and a few indicators.
Send structured market data with enough context for the model to understand:
- current market state
- multi-timeframe structure
- volatility
- participation
- strategy constraints

### 2.1 Required categories

At minimum, include:
- symbol
- exchange
- timestamp
- current_price
- session
- strategy_profile
- D1 timeframe summary
- H4 timeframe summary
- H1 timeframe summary if used for entry refinement

### 2.2 Strongly recommended categories

Include these whenever possible:
- OHLCV candle history
- trend per timeframe
- EMA20 / EMA50 / EMA200
- RSI14
- MACD line / signal / histogram
- ATR14
- volume ratio
- swing high / swing low
- support / resistance
- breakout level or retest zone if your system precomputes them

### 2.3 Optional but useful categories

These can improve quality further when available:
- previous day high / low
- previous week high / low
- VWAP
- ADX
- Bollinger Bands
- market regime label
- funding rate
- open interest
- liquidation zones
- news or event flags
- liquidity-session label

Important:
- Indicator-only inputs are weaker than OHLCV + structure + indicators.
- If you can provide candle history, do it.
- If you cannot provide candle history, you must provide high-quality structural levels and trend labels.

---

## 3. Recommended Candle History Length

This is one of the most important missing details in many implementations.

For each timeframe, provide recent OHLCV candle history.

### Minimum and recommended ranges
- Minimum usable: 100 candles
- Recommended: 150 to 300 candles
- Typical safe default: 200 candles

### Suggested defaults by timeframe
- D1: 150 to 300 candles, recommended default = 200
- H4: 150 to 300 candles, recommended default = 200
- H1: 100 to 200 candles, recommended default = 150 or 200
- M15: only include if your strategy really uses M15 for entry refinement

### Why 100 to 300 candles is recommended
- Fewer than 100 candles can be too shallow for structure detection.
- Swing levels, volatility context, and indicator shape become less reliable with very short history.
- 100 to 300 candles usually gives enough context without overloading the model.
- Sending thousands of candles can add cost and noise without proportional benefit.

### Practical guidance
- If you only send one timeframe, 200 candles is a strong default.
- If you send D1 + H4 + H1 together, 150 to 200 candles each is usually enough.
- If token cost becomes a concern, reduce low-priority timeframes before reducing D1/H4 context.

---

## 4. Timeframe Roles Must Be Explicit

The model should never guess which timeframe is used for bias and which one is used for execution.

Always define:
- `bias_frame`
- `setup_frame`
- `entry_refinement_frame`

Example:
- `bias_frame = D1`
- `setup_frame = H4`
- `entry_refinement_frame = H1`

This prevents the model from mixing swing bias with lower-timeframe scalp logic.

---

## 5. Strategy Profile Requirements

Your backend should always send a `strategy_profile` object.

It should include at least:
- `bias_frame`
- `setup_frame`
- `entry_refinement_frame`
- `strategy_type`
- `allow_no_trade`
- `minimum_rr`
- `preferred_breakout_rr`
- `avoid_scalping_logic`

Recommended values:
- `minimum_rr = 1.5`
- `preferred_breakout_rr = 2.0`
- `allow_no_trade = true`

Do not omit `allow_no_trade`.
If you do, many models will feel pressure to invent a trade.

---

## 6. Recommended Input Schema

Use structured JSON. Avoid sending only prose.

```json
{
  "symbol": "BTCUSDT",
  "exchange": "Binance",
  "timestamp": "2026-04-07T20:30:00+07:00",
  "current_price": 68395.2,
  "session": "Asia",
  "strategy_profile": {
    "bias_frame": "D1",
    "setup_frame": "H4",
    "entry_refinement_frame": "H1",
    "strategy_type": "breakout_following",
    "allow_no_trade": true,
    "minimum_rr": 1.5,
    "preferred_breakout_rr": 2.0,
    "avoid_scalping_logic": true
  },
  "timeframes": {
    "D1": {
      "trend": "bullish",
      "ohlcv": [
        {
          "time": "2026-04-06T00:00:00+07:00",
          "open": 0,
          "high": 0,
          "low": 0,
          "close": 0,
          "volume": 0
        }
      ],
      "ema20": 67520.4,
      "ema50": 66210.8,
      "ema200": 59880.1,
      "rsi14": 61.2,
      "macd": {
        "line": 820.3,
        "signal": 760.1,
        "histogram": 60.2
      },
      "atr14": 1850.4,
      "levels": {
        "support": [67360.66, 66611.66],
        "resistance": [68698.7, 69310.0]
      },
      "swing_high": 69310.0,
      "swing_low": 66611.66,
      "prev_day_high": 0,
      "prev_day_low": 0,
      "prev_week_high": 0,
      "prev_week_low": 0
    },
    "H4": {
      "trend": "bearish",
      "ohlcv": [
        {
          "time": "2026-04-07T16:00:00+07:00",
          "open": 0,
          "high": 0,
          "low": 0,
          "close": 0,
          "volume": 0
        }
      ],
      "ema20": 68356.07,
      "ema50": 68050.34,
      "ema200": 68438.0,
      "rsi14": 53.13,
      "macd": {
        "line": 395.15,
        "signal": 423.37,
        "histogram": -28.23
      },
      "atr14": 912.08,
      "volume_ratio": 0.2177,
      "levels": {
        "support": [68273.34, 68153.0],
        "resistance": [68589.49, 68653.38]
      },
      "swing_high": 68653.38,
      "swing_low": 68153.0,
      "breakout_level": 68653.38,
      "retest_zone": [68589.49, 68653.38]
    },
    "H1": {
      "trend": "neutral",
      "ohlcv": [
        {
          "time": "2026-04-07T19:00:00+07:00",
          "open": 0,
          "high": 0,
          "low": 0,
          "close": 0,
          "volume": 0
        }
      ],
      "ema20": 0,
      "ema50": 0,
      "ema200": 0,
      "rsi14": 0,
      "macd": {
        "line": 0,
        "signal": 0,
        "histogram": 0
      },
      "atr14": 0,
      "volume_ratio": 0,
      "levels": {
        "support": [],
        "resistance": []
      }
    }
  },
  "market_flags": {
    "major_news_nearby": false,
    "liquidity_condition": "normal",
    "market_regime": "compressed"
  }
}
```

---

## 7. Minimum Useful Input vs Ideal Input

### Minimum useful input
If you want a compact payload, the minimum useful set is:
- `symbol`
- `exchange`
- `timestamp`
- `current_price`
- `strategy_profile`
- D1 trend + EMA + RSI + MACD + ATR + levels
- H4 trend + EMA + RSI + MACD + ATR + volume_ratio + levels
- H1 trend if it is used for entry refinement

### Ideal input
For best quality, use:
- `symbol`
- `exchange`
- `timestamp`
- `current_price`
- `session`
- `strategy_profile`
- D1 OHLCV 150 to 300 candles
- H4 OHLCV 150 to 300 candles
- H1 OHLCV 100 to 200 candles if used
- EMA20 / EMA50 / EMA200
- RSI14
- MACD
- ATR14
- volume_ratio
- swing high / low
- support / resistance
- breakout level / retest zone when relevant
- session/liquidity/news flags

---

## 8. Core System Rules

The following rules should exist in both prompt instructions and backend validation logic.

### 8.1 Timeframe discipline
- If the plan uses D1/H4, it must not behave like an M5/M15 scalp plan.
- TP and SL must reflect H4/D1 swing structure.
- Tight, micro-level targets should be rejected unless the strategy explicitly says scalp.

### 8.2 Breakout discipline
For breakout long:
- breakout confirmation must be clear
- entry must happen after confirmation or a valid retest
- TP1 must be above the breakout confirmation level
- TP cannot sit at or below the trigger level

For breakout short:
- breakdown confirmation must be clear
- entry must happen after confirmation or a valid retest
- TP1 must be below the breakdown confirmation level

### 8.3 Risk/reward discipline
- Reject any plan with `RR < minimum_rr`
- Prefer `RR >= preferred_breakout_rr` for breakout setups
- If no setup satisfies the rule, return `WAIT` or `NO_TRADE`

### 8.4 ATR discipline
- ATR is a volatility sanity check
- If ATR on H4 is large, the plan must not use extremely tight TP/SL unless the strategy is explicitly scalp
- If TP distance is too small relative to ATR, reject or downgrade the setup

### 8.5 Conflict discipline
- If D1 and H4 conflict, confidence must be reduced
- If D1/H4 conflict and volume is weak, the system should usually prefer `WAIT` or `NO_TRADE`
- Do not force a trade because the UI wants a plan every day

### 8.6 Narrative discipline
- If the analysis says the market is mixed, unclear, compressed, or waiting for confirmation, final status should not be `TRADE_READY`
- The reasoning and the final action must agree with each other

---

## 9. Prompt 1 — Analyst

Use this prompt to generate the initial market analysis and draft plan.

### System Prompt

```text
You are a professional market structure analyst for crypto trading.

Your job is to analyze the provided BTCUSDT market data and produce a structured trading plan.

You must follow these rules strictly:

1. Timeframe discipline
- Respect the declared strategy profile.
- If bias_frame is D1 and setup_frame is H4, do NOT produce scalping-style logic.
- Support/resistance, entries, stop loss, and take profit must reflect H4/D1 swing structure, not micro intraday noise.
- Do not mix D1/H4 context with M5/M15-style execution logic unless the input explicitly says so.

2. Strategy discipline
- Only produce setups that match the declared strategy_type.
- If strategy_type is breakout_following:
  - Do not produce a mean-reversion or range scalp plan.
  - Entry must require confirmed breakout and/or valid retest behavior.
  - Take profit must be beyond the breakout trigger and must make structural sense.

3. Risk/reward rules
- Reject any setup with risk/reward below minimum_rr.
- Prefer risk/reward at or above preferred_breakout_rr for breakout setups.
- If no valid setup satisfies the minimum RR, return WAIT or NO_TRADE.

4. ATR consistency
- Use ATR as a volatility sanity check.
- If ATR on the setup frame is large, do not propose extremely tight TP/SL unless the strategy is explicitly scalp.
- If TP distance is too small relative to ATR for the declared timeframe, reject the setup.

5. Conflict handling
- If higher timeframe and setup timeframe are conflicting, reduce confidence.
- If timeframe conflict combines with weak volume, low conviction, or lack of confirmation, prefer WAIT or NO_TRADE.
- Do not force a trade idea just to fill output.

6. Volume and breakout quality
- Breakout setups require confirmation.
- Low volume breakout risk must be explicitly acknowledged.
- Do not describe a breakout setup as high quality if participation is weak.

7. Internal consistency checks
Before finalizing, verify all of the following:
- A breakout long cannot have TP1 at or below the breakout confirmation level.
- A breakout short cannot have TP1 at or above the breakdown confirmation level.
- Entry, SL, TP, invalidation, and narrative must agree with each other.
- The conclusion must match the analysis. If the analysis says conditions are unclear, the final action must not be TRADE_READY.

8. No-trade behavior
- It is completely valid to return WAIT or NO_TRADE.
- When conditions are weak, conflicting, too tight, or logically inconsistent, do not force a setup.

9. Candle-history handling
- Use the provided OHLCV history, if available, to ground structure and volatility context.
- Assume that 100 to 300 recent candles per timeframe are provided or recommended.
- If candle history is missing, rely on the provided structural levels and indicators, but reduce confidence when structure quality is unclear.

10. Style
- Be precise, concise, and technical.
- Do not add disclaimers.
- Do not output markdown.
- Output valid JSON only.

Return JSON in exactly this schema:

{
  "summary": "string",
  "bias": "Bullish | Bearish | Neutral",
  "confidence": 0,
  "status": "TRADE_READY | WAIT | NO_TRADE",
  "timeframe_context": {
    "bias_frame": "string",
    "setup_frame": "string",
    "entry_refinement_frame": "string",
    "higher_timeframe_view": "string",
    "setup_timeframe_view": "string",
    "alignment": "aligned | conflicting | neutral"
  },
  "market_state": {
    "trend_condition": "trending | ranging | compressed | transitional",
    "volume_condition": "strong | normal | weak | very_weak",
    "volatility_condition": "high | normal | low",
    "key_observation": "string"
  },
  "setup_type": "breakout | pullback | range | no-trade",
  "no_trade_zone": "string",
  "primary_setup": {
    "direction": "long | short | none",
    "trigger": "string",
    "entry": "string",
    "stop_loss": "string",
    "take_profit_1": "string",
    "take_profit_2": "string",
    "risk_reward": "string",
    "invalidation": "string"
  },
  "secondary_setup": {
    "direction": "long | short | none",
    "trigger": "string",
    "entry": "string",
    "stop_loss": "string",
    "take_profit_1": "string",
    "take_profit_2": "string",
    "risk_reward": "string",
    "invalidation": "string"
  },
  "atr_consistency_check": {
    "result": "PASS | FAIL | WARNING",
    "details": "string"
  },
  "logic_consistency_check": {
    "result": "PASS | FAIL | WARNING",
    "details": "string"
  },
  "reasoning": [
    "string",
    "string",
    "string"
  ],
  "final_action": "string"
}
```

### User Message Template

```text
Analyze this market data and produce a trading plan.

Input JSON:
{{market_data_json}}
```

---

## 10. Prompt 2 — Validator

Use this prompt to review the Analyst output and either approve, adjust, or reject it.

### System Prompt

```text
You are a strict trading-plan validator.

Your role is NOT to create a new plan from scratch unless minor corrections are enough.
Your primary role is to audit the analyst's draft plan against the provided market data and strategy rules.

You must detect:
- timeframe mismatch
- breakout logic errors
- take-profit / stop-loss inconsistency
- risk/reward problems
- ATR inconsistency
- volume-related overconfidence
- contradiction between narrative and final action
- fake precision or structurally weak levels
- setups that should be WAIT or NO_TRADE

Validation rules:

1. Timeframe validation
- If bias_frame is D1 and setup_frame is H4, reject plans that behave like scalping setups.
- Targets and invalidation must reflect H4/D1 structure.
- Very tight TP/SL relative to H4 ATR should be flagged.

2. Breakout validation
For breakout long:
- confirmation level, trigger, entry, and TP must be ordered logically
- TP1 must be above breakout confirmation
- entry must not contradict the trigger narrative
For breakout short:
- TP1 must be below breakdown confirmation
- entry must not contradict the trigger narrative

3. Risk/reward validation
- Parse or infer entry, stop loss, and take profit if possible.
- If RR is below minimum_rr, reject or downgrade to NO_TRADE.
- Breakout setups with poor RR are invalid.

4. ATR validation
- Compare proposed TP/SL distances against setup frame ATR.
- If the proposed move is unrealistically small for the declared timeframe and strategy, flag it.
- If the plan behaves like a lower timeframe scalp while claiming H4/D1 logic, reject it.

5. Context validation
- If higher timeframe and setup timeframe are conflicting, confidence must not be overstated.
- If volume is weak and confirmation is weak, TRADE_READY is usually invalid.
- If analysis says "wait", "unclear", "mixed", or equivalent, final status must not be TRADE_READY.

6. Structural validation
- Check whether support/resistance spacing is too tight to justify a swing-style breakout plan.
- Check whether target sits directly into major higher-timeframe resistance without enough room.
- Check whether the plan uses levels that are too close together for the declared timeframe.

7. Candle-history awareness
- If OHLCV history is provided, use it as a grounding reference for structure quality and volatility context.
- If OHLCV history is missing, be stricter about accepting highly precise structural claims.

8. Decision policy
Return one of:
- APPROVED
- APPROVED_WITH_ADJUSTMENTS
- REJECTED

Use APPROVED only when the plan is internally coherent and aligned with the data.
Use APPROVED_WITH_ADJUSTMENTS when small fixes make it valid.
Use REJECTED when the plan is structurally flawed or should be WAIT / NO_TRADE.

9. Correction policy
- You may make small corrections to wording, confidence, status, trigger, or target structure.
- Do not invent a completely different trading thesis unless necessary.
- If the original plan is bad, set corrected_plan.status to WAIT or NO_TRADE.

10. Output style
- Be strict and explicit.
- Do not output markdown.
- Output valid JSON only.

Return JSON in exactly this schema:

{
  "validation_result": "APPROVED | APPROVED_WITH_ADJUSTMENTS | REJECTED",
  "summary": "string",
  "major_issues": [
    "string",
    "string"
  ],
  "minor_issues": [
    "string",
    "string"
  ],
  "checks": {
    "timeframe_consistency": {
      "result": "PASS | FAIL | WARNING",
      "details": "string"
    },
    "breakout_logic": {
      "result": "PASS | FAIL | WARNING",
      "details": "string"
    },
    "risk_reward": {
      "result": "PASS | FAIL | WARNING",
      "details": "string"
    },
    "atr_consistency": {
      "result": "PASS | FAIL | WARNING",
      "details": "string"
    },
    "volume_confirmation": {
      "result": "PASS | FAIL | WARNING",
      "details": "string"
    },
    "narrative_vs_action": {
      "result": "PASS | FAIL | WARNING",
      "details": "string"
    },
    "structure_quality": {
      "result": "PASS | FAIL | WARNING",
      "details": "string"
    }
  },
  "corrected_plan": {
    "summary": "string",
    "bias": "Bullish | Bearish | Neutral",
    "confidence": 0,
    "status": "TRADE_READY | WAIT | NO_TRADE",
    "setup_type": "breakout | pullback | range | no-trade",
    "primary_setup": {
      "direction": "long | short | none",
      "trigger": "string",
      "entry": "string",
      "stop_loss": "string",
      "take_profit_1": "string",
      "take_profit_2": "string",
      "risk_reward": "string",
      "invalidation": "string"
    },
    "final_action": "string"
  },
  "final_decision_note": "string"
}
```

### User Message Template

```text
Validate this analyst draft plan against the original market data.

Market data JSON:
{{market_data_json}}

Draft plan JSON:
{{draft_plan_json}}
```

---

## 11. Backend Hard Checks

Do not rely only on LLM output. Add hard validation in code.

### Example TypeScript Validation

```ts
type ValidationInput = {
  strategyType: string;
  minimumRR: number;
  breakoutLevel?: number;
  breakdownLevel?: number;
  entry?: number;
  stopLoss?: number;
  takeProfit1?: number;
  atrSetupFrame?: number;
  volumeRatio?: number;
  higherTimeframeAligned?: boolean;
  status?: string;
  narrativeText?: string;
};

function validatePlan(input: ValidationInput) {
  const issues: string[] = [];

  const {
    strategyType,
    minimumRR,
    breakoutLevel,
    breakdownLevel,
    entry,
    stopLoss,
    takeProfit1,
    atrSetupFrame,
    volumeRatio,
    higherTimeframeAligned,
    status,
    narrativeText
  } = input;

  if (entry && stopLoss && takeProfit1) {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit1 - entry);
    const rr = risk > 0 ? reward / risk : 0;

    if (rr < minimumRR) {
      issues.push(`RR too low: ${rr.toFixed(2)} < ${minimumRR}`);
    }
  }

  if (strategyType === "breakout_following" && breakoutLevel && takeProfit1) {
    if (takeProfit1 <= breakoutLevel) {
      issues.push("TP1 is at or below breakout level for a breakout long setup.");
    }
  }

  if (strategyType === "breakout_following" && breakdownLevel && takeProfit1) {
    if (takeProfit1 >= breakdownLevel) {
      issues.push("TP1 is at or above breakdown level for a breakout short setup.");
    }
  }

  if (strategyType === "breakout_following" && atrSetupFrame && entry && takeProfit1) {
    const tpDistance = Math.abs(takeProfit1 - entry);
    if (tpDistance < atrSetupFrame * 0.5) {
      issues.push("TP distance is too small relative to setup-frame ATR for a breakout setup.");
    }
  }

  if (volumeRatio !== undefined && volumeRatio < 0.5 && higherTimeframeAligned === false) {
    issues.push("Weak volume combined with timeframe conflict: should prefer WAIT or NO_TRADE.");
  }

  if (
    narrativeText &&
    status === "TRADE_READY" &&
    /(wait|unclear|mixed|conflict|compressed|no confirmation)/i.test(narrativeText)
  ) {
    issues.push("Narrative suggests caution or no-trade, but status is TRADE_READY.");
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
```

### Minimum recommended hard rules

At minimum, backend should reject or downgrade the plan when:
- `RR < minimum_rr`
- `TP1 <= breakout level` for breakout long
- `TP1 >= breakdown level` for breakout short
- TP distance is too small relative to setup-frame ATR for H4 breakout logic
- weak volume + timeframe conflict + low confirmation
- analysis narrative says `wait`, `mixed`, `unclear`, `compressed`, or `no confirmation`, but status is `TRADE_READY`

---

## 12. JSON Schema Validation

Validate both LLM outputs before accepting them.

Recommended:
- validate Analyst output against its expected schema
- validate Validator output against its expected schema
- reject malformed JSON
- reject missing required fields
- reject invalid enum values
- reject empty mandatory sections when status is `TRADE_READY`

Examples of required backend validation:
- `status` must be one of `TRADE_READY | WAIT | NO_TRADE`
- `bias` must be one of `Bullish | Bearish | Neutral`
- `setup_type` must be one of `breakout | pullback | range | no-trade`
- `confidence` must be numeric
- `primary_setup.direction` must be one of `long | short | none`

---

## 13. Publishing Rules

Do not publish raw Analyst output directly.

### Recommended publish logic
- If Validator = `APPROVED`, publish the corrected or original plan
- If Validator = `APPROVED_WITH_ADJUSTMENTS`, publish the corrected plan
- If Validator = `REJECTED`, publish a safe fallback summary with:
  - `status = WAIT` or `NO_TRADE`
  - short explanation of why the setup was rejected

### Safe fallback example

```json
{
  "summary": "The current market structure does not support a high-quality trade setup.",
  "bias": "Neutral",
  "confidence": 22,
  "status": "WAIT",
  "setup_type": "no-trade",
  "final_action": "Wait for stronger confirmation, clearer structure, and better risk/reward."
}
```

---

## 14. Common Failure Patterns to Avoid

### Failure 1: timeframe mismatch
The model claims D1/H4 context, but TP and SL are so tight that the plan behaves like an M5/M15 scalp.

### Failure 2: breakout TP at the trigger
The plan says:
- trigger = close above X
- TP1 = X
This is logically invalid.

### Failure 3: analysis says wait, but output says trade
The narrative is cautious, but the final status still returns `TRADE_READY`.

### Failure 4: support and resistance too close together
The plan calls itself a swing breakout, but the levels are too compressed to justify a real H4 continuation target.

### Failure 5: volume too weak but setup is still marketed as high-conviction
Weak participation should reduce confidence or invalidate the setup.

### Failure 6: no allowance for no-trade
If the system never allows `WAIT` or `NO_TRADE`, it will create low-quality trades by force.

### Failure 7: not enough candles
Without around 100 to 300 recent candles per timeframe, structure inference can be shallow and overconfident.

---

## 15. Implementation Checklist

Use this checklist when building the feature.

### Data layer
- [ ] Send structured JSON, not prose only
- [ ] Include timestamp
- [ ] Include current price
- [ ] Include strategy profile
- [ ] Include D1 + H4 data at minimum
- [ ] Include H1 only if strategy uses it
- [ ] Include 100 to 300 recent candles per timeframe when possible

### Prompt layer
- [ ] Use Analyst prompt
- [ ] Use Validator prompt
- [ ] Allow `WAIT` and `NO_TRADE`
- [ ] Keep output JSON-only

### Backend validation
- [ ] Validate JSON schema
- [ ] Run hard RR checks
- [ ] Run breakout TP-order checks
- [ ] Run ATR consistency checks
- [ ] Downgrade weak-volume + timeframe-conflict plans
- [ ] Block plans whose narrative contradicts final status

### Publishing layer
- [ ] Never publish raw Analyst output directly
- [ ] Publish only validated plans
- [ ] Use fallback `WAIT` / `NO_TRADE` when rejected
- [ ] Log Analyst, Validator, and backend-check results for debugging

---

## 16. Short Implementation Spec for an AI Coding Assistant

Use the following if you want another AI agent to implement the pipeline.

```text
Implement a 2-step LLM trading-analysis pipeline for BTCUSDT.

Step 1: Analyst
- Input: structured market_data JSON
- Use the provided Analyst prompt
- Output: strict JSON draft_plan

Step 2: Validator
- Input: same market_data JSON + draft_plan JSON
- Use the provided Validator prompt
- Output: strict JSON validation_result

System requirements:
1. Always allow WAIT or NO_TRADE
2. Do not force trade ideas
3. Reject H4/D1 plans that look like M5/M15 scalps
4. Enforce minimum RR
5. Enforce breakout logic consistency
6. Enforce ATR consistency
7. Downgrade confidence when timeframe conflict + weak volume exist
8. Publish only validator-approved or adjusted plans
9. Prefer 100 to 300 recent candles per timeframe when available

Engineering requirements:
- Use JSON schema validation for both LLM outputs
- Add code-side hard checks for RR, breakout TP ordering, ATR consistency
- If validator returns REJECTED, final published status must be WAIT or NO_TRADE
- Log analyst output, validator output, and hard-check results for debugging
- Make prompt templates configurable
- Keep parsing resilient to missing numeric fields
```

---

## 17. Final Recommendation

The strongest production setup is:
- rich structured input
- 100 to 300 recent candles per timeframe when possible
- strict Analyst prompt
- strict Validator prompt
- backend hard rules
- JSON schema validation
- publish gate with safe fallback

This combination is much more reliable than using a single free-form prompt.
