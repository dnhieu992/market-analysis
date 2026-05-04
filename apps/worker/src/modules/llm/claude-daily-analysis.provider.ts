import { Injectable, Optional } from '@nestjs/common';
import {
  dailyAnalysisAnalystDraftSchema,
  dailyAnalysisValidatorResultSchema,
  type DailyAnalysisAnalystDraft,
  type DailyAnalysisMarketData,
  type DailyAnalysisPlan,
  type DailyAnalysisValidatorResult,
  dailyAnalysisPlanSchema
} from '@app/core';
import axios, { type AxiosInstance } from 'axios';

import {
  buildDailyAnalysisAnalystPrompt,
  buildDailyAnalysisValidatorPrompt
} from './daily-analysis-prompts';
import type {
  ClaudeModelVariant,
  DailyAnalysisGatewayInput,
  DailyAnalysisGatewayResult,
  DailyAnalysisDraftResult,
  DailyAnalysisValidationResult,
  LlmProviderAdapter
} from './llm-provider.adapter';

type ClaudeContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
};

type ClaudeMessagesResponse = {
  content?: ClaudeContentBlock[];
};


const DAILY_ANALYSIS_TOOL_NAME = 'record_daily_analysis_plan';
const DAILY_ANALYSIS_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'analysis',
    'bias',
    'confidence',
    'tradePlan',
    'scenarios',
    'riskNote',
    'timeHorizon'
  ],
  properties: {
    analysis: { type: 'string' },
    bias: {
      type: 'string',
      enum: ['bullish', 'bearish', 'neutral']
    },
    confidence: { type: 'number' },
    tradePlan: {
      type: 'object',
      additionalProperties: false,
      required: ['entryZone', 'stopLoss', 'takeProfit', 'invalidation'],
      properties: {
        entryZone: { type: 'string' },
        stopLoss: { type: 'string' },
        takeProfit: { type: 'string' },
        invalidation: { type: 'string' }
      }
    },
    scenarios: {
      type: 'object',
      additionalProperties: false,
      required: ['bullishScenario', 'bearishScenario'],
      properties: {
        bullishScenario: { type: 'string' },
        bearishScenario: { type: 'string' }
      }
    },
    riskNote: { type: 'string' },
    timeHorizon: { type: 'string' }
  }
} as const;

const DAILY_ANALYSIS_ANALYST_TOOL_NAME = 'record_daily_analysis_draft';
const DAILY_ANALYSIS_VALIDATOR_TOOL_NAME = 'validate_daily_analysis_draft';

const ANALYST_SETUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'direction',
    'trigger',
    'entry',
    'stopLoss',
    'takeProfit1',
    'takeProfit2',
    'riskReward',
    'invalidation'
  ],
  properties: {
    direction: { type: 'string', enum: ['long', 'short', 'none'] },
    trigger: { type: 'string' },
    entry: { type: 'string' },
    stopLoss: { type: 'string' },
    takeProfit1: { type: 'string' },
    takeProfit2: { type: 'string' },
    riskReward: { type: 'string' },
    invalidation: { type: 'string' }
  }
} as const;

const ANALYST_CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['result', 'details'],
  properties: {
    result: { type: 'string', enum: ['PASS', 'FAIL', 'WARNING'] },
    details: { type: 'string' }
  }
} as const;

const ANALYST_TIMEFRAME_CONTEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'biasFrame',
    'setupFrame',
    'entryRefinementFrame',
    'higherTimeframeView',
    'setupTimeframeView',
    'alignment'
  ],
  properties: {
    biasFrame: { type: 'string', enum: ['D1'] },
    setupFrame: { type: 'string', enum: ['H4'] },
    entryRefinementFrame: { type: 'string', enum: ['none'] },
    higherTimeframeView: { type: 'string' },
    setupTimeframeView: { type: 'string' },
    alignment: { type: 'string', enum: ['aligned', 'conflicting', 'neutral'] }
  }
} as const;

const ANALYST_MARKET_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['trendCondition', 'volumeCondition', 'volatilityCondition', 'keyObservation'],
  properties: {
    trendCondition: { type: 'string', enum: ['trending', 'ranging', 'compressed', 'transitional'] },
    volumeCondition: { type: 'string', enum: ['strong', 'normal', 'weak', 'very_weak'] },
    volatilityCondition: { type: 'string', enum: ['high', 'normal', 'low'] },
    keyObservation: { type: 'string' }
  }
} as const;

const DAILY_ANALYSIS_ANALYST_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'bias',
    'confidence',
    'status',
    'timeframeContext',
    'marketState',
    'setupType',
    'noTradeZone',
    'primarySetup',
    'secondarySetup',
    'atrConsistencyCheck',
    'logicConsistencyCheck',
    'reasoning',
    'finalAction'
  ],
  properties: {
    summary: { type: 'string' },
    bias: { type: 'string', enum: ['Bullish', 'Bearish', 'Neutral'] },
    confidence: { type: 'integer' },
    status: { type: 'string', enum: ['TRADE_READY', 'WAIT', 'NO_TRADE'] },
    timeframeContext: ANALYST_TIMEFRAME_CONTEXT_SCHEMA,
    marketState: ANALYST_MARKET_STATE_SCHEMA,
    setupType: { type: 'string', enum: ['breakout', 'pullback', 'range', 'no-trade'] },
    noTradeZone: { type: 'string' },
    primarySetup: ANALYST_SETUP_SCHEMA,
    secondarySetup: ANALYST_SETUP_SCHEMA,
    atrConsistencyCheck: ANALYST_CHECK_SCHEMA,
    logicConsistencyCheck: ANALYST_CHECK_SCHEMA,
    reasoning: { type: 'array', items: { type: 'string' } },
    finalAction: { type: 'string' }
  }
} as const;

const VALIDATOR_CHECK_SCHEMA = ANALYST_CHECK_SCHEMA;
const VALIDATOR_CORRECTED_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'bias', 'confidence', 'status', 'setupType', 'primarySetup', 'finalAction'],
  properties: {
    summary: { type: 'string' },
    bias: { type: 'string', enum: ['Bullish', 'Bearish', 'Neutral'] },
    confidence: { type: 'integer' },
    status: { type: 'string', enum: ['TRADE_READY', 'WAIT', 'NO_TRADE'] },
    setupType: { type: 'string', enum: ['breakout', 'pullback', 'range', 'no-trade'] },
    primarySetup: ANALYST_SETUP_SCHEMA,
    finalAction: { type: 'string' }
  }
} as const;

