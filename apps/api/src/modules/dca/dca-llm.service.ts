import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import type { CapitalState } from './dca.service';
import type { LlmPlanItem } from './dca-plan.service';
import type { Candle } from '@app/core';

const DCA_PLAN_TOOL_NAME = 'record_dca_plan';
const DCA_ANALYSIS_TOOL_NAME = 'record_dca_analysis';

const PLAN_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'targetPrice', 'suggestedAmount', 'note'],
  properties: {
    type: { type: 'string', enum: ['buy', 'sell'] },
    targetPrice: { type: 'number', description: 'Target price level' },
    suggestedAmount: {
      type: 'number',
      description: 'Buy = USD to spend; Sell = coin quantity to sell'
    },
    note: { type: 'string', description: 'Reasoning for this zone (Vietnamese)' }
  }
} as const;

const DCA_PLAN_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['llmAnalysis', 'items'],
  properties: {
    llmAnalysis: {
      type: 'string',
      description: 'Overall market context, rationale, estimated duration (Vietnamese)'
    },
    items: {
      type: 'array',
      items: PLAN_ITEM_SCHEMA
    }
  }
} as const;

const DCA_ANALYSIS_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['llmAnalysis'],
  properties: {
    llmAnalysis: {
      type: 'string',
      description: 'Market analysis update without changing the plan (Vietnamese)'
    }
  }
} as const;

type LlmPlanResult = {
  llmAnalysis: string;
  items: LlmPlanItem[];
};

type LlmAnalysisResult = {
  llmAnalysis: string;
};

type PlanItemContext = {
  type: string;
  targetPrice: number;
  suggestedAmount: number;
  note: string | null;
  status: string;
  source: string;
  userModified: boolean;
  deletedByUser: boolean;
  originalTargetPrice?: number | null;
  originalSuggestedAmount?: number | null;
  executedPrice?: number | null;
  executedAmount?: number | null;
};

type ArchivedPlanContext = {
  createdAt: string;
  archivedAt: string | null;
  executedItems: PlanItemContext[];
};

const TIMEOUT_MS = 90_000;

function resolveModel(): string {
  return process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
}

function formatCandles(candles: Candle[]): string {
  return candles
    .map((c) => {
      const date = c.openTime ? c.openTime.toISOString().slice(0, 10) : 'unknown';
      return `${date} | O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume ?? 0}`;
    })
    .join('\n');
}

const SYSTEM_PROMPT =
  'You are a senior crypto DCA (Dollar Cost Averaging) analyst specializing in BTC and ETH. ' +
  'You analyze price action, support/resistance zones, and market structure to suggest optimal ' +
  'DCA entry (buy) and exit (sell) zones with capital allocation. ' +
  'Always respond in Vietnamese. ' +
  'For buy items, suggestedAmount is in USD. For sell items, suggestedAmount is in coin quantity. ' +
  'Focus on risk management: spread entries across multiple zones, set sells at clear resistance. ' +
  'Consider the user\'s remaining budget and current holdings when planning.';

@Injectable()
export class DcaLlmService {
  private readonly logger = new Logger(DcaLlmService.name);

  async generatePlan(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[]
  ): Promise<LlmPlanResult | null> {
    const userMessage = this.buildGenerateMessage(coin, capital, dailyCandles, weeklyCandles);
    return this.callLlm(userMessage, DCA_PLAN_TOOL_NAME, DCA_PLAN_TOOL_SCHEMA);
  }

  async replan(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[],
    currentItems: PlanItemContext[],
    archivedPlans: ArchivedPlanContext[]
  ): Promise<LlmPlanResult | null> {
    const userMessage = this.buildReplanMessage(
      coin, capital, dailyCandles, weeklyCandles, currentItems, archivedPlans
    );
    return this.callLlm(userMessage, DCA_PLAN_TOOL_NAME, DCA_PLAN_TOOL_SCHEMA);
  }

