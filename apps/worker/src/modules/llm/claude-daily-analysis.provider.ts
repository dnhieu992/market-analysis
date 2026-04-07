import { Injectable, Optional } from '@nestjs/common';
import { type DailyAnalysisPlan, dailyAnalysisPlanSchema } from '@app/core';
import axios, { type AxiosInstance } from 'axios';

import type {
  ClaudeModelVariant,
  DailyAnalysisGatewayInput,
  DailyAnalysisGatewayResult,
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

const CLAUDE_MODEL_IDS: Record<ClaudeModelVariant, string> = {
  sonnet: 'claude-3-7-sonnet-latest',
  opus: 'claude-opus-4-20250514'
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
        timeout: 20_000,
        headers: {
          'x-api-key': apiKey ?? process.env.CLAUDE_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });
  }

  getResolvedModel(): string {
    return CLAUDE_MODEL_IDS[this.modelVariant] ?? this.modelVariant;
  }

  async generateDailyAnalysisPlan(
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
    if (value === 'bullish' || value === 'bearish' || value === 'neutral') {
      return value;
    }

    return undefined;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private deriveBias(input: DailyAnalysisGatewayInput): DailyAnalysisPlan['bias'] {
    if (input.d1.trend === input.h4.trend && input.d1.trend !== 'neutral') {
      return input.d1.trend;
    }

    if (input.h4.trend !== 'neutral') {
      return input.h4.trend;
    }

    if (input.d1.trend !== 'neutral') {
      return input.d1.trend;
    }

    return 'neutral';
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
    if (bias === 'bullish') {
      return `D1 nghieng tang va H4 uu tien tim co hoi breakout theo xu huong, tap trung theo doi pha vuot ${this.formatPrice(input.h4.r1)} de mo rong len ${this.formatPrice(input.h4.r2)}.`;
    }

    if (bias === 'bearish') {
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
    if (bias === 'bullish') {
      return {
        entryZone: `Canh mua khi dong H4 vuot ${this.formatPrice(input.h4.r1)} va giu vung retest.`,
        stopLoss: `Dung lo duoi ${this.formatPrice(input.h4.s1)}.`,
        takeProfit: `Chot loi tai ${this.formatPrice(input.h4.r2)}.`,
        invalidation: `Ke hoach mat hieu luc neu dong H4 quay xuong duoi ${this.formatPrice(input.h4.r1)} hoac mat ${this.formatPrice(input.h4.s1)}.`
      };
    }

    if (bias === 'bearish') {
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

    if (bias === 'bearish') {
      return {
        bullishScenario: `Neu gia lay lai cau truc va khong kich hoat setup giam, uu tien dung ngoai thay vi giao dich nguoc tin hieu chinh.`,
        bearishScenario: `Neu gia kich hoat ke hoach quanh ${entryZone}, dong luc giam co the mo rong ve ${takeProfit}. Neu bi vo hieu tai ${invalidation}, can dung ngoai.`
      };
    }

    if (bias === 'neutral') {
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