const DAILY_ANALYSIS_VALIDATOR_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'validationResult',
    'summary',
    'majorIssues',
    'minorIssues',
    'checks',
    'correctedPlan',
    'finalDecisionNote'
  ],
  properties: {
    validationResult: {
      type: 'string',
      enum: ['APPROVED', 'APPROVED_WITH_ADJUSTMENTS', 'REJECTED']
    },
    summary: { type: 'string' },
    majorIssues: { type: 'array', items: { type: 'string' } },
    minorIssues: { type: 'array', items: { type: 'string' } },
    checks: {
      type: 'object',
      additionalProperties: false,
      required: [
        'timeframeConsistency',
        'breakoutLogic',
        'riskReward',
        'atrConsistency',
        'volumeConfirmation',
        'narrativeVsAction',
        'structureQuality'
      ],
      properties: {
        timeframeConsistency: VALIDATOR_CHECK_SCHEMA,
        breakoutLogic: VALIDATOR_CHECK_SCHEMA,
        riskReward: VALIDATOR_CHECK_SCHEMA,
        atrConsistency: VALIDATOR_CHECK_SCHEMA,
        volumeConfirmation: VALIDATOR_CHECK_SCHEMA,
        narrativeVsAction: VALIDATOR_CHECK_SCHEMA,
        structureQuality: VALIDATOR_CHECK_SCHEMA
      }
    },
    correctedPlan: VALIDATOR_CORRECTED_PLAN_SCHEMA,
    finalDecisionNote: { type: 'string' }
  }
} as const;

const DEFAULT_CLAUDE_TIMEOUT_MS = 60_000;

export function resolveClaudeTimeoutMs(rawValue: string | undefined): number {
  if (rawValue == null) {
    return DEFAULT_CLAUDE_TIMEOUT_MS;
  }

  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CLAUDE_TIMEOUT_MS;
  }

  return Math.floor(parsed);
}

@Injectable()
export class ClaudeDailyAnalysisProvider implements LlmProviderAdapter {
  private readonly client: AxiosInstance;
  private readonly modelVariant: ClaudeModelVariant;