  async reanalyze(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[],
    currentItems: PlanItemContext[]
  ): Promise<LlmAnalysisResult | null> {
    const userMessage = this.buildReanalyzeMessage(
      coin, capital, dailyCandles, weeklyCandles, currentItems
    );
    return this.callLlm(userMessage, DCA_ANALYSIS_TOOL_NAME, DCA_ANALYSIS_TOOL_SCHEMA);
  }

  private async callLlm<T>(
    userMessage: string,
    toolName: string,
    toolSchema: Record<string, unknown>
  ): Promise<T | null> {
    const apiKey = (process.env.CLAUDE_API_KEY ?? '').trim();
    const model = resolveModel();

    try {
      const client = axios.create({
        baseURL: 'https://api.anthropic.com/v1',
        timeout: TIMEOUT_MS,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });

      const response = await client.post<{
        content?: Array<{ type?: string; name?: string; input?: unknown }>;
      }>('/messages', {
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        tools: [
          {
            name: toolName,
            description: `Record structured DCA plan output for ${toolName}`,
            input_schema: toolSchema
          }
        ],
        tool_choice: { type: 'tool', name: toolName }
      });

      const toolInput = response.data.content?.find(
        (block) => block.type === 'tool_use' && block.name === toolName
      )?.input as T | undefined;

      if (toolInput == null) {
        this.logger.warn(`DCA LLM: response missing tool_use block for ${toolName}`);
        return null;
      }

      return toolInput;
    } catch (error) {
      const axiosError = error as { response?: { status?: number; data?: unknown }; message?: string };
      this.logger.warn(
        `DCA LLM failed: ${axiosError.message} | body: ${JSON.stringify(axiosError.response?.data)}`
      );
      return null;
    }
  }

  private buildGenerateMessage(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[]
  ): string {
    return [
      `=== DCA Plan Generation for ${coin} ===`,
      '',
      `Budget State:`,
      `  Total Budget: $${capital.totalBudget}`,
      `  Deployed: $${capital.deployedAmount.toFixed(2)}`,
      `  Remaining: $${capital.remaining.toFixed(2)}`,
      `  Runner: ${capital.runnerAmount} ${coin} @ avg $${capital.runnerAvgCost.toFixed(2)}`,
      '',
      `Daily Candles (last 90):`,
      formatCandles(dailyCandles),
      '',
      `Weekly Candles (last 26):`,
      formatCandles(weeklyCandles),
      '',
      'Create a DCA plan with buy zones (spread across support levels) and sell zones (at resistance). ',
      `Allocate the remaining $${capital.remaining.toFixed(2)} across multiple buy entries. `,
      'For sells, use coin quantity based on runner amount and expected buy positions.'
    ].join('\n');
  }

  private buildReplanMessage(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[],
    currentItems: PlanItemContext[],
    archivedPlans: ArchivedPlanContext[]
  ): string {
    const base = this.buildGenerateMessage(coin, capital, dailyCandles, weeklyCandles);

    const currentPlanSection = [
      '',
      '=== Current Plan Items ===',
      'Improve from these — do not reset. Respect user edits/deletions.',
      JSON.stringify(currentItems, null, 2)
    ].join('\n');

    const historySection = archivedPlans.length > 0
      ? [
          '',
          '=== Archived Plans History ===',
          JSON.stringify(archivedPlans, null, 2)
        ].join('\n')
      : '';

    return base + currentPlanSection + historySection;
  }

  private buildReanalyzeMessage(
    coin: string,
    capital: CapitalState,
    dailyCandles: Candle[],
    weeklyCandles: Candle[],
    currentItems: PlanItemContext[]
  ): string {
    const base = this.buildGenerateMessage(coin, capital, dailyCandles, weeklyCandles);

    return base + [
      '',
      '=== Current Plan Items (for reference only — do NOT change them) ===',
      JSON.stringify(currentItems, null, 2),
      '',
      'Provide ONLY a market analysis update. Do not suggest new plan items.'
    ].join('\n');
  }
}