  constructor(
    @Optional() client?: AxiosInstance,
    @Optional() modelVariant?: ClaudeModelVariant,
    @Optional() apiKey?: string
  ) {
    this.modelVariant = modelVariant ?? 'sonnet';

    this.client =
      client ??
      axios.create({
        baseURL: 'https://api.anthropic.com/v1',
        timeout: resolveClaudeTimeoutMs(process.env.CLAUDE_TIMEOUT_MS),
        headers: {
          'x-api-key': apiKey ?? process.env.CLAUDE_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });
  }

  async generateDailyAnalysisDraft(
    marketData: DailyAnalysisMarketData
  ): Promise<DailyAnalysisDraftResult> {
    const response = await this.requestClaudeTool(
      buildDailyAnalysisAnalystPrompt(marketData),
      'You are a professional market structure analyst for crypto trading.',
      DAILY_ANALYSIS_ANALYST_TOOL_NAME,
      DAILY_ANALYSIS_ANALYST_TOOL_SCHEMA
    );

    const toolInput = this.extractToolUseInput(response.data, DAILY_ANALYSIS_ANALYST_TOOL_NAME);
    const normalizedDraft = this.normalizeAnalystDraftInput(toolInput, marketData);

    return {
      provider: 'claude',
      model: this.getResolvedModel(),
      draftPlan: dailyAnalysisAnalystDraftSchema.parse(normalizedDraft)
    };
  }

  async validateDailyAnalysisDraft(input: {
    marketData: DailyAnalysisMarketData;
    draftPlan: DailyAnalysisAnalystDraft;
  }): Promise<DailyAnalysisValidationResult> {
    const response = await this.requestClaudeTool(
      buildDailyAnalysisValidatorPrompt(input),
      'You are a strict trading-plan validator.',
      DAILY_ANALYSIS_VALIDATOR_TOOL_NAME,
      DAILY_ANALYSIS_VALIDATOR_TOOL_SCHEMA
    );

    const toolInput = this.extractToolUseInput(response.data, DAILY_ANALYSIS_VALIDATOR_TOOL_NAME);
    const normalizedValidatorResult = this.normalizeValidatorResultInput(toolInput, input.draftPlan);

    return {
      provider: 'claude',
      model: this.getResolvedModel(),
      validatorResult: dailyAnalysisValidatorResultSchema.parse(normalizedValidatorResult)
    };
  }

  getResolvedModel(): string {
    return this.modelVariant;
  }

  async generateDailyAnalysisPlan(
    input: DailyAnalysisGatewayInput
  ): Promise<DailyAnalysisGatewayResult> {
    return this.generateCompatibilityDailyAnalysisPlan(input);
  }

  private async requestClaudeTool(
    prompt: string,
    system: string,
    toolName: string,
    toolSchema: Record<string, unknown>
  ): Promise<{ data: ClaudeMessagesResponse }> {
    try {
      return await this.client.post<ClaudeMessagesResponse>('/messages', {
        model: this.getResolvedModel(),
        max_tokens: 1200,
        system,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        tools: [
          {
            name: toolName,
            description: 'Return structured daily analysis output.',
            input_schema: toolSchema
          }
        ],
        tool_choice: {
          type: 'tool',
          name: toolName
        }
      });
    } catch (error) {
      const candidate = error as {
        response?: {
          status?: number;
          data?: unknown;
        };
      };
      const status = candidate.response?.status;
      const details =
        candidate.response?.data == null
          ? ''
          : `: ${JSON.stringify(candidate.response.data)}`;

      if (status) {
        throw new Error(`Claude daily analysis request failed with status ${status}${details}`);
      }

      throw error;
    }
  }

  private extractToolUseInput(response: ClaudeMessagesResponse, toolName: string): unknown {
    const toolUseInput = response.content?.find(
      (block) => block.type === 'tool_use' && block.name === toolName
    )?.input;

    if (toolUseInput == null) {
      throw new Error(`Claude daily analysis response missing tool output for ${toolName}`);
    }

    return toolUseInput;
  }

  private async generateCompatibilityDailyAnalysisPlan(
    input: DailyAnalysisGatewayInput
  ): Promise<DailyAnalysisGatewayResult> {
    const marketPrompt = this.buildPrompt(input);
    const response = await this.requestClaudeMessage(
      marketPrompt,
      'You are a crypto market analyst. Use only the supplied technical data. Do not invent news or fundamentals.'
    );

    const toolUseInput = response.data.content?.find(
      (block) => block.type === 'tool_use' && block.name === DAILY_ANALYSIS_TOOL_NAME
    )?.input;

    if (toolUseInput != null) {
      const parsedPlan = this.parsePlanInput(toolUseInput, input);

      if (parsedPlan) {
        return {
          provider: 'claude',
          model: this.getResolvedModel(),
          plan: parsedPlan
        };
      }

      const repairedPlan = await this.repairIncompletePlan(input, toolUseInput);

      return {
        provider: 'claude',
        model: this.getResolvedModel(),
        plan: repairedPlan
      };
    }

    const text = response.data.content?.find((block) => block.type === 'text')?.text?.trim();

    if (!text) {
      throw new Error('Claude daily analysis response was empty');
    }

    const normalizedText = this.extractJsonPayload(text);
    const rawJsonPlan = JSON.parse(normalizedText) as unknown;
    const parsedTextPlan = this.parsePlanInput(rawJsonPlan, input);

    if (parsedTextPlan) {
      return {
        provider: 'claude',
        model: this.getResolvedModel(),
        plan: parsedTextPlan
      };
    }

    return {
      provider: 'claude',
      model: this.getResolvedModel(),
      plan: await this.repairIncompletePlan(input, rawJsonPlan)
    };
  }

  private buildPrompt(input: DailyAnalysisGatewayInput): string {
    const date = input.date.toISOString().slice(0, 10);

    return [
      `Symbol: ${input.symbol}`,
      `Date: ${date}`,
      '',
      'D1 context:',
      `D1 trend: ${input.d1.trend}`,
      `D1 levels: S1=${input.d1.s1}, S2=${input.d1.s2}, R1=${input.d1.r1}, R2=${input.d1.r2}`,
      '',
      'H4 primary planning frame:',
      `H4 trend: ${input.h4.trend}`,
      `H4 levels: S1=${input.h4.s1}, S2=${input.h4.s2}, R1=${input.h4.r1}, R2=${input.h4.r2}`,
      `EMA20=${input.h4Indicators.ema20}, EMA50=${input.h4Indicators.ema50}, EMA200=${input.h4Indicators.ema200}`,
      `RSI14=${input.h4Indicators.rsi14}`,
      `MACD=${input.h4Indicators.macd.macd}, MACD signal=${input.h4Indicators.macd.signal}, MACD histogram=${input.h4Indicators.macd.histogram}`,
      `ATR14=${input.h4Indicators.atr14}`,
      `Volume ratio=${input.h4Indicators.volumeRatio}`,
      '',
      'Use a breakout-following trend approach.',
      'Prioritize alignment between D1 context and H4 structure.',
      'Do not propose counter-trend trades unless the setup is invalid and confidence should be reduced.',
      'If the breakout is not confirmed, prefer a wait/confirmation plan over forcing an entry.',
      'Every required field must be present and non-empty.',
      'Return the result via the provided tool with these exact keys: analysis, bias, confidence, tradePlan{entryZone,stopLoss,takeProfit,invalidation}, scenarios{bullishScenario,bearishScenario}, riskNote, timeHorizon.'
    ].join('\n');
  }

  private async requestClaudeMessage(
    prompt: string,
    system: string
  ): Promise<{ data: ClaudeMessagesResponse }> {
    try {
      return await this.client.post<ClaudeMessagesResponse>('/messages', {
        model: this.getResolvedModel(),
        max_tokens: 800,
        system,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        tools: [
          {
            name: DAILY_ANALYSIS_TOOL_NAME,
            description:
              'Record a structured daily crypto market analysis and breakout-following trend trade plan.',
            input_schema: DAILY_ANALYSIS_TOOL_SCHEMA
          }
        ],
        tool_choice: {
          type: 'tool',
          name: DAILY_ANALYSIS_TOOL_NAME
        }
      });
    } catch (error) {
      const candidate = error as {
        response?: {
          status?: number;
          data?: unknown;
        };
      };
      const status = candidate.response?.status;
      const details =
        candidate.response?.data == null
          ? ''
          : `: ${JSON.stringify(candidate.response.data)}`;

      if (status) {
        throw new Error(`Claude daily analysis request failed with status ${status}${details}`);
      }

      throw error;
    }
  }

  private extractJsonPayload(text: string): string {
    const trimmed = text.trim();
    const withoutFence = trimmed.startsWith('```')
      ? trimmed
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/, '')
          .trim()
      : trimmed;

    return this.escapeRawNewlinesInStrings(
      withoutFence.replace(/,\s*([}\]])/g, '$1')
    );
  }

  private escapeRawNewlinesInStrings(input: string): string {
    let result = '';
    let inString = false;
    let escaping = false;

    for (const char of input) {
      if (escaping) {
        result += char;
        escaping = false;
        continue;
      }

      if (char === '\\') {
        result += char;
        escaping = true;
        continue;
      }

      if (char === '"') {
        result += char;
        inString = !inString;
        continue;
      }

      if (inString && char === '\n') {
        result += '\\n';
        continue;
      }

      if (inString && char === '\r') {
        result += '\\r';
        continue;
      }

      result += char;
    }

    return result;
  }

  private normalizeAnalystDraftInput(
    rawInput: unknown,
    marketData: DailyAnalysisMarketData
  ): unknown {
    if (!this.isRecord(rawInput)) {
      return rawInput;
    }

    const source = rawInput;
    const summary =
      this.firstString(source.summary, source.analysis) ?? this.deriveAnalystSummary(marketData);
    const status = this.normalizeDraftStatus(source.status) ?? 'WAIT';
    const marketState = this.normalizeAnalystMarketState(
      this.pickRecord(source.marketState, source.market_state),
      marketData,
      summary
    );
    const finalAction =
      this.firstString(source.finalAction, source.final_action, source.action) ??
      this.deriveAnalystFinalAction(status, marketData);

    return {
      summary,
      bias: this.normalizeBias(source.bias) ?? this.deriveBiasFromMarketData(marketData),
      confidence:
        this.normalizeConfidence(source.confidence) ??
        this.deriveDraftConfidenceFromMarketData(marketData),
      status,
      timeframeContext: this.normalizeAnalystTimeframeContext(
        this.pickRecord(source.timeframeContext, source.timeframe_context),
        marketData
      ),
      marketState,
      setupType:
        this.normalizeSetupType(source.setupType, source.setup_type) ??
        (status === 'TRADE_READY' ? 'breakout' : 'no-trade'),
      noTradeZone:
        this.firstString(source.noTradeZone, source.no_trade_zone) ??
        this.deriveNoTradeZone(marketData),
      primarySetup: this.normalizeAnalystSetup(
        this.pickRecord(
          source.primarySetup,
          source.primary_setup,
          source.tradePlan,
          source.trade_plan,
          source.plan
        ),
        this.deriveDefaultSetup(
          marketData,
          status === 'TRADE_READY' ? this.deriveSetupDirectionFromMarketData(marketData) : 'none'
        )
      ),
      secondarySetup: this.normalizeAnalystSetup(
        this.pickRecord(source.secondarySetup, source.secondary_setup),
        this.deriveDefaultSetup(marketData, 'none')
      ),
      atrConsistencyCheck: this.normalizeDraftCheck(
        this.pickRecord(source.atrConsistencyCheck, source.atr_consistency_check),
        this.deriveCheckResultFromStatus(status),
        `H4 ATR14 = ${this.formatPrice(marketData.timeframes.H4.atr14)}; only trust the setup after volatility and confirmation align.`
      ),
      logicConsistencyCheck: this.normalizeDraftCheck(
        this.pickRecord(source.logicConsistencyCheck, source.logic_consistency_check),
        this.deriveCheckResultFromStatus(status),
        `Bias frame D1 and setup frame H4 require confirmation before execution when alignment is not clean.`
      ),
      reasoning: this.normalizeReasoning(
        source.reasoning,
        summary,
        marketState.keyObservation,
        finalAction
      ),
      finalAction
    };
  }

  private normalizeValidatorResultInput(
    rawInput: unknown,
    draftPlan: DailyAnalysisAnalystDraft
  ): unknown {
    if (!this.isRecord(rawInput)) {
      return rawInput;
    }

    const source = rawInput;
    const validationResult =
      this.normalizeValidationResult(source.validationResult, source.validation_result) ??
      'APPROVED_WITH_ADJUSTMENTS';
    const summary = this.firstString(source.summary, source.validatorSummary) ?? draftPlan.summary;

    return {
      validationResult,
      summary,
      majorIssues: this.normalizeStringArray(source.majorIssues, source.major_issues),
      minorIssues: this.normalizeStringArray(source.minorIssues, source.minor_issues),
      checks: this.normalizeValidatorChecks(
        this.pickRecord(source.checks, source.validationChecks, source.validation_checks),
        validationResult === 'REJECTED' ? 'WARNING' : 'PASS'
      ),
      correctedPlan: this.normalizeValidatorCorrectedPlan(
        this.pickRecord(source.correctedPlan, source.corrected_plan, source.plan),
        draftPlan
      ),
      finalDecisionNote:
        this.firstString(source.finalDecisionNote, source.final_decision_note, source.decisionNote) ??
        `Validator returned ${validationResult}.`
    };
  }

  private normalizeAnalystTimeframeContext(
    rawContext: Record<string, unknown> | undefined,
    marketData: DailyAnalysisMarketData
  ) {
    const source = rawContext ?? {};
    const higherTimeframeView =
      this.firstString(
        source.higherTimeframeView,
        source.higher_timeframe_view,
        source.D1,
        source.d1
      ) ?? this.deriveHigherTimeframeView(marketData);
    const setupTimeframeView =
      this.firstString(
        source.setupTimeframeView,
        source.setup_timeframe_view,
        source.H4,
        source.h4
      ) ?? this.deriveSetupTimeframeView(marketData);

    return {
      biasFrame: 'D1' as const,
      setupFrame: 'H4' as const,
      entryRefinementFrame: 'none' as const,
      higherTimeframeView: this.ensureTimeframeLabel(higherTimeframeView, 'D1'),
      setupTimeframeView: this.ensureTimeframeLabel(setupTimeframeView, 'H4'),
      alignment:
        this.normalizeAlignment(source.alignment) ?? this.deriveAlignmentFromMarketData(marketData)
    };
  }

  private normalizeAnalystMarketState(
    rawState: Record<string, unknown> | undefined,
    marketData: DailyAnalysisMarketData,
    fallbackObservation: string
  ) {
    const source = rawState ?? {};

    return {
      trendCondition:
        this.normalizeTrendCondition(
          source.trendCondition,
          source.trend_condition,
          source.marketRegime,
          source.market_regime
        ) ?? this.deriveTrendConditionFromMarketData(marketData),
      volumeCondition:
        this.normalizeVolumeCondition(source.volumeCondition, source.volume_condition) ??
        this.deriveVolumeConditionFromMarketData(marketData),
      volatilityCondition:
        this.normalizeVolatilityCondition(
          source.volatilityCondition,
          source.volatility_condition
        ) ?? this.deriveVolatilityConditionFromMarketData(marketData),
      keyObservation:
        this.firstString(source.keyObservation, source.key_observation, source.observation) ??
        fallbackObservation
    };
  }

  private normalizeAnalystSetup(
    rawSetup: Record<string, unknown> | undefined,
    fallbackSetup: DailyAnalysisAnalystDraft['primarySetup']
  ) {
    const source = rawSetup ?? {};

    return {
      direction: this.normalizeSetupDirection(source.direction, source.side) ?? fallbackSetup.direction,
      trigger:
        this.firstString(source.trigger, source.breakoutTrigger, source.trigger_condition) ??
        fallbackSetup.trigger,
      entry:
        this.firstString(source.entry, source.entryZone, source.entry_zone) ?? fallbackSetup.entry,
      stopLoss:
        this.firstString(source.stopLoss, source.stop_loss) ?? fallbackSetup.stopLoss,
      takeProfit1:
        this.firstString(
          source.takeProfit1,
          source.take_profit_1,
          source.takeProfit,
          source.take_profit
        ) ?? fallbackSetup.takeProfit1,
      takeProfit2:
        this.firstString(source.takeProfit2, source.take_profit_2) ?? fallbackSetup.takeProfit2,
      riskReward:
        this.firstString(source.riskReward, source.risk_reward) ?? fallbackSetup.riskReward,
      invalidation:
        this.firstString(source.invalidation, source.invalidatesAt, source.invalidation_level) ??
        fallbackSetup.invalidation
    };
  }

  private normalizeDraftCheck(
    rawCheck: Record<string, unknown> | undefined,
    fallbackResult: 'PASS' | 'FAIL' | 'WARNING',
    fallbackDetails: string
  ) {
    const source = rawCheck ?? {};

    return {
      result:
        this.normalizeCheckResult(source.result, source.check_result) ?? fallbackResult,
      details:
        this.firstString(source.details, source.note, source.reason) ?? fallbackDetails
    };
  }

  private normalizeValidatorChecks(
    rawChecks: Record<string, unknown> | undefined,
    fallbackResult: 'PASS' | 'FAIL' | 'WARNING'
  ) {
    const source = rawChecks ?? {};
    const fallbackDetails = 'Validator check used provider fallback normalization.';

    return {
      timeframeConsistency: this.normalizeDraftCheck(
        this.pickRecord(source.timeframeConsistency, source.timeframe_consistency),
        fallbackResult,
        fallbackDetails
      ),
      breakoutLogic: this.normalizeDraftCheck(
        this.pickRecord(source.breakoutLogic, source.breakout_logic),
        fallbackResult,
        fallbackDetails
      ),
      riskReward: this.normalizeDraftCheck(
        this.pickRecord(source.riskReward, source.risk_reward),
        fallbackResult,
        fallbackDetails
      ),
      atrConsistency: this.normalizeDraftCheck(
        this.pickRecord(source.atrConsistency, source.atr_consistency),
        fallbackResult,
        fallbackDetails
      ),
      volumeConfirmation: this.normalizeDraftCheck(
        this.pickRecord(source.volumeConfirmation, source.volume_confirmation),
        fallbackResult,
        fallbackDetails
      ),
      narrativeVsAction: this.normalizeDraftCheck(
        this.pickRecord(source.narrativeVsAction, source.narrative_vs_action),
        fallbackResult,
        fallbackDetails
      ),
      structureQuality: this.normalizeDraftCheck(
        this.pickRecord(source.structureQuality, source.structure_quality),
        fallbackResult,
        fallbackDetails
      )
    };
  }

  private normalizeValidatorCorrectedPlan(
    rawPlan: Record<string, unknown> | undefined,
    draftPlan: DailyAnalysisAnalystDraft
  ) {
    const source = rawPlan ?? {};

    return {
      summary: this.firstString(source.summary, source.analysis) ?? draftPlan.summary,
      bias: this.normalizeBias(source.bias) ?? draftPlan.bias,
      confidence: this.normalizeConfidence(source.confidence) ?? draftPlan.confidence,
      status: this.normalizeDraftStatus(source.status) ?? draftPlan.status,
      setupType:
        this.normalizeSetupType(source.setupType, source.setup_type) ?? draftPlan.setupType,
      primarySetup: this.normalizeAnalystSetup(
        this.pickRecord(source.primarySetup, source.primary_setup, source.tradePlan, source.trade_plan),
        draftPlan.primarySetup
      ),
      finalAction:
        this.firstString(source.finalAction, source.final_action, source.action) ??
        draftPlan.finalAction
    };
  }

  private normalizeReasoning(
    rawReasoning: unknown,
    summary: string,
    keyObservation: string,
    finalAction: string
  ): string[] {
    const values = Array.isArray(rawReasoning)
      ? rawReasoning.filter((item): item is string => typeof item === 'string')
      : typeof rawReasoning === 'string'
      ? [rawReasoning]
      : [summary, keyObservation, finalAction];

    const normalized = values
      .map((value) => value.trim())
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);

    return normalized.length > 0 ? normalized : [summary];
  }

  private normalizeStringArray(...candidates: unknown[]): string[] {
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        const values = candidate.filter((item): item is string => typeof item === 'string');

        if (values.length > 0) {
          return values;
        }
      }
    }

    return [];
  }

  private pickRecord(...candidates: unknown[]): Record<string, unknown> | undefined {
    return candidates.find((candidate): candidate is Record<string, unknown> =>
      this.isRecord(candidate)
    );
  }

  private deriveBiasFromMarketData(marketData: DailyAnalysisMarketData): DailyAnalysisAnalystDraft['bias'] {
    const d1Trend = marketData.timeframes.D1.trend;
    const h4Trend = marketData.timeframes.H4.trend;

    if (d1Trend === h4Trend && d1Trend !== 'neutral') {
      return d1Trend === 'bullish' ? 'Bullish' : 'Bearish';
    }

    return 'Neutral';
  }

  private deriveDraftConfidenceFromMarketData(marketData: DailyAnalysisMarketData): number {
    return this.deriveAlignmentFromMarketData(marketData) === 'aligned' ? 68 : 38;
  }

  private deriveAlignmentFromMarketData(
    marketData: DailyAnalysisMarketData
  ): 'aligned' | 'conflicting' | 'neutral' {
    const d1Trend = marketData.timeframes.D1.trend;
    const h4Trend = marketData.timeframes.H4.trend;

    if (d1Trend === 'neutral' || h4Trend === 'neutral') {
      return 'neutral';
    }

    return d1Trend === h4Trend ? 'aligned' : 'conflicting';
  }

  private deriveTrendConditionFromMarketData(
    marketData: DailyAnalysisMarketData
  ): 'trending' | 'ranging' | 'compressed' | 'transitional' {
    const regime = marketData.marketFlags?.marketRegime;

    if (regime === 'compressed' || regime === 'trending' || regime === 'ranging') {
      return regime;
    }

    return 'transitional';
  }

  private deriveVolumeConditionFromMarketData(
    marketData: DailyAnalysisMarketData
  ): 'strong' | 'normal' | 'weak' | 'very_weak' {
    const volumeRatio = marketData.timeframes.H4.volumeRatio;

    if (volumeRatio < 0.3) {
      return 'very_weak';
    }

    if (volumeRatio < 0.8) {
      return 'weak';
    }

    if (volumeRatio < 1.2) {
      return 'normal';
    }

    return 'strong';
  }

  private deriveVolatilityConditionFromMarketData(
    marketData: DailyAnalysisMarketData
  ): 'high' | 'normal' | 'low' {
    const ratio = marketData.timeframes.H4.atr14 / Math.max(1, marketData.currentPrice);

    if (ratio >= 0.015) {
      return 'high';
    }

    if (ratio >= 0.007) {
      return 'normal';
    }

    return 'low';
  }

  private deriveAnalystSummary(marketData: DailyAnalysisMarketData): string {
    const alignment = this.deriveAlignmentFromMarketData(marketData);

    if (alignment === 'aligned') {
      return 'Cau truc D1 va H4 dang dong thuan, nhung van can doi breakout duoc xac nhan ro rang.';
    }

    return 'Thi truong dang co xung dot hoac nen chat, uu tien cho xac nhan truoc khi kich hoat ke hoach.';
  }

  private deriveHigherTimeframeView(marketData: DailyAnalysisMarketData): string {
    return `D1 trend is ${marketData.timeframes.D1.trend} with key levels around ${this.formatPrice(
      marketData.timeframes.D1.levels.support[0] ?? marketData.currentPrice
    )} and ${this.formatPrice(
      marketData.timeframes.D1.levels.resistance[0] ?? marketData.currentPrice
    )}.`;
  }

  private deriveSetupTimeframeView(marketData: DailyAnalysisMarketData): string {
    return `H4 trend is ${marketData.timeframes.H4.trend} and requires a confirmed breakout before execution.`;
  }

  private deriveNoTradeZone(marketData: DailyAnalysisMarketData): string {
    const support = marketData.timeframes.H4.levels.support[0] ?? marketData.currentPrice;
    const resistance = marketData.timeframes.H4.levels.resistance[0] ?? marketData.currentPrice;

    return `Avoid entries while H4 remains trapped between ${this.formatPrice(
      support
    )} and ${this.formatPrice(resistance)} without confirmation.`;
  }

  private deriveAnalystFinalAction(
    status: DailyAnalysisAnalystDraft['status'],
    marketData: DailyAnalysisMarketData
  ): string {
    if (status === 'TRADE_READY') {
      return `Only act after H4 confirms a breakout beyond ${this.formatPrice(
        marketData.timeframes.H4.levels.resistance[0] ?? marketData.currentPrice
      )}.`;
    }

    return 'Wait for stronger confirmation, clearer structure, and better participation.';
  }

  private deriveDefaultSetup(
    marketData: DailyAnalysisMarketData,
    direction: DailyAnalysisAnalystDraft['primarySetup']['direction']
  ): DailyAnalysisAnalystDraft['primarySetup'] {
    const h4Support = marketData.timeframes.H4.levels.support[0] ?? marketData.currentPrice;
    const h4Resistance = marketData.timeframes.H4.levels.resistance[0] ?? marketData.currentPrice;
    const h4Resistance2 = marketData.timeframes.H4.levels.resistance[1] ?? h4Resistance;
    const h4Support2 = marketData.timeframes.H4.levels.support[1] ?? h4Support;

    if (direction === 'long') {
      return {
        direction,
        trigger: `H4 close above ${this.formatPrice(h4Resistance)} with stronger volume.`,
        entry: `Consider long only after breakout confirmation above ${this.formatPrice(h4Resistance)}.`,
        stopLoss: `Below ${this.formatPrice(h4Support)}.`,
        takeProfit1: this.formatPrice(h4Resistance2),
        takeProfit2: this.formatPrice(
          marketData.timeframes.D1.levels.resistance[0] ?? h4Resistance2
        ),
        riskReward: '1:2',
        invalidation: `Cancel the setup if H4 loses ${this.formatPrice(h4Support)}.`
      };
    }

    if (direction === 'short') {
      return {
        direction,
        trigger: `H4 close below ${this.formatPrice(h4Support)} with stronger volume.`,
        entry: `Consider short only after breakdown confirmation below ${this.formatPrice(h4Support)}.`,
        stopLoss: `Above ${this.formatPrice(h4Resistance)}.`,
        takeProfit1: this.formatPrice(h4Support2),
        takeProfit2: this.formatPrice(
          marketData.timeframes.D1.levels.support[0] ?? h4Support2
        ),
        riskReward: '1:2',
        invalidation: `Cancel the setup if H4 reclaims ${this.formatPrice(h4Resistance)}.`
      };
    }

    return {
      direction: 'none',
      trigger: 'No valid trigger yet.',
      entry: 'Wait for confirmation.',
      stopLoss: 'N/A',
      takeProfit1: 'N/A',
      takeProfit2: 'N/A',
      riskReward: 'N/A',
      invalidation: 'N/A'
    };
  }

  private deriveSetupDirectionFromMarketData(
    marketData: DailyAnalysisMarketData
  ): DailyAnalysisAnalystDraft['primarySetup']['direction'] {
    const d1Trend = marketData.timeframes.D1.trend;
    const h4Trend = marketData.timeframes.H4.trend;

    if (d1Trend === 'bullish' && h4Trend === 'bullish') {
      return 'long';
    }

    if (d1Trend === 'bearish' && h4Trend === 'bearish') {
      return 'short';
    }

    return 'none';
  }

  private ensureTimeframeLabel(value: string, label: 'D1' | 'H4'): string {
    return value.includes(label) ? value : `${label}: ${value}`;
  }

  private deriveCheckResultFromStatus(
    status: DailyAnalysisAnalystDraft['status']
  ): 'PASS' | 'FAIL' | 'WARNING' {
    return status === 'TRADE_READY' ? 'PASS' : 'WARNING';
  }

  private normalizeDraftStatus(...candidates: unknown[]): DailyAnalysisAnalystDraft['status'] | undefined {
    for (const candidate of candidates) {
      if (candidate === 'TRADE_READY' || candidate === 'WAIT' || candidate === 'NO_TRADE') {
        return candidate;
      }
    }

    return undefined;
  }

  private normalizeValidationResult(
    ...candidates: unknown[]
  ): DailyAnalysisValidatorResult['validationResult'] | undefined {
    for (const candidate of candidates) {
      if (
        candidate === 'APPROVED' ||
        candidate === 'APPROVED_WITH_ADJUSTMENTS' ||
        candidate === 'REJECTED'
      ) {
        return candidate;
      }
    }

    return undefined;
  }

  private normalizeSetupType(...candidates: unknown[]): DailyAnalysisAnalystDraft['setupType'] | undefined {
    for (const candidate of candidates) {
      if (
        candidate === 'breakout' ||
        candidate === 'pullback' ||
        candidate === 'range' ||
        candidate === 'no-trade'
      ) {
        return candidate;
      }
    }

    return undefined;
  }

  private normalizeAlignment(
    value: unknown
  ): DailyAnalysisAnalystDraft['timeframeContext']['alignment'] | undefined {
    if (value === 'aligned' || value === 'conflicting' || value === 'neutral') {
      return value;
    }

    return undefined;
  }

  private normalizeTrendCondition(
    ...candidates: unknown[]
  ): DailyAnalysisAnalystDraft['marketState']['trendCondition'] | undefined {
    for (const candidate of candidates) {
      if (
        candidate === 'trending' ||
        candidate === 'ranging' ||
        candidate === 'compressed' ||
        candidate === 'transitional'
      ) {
        return candidate;
      }

      if (candidate === 'volatile') {
        return 'transitional';
      }
    }

    return undefined;
  }

  private normalizeVolumeCondition(
    ...candidates: unknown[]
  ): DailyAnalysisAnalystDraft['marketState']['volumeCondition'] | undefined {
    for (const candidate of candidates) {
      if (
        candidate === 'strong' ||
        candidate === 'normal' ||
        candidate === 'weak' ||
        candidate === 'very_weak'
      ) {
        return candidate;
      }
    }

    return undefined;
  }

  private normalizeVolatilityCondition(
    ...candidates: unknown[]
  ): DailyAnalysisAnalystDraft['marketState']['volatilityCondition'] | undefined {
    for (const candidate of candidates) {
      if (candidate === 'high' || candidate === 'normal' || candidate === 'low') {
        return candidate;
      }
    }

    return undefined;
  }

  private normalizeSetupDirection(
    ...candidates: unknown[]
  ): DailyAnalysisAnalystDraft['primarySetup']['direction'] | undefined {
    for (const candidate of candidates) {
      if (candidate === 'long' || candidate === 'short' || candidate === 'none') {
        return candidate;
      }
    }

    return undefined;
  }

  private normalizeCheckResult(...candidates: unknown[]): 'PASS' | 'FAIL' | 'WARNING' | undefined {
    for (const candidate of candidates) {
      if (candidate === 'PASS' || candidate === 'FAIL' || candidate === 'WARNING') {
        return candidate;
      }
    }

    return undefined;
  }

  private normalizePlanInput(input: unknown): unknown {
    if (!this.isRecord(input)) {
      return input;
    }

    const normalized = { ...input } as Record<string, unknown>;
    const normalizedConfidence = this.normalizeConfidence(normalized.confidence);

    if (normalizedConfidence != null) {
      normalized.confidence = normalizedConfidence;
    }

    normalized.tradePlan = this.normalizeTradePlan(normalized);
    normalized.scenarios = this.normalizeScenarios(normalized);
    normalized.riskNote = this.firstString(
      normalized.riskNote,
      normalized.risk_note,
      normalized.riskNotes,
      normalized.risk_notes,
      normalized.risk,
      normalized.note,
      normalized.notes
    );
    normalized.timeHorizon = this.firstString(
      normalized.timeHorizon,
      normalized.time_horizon,
      normalized.timeframe,
      normalized.timeFrame,
      normalized.horizon,
      normalized.tradeHorizon
    );

    return normalized;
  }

  private normalizeTradePlan(source: Record<string, unknown>): unknown {
    if (this.isRecord(source.tradePlan)) {
      return this.normalizeTradePlanRecord(source.tradePlan);
    }

    if (this.isRecord(source.trade_plan)) {
      return this.normalizeTradePlanRecord(source.trade_plan);
    }

    if (this.isRecord(source.plan)) {
      return this.normalizeTradePlanRecord(source.plan);
    }

    const entryZone = this.firstString(source.entryZone, source.entry_zone);
    const stopLoss = this.firstString(source.stopLoss, source.stop_loss);
    const takeProfit = this.firstString(source.takeProfit, source.take_profit);
    const invalidation = this.firstString(source.invalidation, source.invalidatesAt);

    if (entryZone && stopLoss && takeProfit && invalidation) {
      return {
        entryZone,
        stopLoss,
        takeProfit,
        invalidation
      };
    }

    return source.tradePlan;
  }

  private normalizeScenarios(source: Record<string, unknown>): unknown {
    if (this.isRecord(source.scenarios)) {
      return this.normalizeScenariosRecord(source.scenarios);
    }

    if (this.isRecord(source.scenario)) {
      return this.normalizeScenariosRecord(source.scenario);
    }

    if (this.isRecord(source.marketScenarios)) {
      return this.normalizeScenariosRecord(source.marketScenarios);
    }

    const bullishScenario = this.firstString(
      source.bullishScenario,
      source.bullish_scenario,
      source.bullishCase,
      source.bullish_case,
      source.bullish
    );
    const bearishScenario = this.firstString(
      source.bearishScenario,
      source.bearish_scenario,
      source.bearishCase,
      source.bearish_case,
      source.bearish
    );

    if (bullishScenario && bearishScenario) {
      return {
        bullishScenario,
        bearishScenario
      };
    }

    return source.scenarios;
  }

  private normalizeTradePlanRecord(source: Record<string, unknown>): unknown {
    const entryZone = this.firstString(source.entryZone, source.entry_zone);
    const stopLoss = this.firstString(source.stopLoss, source.stop_loss);
    const takeProfit = this.firstString(source.takeProfit, source.take_profit);
    const invalidation = this.firstString(source.invalidation, source.invalidatesAt);

    if (entryZone && stopLoss && takeProfit && invalidation) {
      return {
        entryZone,
        stopLoss,
        takeProfit,
        invalidation
      };
    }

    return source;
  }

  private normalizeScenariosRecord(source: Record<string, unknown>): unknown {
    const bullishScenario = this.firstString(
      source.bullishScenario,
      source.bullish_scenario,
      source.bullishCase,
      source.bullish_case,
      source.bullish
    );
    const bearishScenario = this.firstString(
      source.bearishScenario,
      source.bearish_scenario,
      source.bearishCase,
      source.bearish_case,
      source.bearish
    );

    if (bullishScenario && bearishScenario) {
      return {
        bullishScenario,
        bearishScenario
      };
    }

    return source;
  }

  private parsePlanInput(
    rawPlan: unknown,
    marketInput: DailyAnalysisGatewayInput
  ): DailyAnalysisPlan | null {
    const result = dailyAnalysisPlanSchema.safeParse(
      this.completePlanInput(this.normalizePlanInput(rawPlan), marketInput)
    );

    if (result.success) {
      return result.data;
    }

    return null;
  }

  private completePlanInput(
    rawPlan: unknown,
    marketInput: DailyAnalysisGatewayInput
  ): Record<string, unknown> | unknown {
    if (!this.isRecord(rawPlan)) {
      return rawPlan;
    }

    const completed = { ...rawPlan } as Record<string, unknown>;
    const bias = this.normalizeBias(completed.bias) ?? this.deriveBias(marketInput);

    completed.bias = bias;

    if (!this.isNonEmptyString(completed.analysis)) {
      completed.analysis = this.deriveAnalysis(marketInput, bias);
    }

    if (this.normalizeConfidence(completed.confidence) == null) {
      completed.confidence = this.deriveConfidence(marketInput);
    } else {
      completed.confidence = this.normalizeConfidence(completed.confidence);
    }

    completed.tradePlan = this.completeTradePlan(completed.tradePlan, marketInput, bias);
    completed.scenarios = this.completeScenarios(completed.scenarios, completed.tradePlan, bias);

    if (!this.isNonEmptyString(completed.riskNote)) {
      completed.riskNote = this.deriveRiskNote(completed.tradePlan);
    }

    if (!this.isNonEmptyString(completed.timeHorizon)) {
      completed.timeHorizon = 'intraday to 1 day';
    }

    return completed;
  }

  private async repairIncompletePlan(
    input: DailyAnalysisGatewayInput,
    partialPlan: unknown
  ): Promise<DailyAnalysisPlan> {
    const repairResponse = await this.requestClaudeMessage(
      [
        this.buildPrompt(input),
        '',
        'The previous tool input was incomplete or used the wrong field names.',
        'Rewrite it into the exact required schema and fill every required field with concise Vietnamese text.',
        'Keep the same technical intent, do not add fundamentals, and preserve a breakout-following trend bias.',
        `Previous partial tool input: ${JSON.stringify(this.normalizePlanInput(partialPlan))}`
      ].join('\n'),
      'You repair partially structured crypto analysis plans into the exact required tool schema.'
    );

    const repairedToolUseInput = repairResponse.data.content?.find(
      (block) => block.type === 'tool_use' && block.name === DAILY_ANALYSIS_TOOL_NAME
    )?.input;

    const repairedPlan = this.parsePlanInput(repairedToolUseInput, input);

    if (repairedPlan) {
      return repairedPlan;
    }

    const details =
      repairedToolUseInput == null ? 'empty response' : JSON.stringify(this.normalizePlanInput(repairedToolUseInput));

    throw new Error(`Claude daily analysis repair failed to produce a valid plan: ${details}`);
  }

  private normalizeConfidence(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private firstString(...candidates: unknown[]): string | undefined {
    return candidates.find((candidate): candidate is string => typeof candidate === 'string');
  }

  private normalizeBias(value: unknown): DailyAnalysisPlan['bias'] | undefined {
    if (value === 'Bullish' || value === 'Bearish' || value === 'Neutral') {
      return value;
    }

    if (value === 'bullish') {
      return 'Bullish';
    }

    if (value === 'bearish') {
      return 'Bearish';
    }

    if (value === 'neutral') {
      return 'Neutral';
    }

    return undefined;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private deriveBias(input: DailyAnalysisGatewayInput): DailyAnalysisPlan['bias'] {
    if (input.d1.trend === input.h4.trend && input.d1.trend !== 'neutral') {
      return input.d1.trend === 'bullish' ? 'Bullish' : 'Bearish';
    }

    if (input.h4.trend !== 'neutral') {
      return input.h4.trend === 'bullish' ? 'Bullish' : 'Bearish';
    }

    if (input.d1.trend !== 'neutral') {
      return input.d1.trend === 'bullish' ? 'Bullish' : 'Bearish';
    }

    return 'Neutral';
  }

  private deriveConfidence(input: DailyAnalysisGatewayInput): number {
    if (input.d1.trend === input.h4.trend && input.d1.trend !== 'neutral') {
      return 78;
    }

    if (input.d1.trend === 'neutral' && input.h4.trend === 'neutral') {
      return 55;
    }

    if (input.d1.trend === 'neutral' || input.h4.trend === 'neutral') {
      return 66;
    }

    return 52;
  }

  private deriveAnalysis(
    input: DailyAnalysisGatewayInput,
    bias: DailyAnalysisPlan['bias']
  ): string {
    if (bias === 'Bullish') {
      return `D1 nghieng tang va H4 uu tien tim co hoi breakout theo xu huong, tap trung theo doi pha vuot ${this.formatPrice(input.h4.r1)} de mo rong len ${this.formatPrice(input.h4.r2)}.`;
    }

    if (bias === 'Bearish') {
      return `D1 nghieng giam va H4 uu tien tim co hoi breakdown theo xu huong, tap trung theo doi pha mat ${this.formatPrice(input.h4.s1)} de mo rong ve ${this.formatPrice(input.h4.s2)}.`;
    }

    return `D1 va H4 chua dong thuan manh, uu tien quan sat pha vo khoi vung ${this.formatPrice(input.h4.s1)}-${this.formatPrice(input.h4.r1)} truoc khi kich hoat ke hoach.`;
  }

  private completeTradePlan(
    rawTradePlan: unknown,
    input: DailyAnalysisGatewayInput,
    bias: DailyAnalysisPlan['bias']
  ): Record<string, unknown> {
    const fallback = this.deriveTradePlan(input, bias);
    const source = this.isRecord(rawTradePlan) ? rawTradePlan : {};

    return {
      entryZone: this.firstString(source.entryZone, source.entry_zone, fallback.entryZone),
      stopLoss: this.firstString(source.stopLoss, source.stop_loss, fallback.stopLoss),
      takeProfit: this.firstString(source.takeProfit, source.take_profit, fallback.takeProfit),
      invalidation: this.firstString(
        source.invalidation,
        source.invalidatesAt,
        fallback.invalidation
      )
    };
  }

  private deriveTradePlan(
    input: DailyAnalysisGatewayInput,
    bias: DailyAnalysisPlan['bias']
  ): Record<string, string> {
    if (bias === 'Bullish') {
      return {
        entryZone: `Canh mua khi dong H4 vuot ${this.formatPrice(input.h4.r1)} va giu vung retest.`,
        stopLoss: `Dung lo duoi ${this.formatPrice(input.h4.s1)}.`,
        takeProfit: `Chot loi tai ${this.formatPrice(input.h4.r2)}.`,
        invalidation: `Ke hoach mat hieu luc neu dong H4 quay xuong duoi ${this.formatPrice(input.h4.r1)} hoac mat ${this.formatPrice(input.h4.s1)}.`
      };
    }

    if (bias === 'Bearish') {
      return {
        entryZone: `Canh ban khi dong H4 pha ${this.formatPrice(input.h4.s1)} va khong lay lai vung nay.`,
        stopLoss: `Dung lo tren ${this.formatPrice(input.h4.r1)}.`,
        takeProfit: `Chot loi tai ${this.formatPrice(input.h4.s2)}.`,
        invalidation: `Ke hoach mat hieu luc neu dong H4 quay lai tren ${this.formatPrice(input.h4.s1)} va vuot ${this.formatPrice(input.h4.r1)}.`
      };
    }

    return {
      entryZone: `Dung ngoai cho den khi gia dong H4 vuot ${this.formatPrice(input.h4.r1)} hoac pha ${this.formatPrice(input.h4.s1)}.`,
      stopLoss: `Chi kich hoat sau khi co huong ro rang; tham chieu dung lo quanh ${this.formatPrice(input.h4.s1)} hoac ${this.formatPrice(input.h4.r1)} tuy kich ban.`,
      takeProfit: `Muc tieu dau tien la ${this.formatPrice(input.h4.r2)} neu breakout tang hoac ${this.formatPrice(input.h4.s2)} neu breakdown giam.`,
      invalidation: `Bo qua ke hoach neu gia tiep tuc di ngang giua ${this.formatPrice(input.h4.s1)} va ${this.formatPrice(input.h4.r1)}.`
    };
  }

  private completeScenarios(
    rawScenarios: unknown,
    tradePlan: unknown,
    bias: DailyAnalysisPlan['bias']
  ): Record<string, unknown> {
    const source = this.isRecord(rawScenarios) ? rawScenarios : {};
    const fallback = this.deriveScenarios(tradePlan, bias);

    return {
      bullishScenario: this.firstString(
        source.bullishScenario,
        source.bullish_scenario,
        source.bullishCase,
        source.bullish_case,
        source.bullish,
        fallback.bullishScenario
      ),
      bearishScenario: this.firstString(
        source.bearishScenario,
        source.bearish_scenario,
        source.bearishCase,
        source.bearish_case,
        source.bearish,
        fallback.bearishScenario
      )
    };
  }

  private deriveScenarios(
    tradePlan: unknown,
    bias: DailyAnalysisPlan['bias']
  ): Record<string, string> {
    const source = this.isRecord(tradePlan) ? tradePlan : {};
    const entryZone = this.firstString(source.entryZone, source.entry_zone) ?? 'vung kich hoat ke hoach';
    const takeProfit = this.firstString(source.takeProfit, source.take_profit) ?? 'muc tieu tiep theo';
    const invalidation =
      this.firstString(source.invalidation, source.invalidatesAt) ?? 'muc vo hieu cua setup';

    if (bias === 'Bearish') {
      return {
        bullishScenario: `Neu gia lay lai cau truc va khong kich hoat setup giam, uu tien dung ngoai thay vi giao dich nguoc tin hieu chinh.`,
        bearishScenario: `Neu gia kich hoat ke hoach quanh ${entryZone}, dong luc giam co the mo rong ve ${takeProfit}. Neu bi vo hieu tai ${invalidation}, can dung ngoai.`
      };
    }

    if (bias === 'Neutral') {
      return {
        bullishScenario: `Neu gia breakout len khoi vung quan sat va giu duoc ${entryZone}, co the mo rong toi ${takeProfit}.`,
        bearishScenario: `Neu gia khong giu duoc cau truc va kich hoat vo hieu tai ${invalidation}, uu tien dung ngoai va cho xac nhan moi.`
      };
    }

    return {
      bullishScenario: `Neu gia xac nhan setup quanh ${entryZone}, dong luc tang co the mo rong toi ${takeProfit}.`,
      bearishScenario: `Neu setup bi vo hieu tai ${invalidation}, uu tien dung ngoai va quan sat cau truc moi thay vi giu bias cu.`
    };
  }

  private deriveRiskNote(tradePlan: unknown): string {
    const source = this.isRecord(tradePlan) ? tradePlan : {};
    const entryZone = this.firstString(source.entryZone, source.entry_zone) ?? 'vung kich hoat';

    return `Chi kich hoat ke hoach khi nen H4 xac nhan ro rang; tranh vao lenh neu gia da chay xa khoi ${entryZone}.`;
  }

  private formatPrice(value: number): string {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 2
    }).format(value);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
