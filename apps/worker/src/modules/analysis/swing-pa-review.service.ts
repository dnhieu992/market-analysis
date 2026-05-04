import { Injectable, Logger } from '@nestjs/common';
import type { Candle } from '@app/core';
import axios from 'axios';

import type { SwingPaAnalysis } from './swing-pa-analyzer';

export type SwingPaSetupReview = {
  setupType: string;
  direction: 'long' | 'short';
  verdict: 'valid' | 'adjusted' | 'skip';
  adjustedConfidence?: 'high' | 'medium' | 'low';
  adjustedEntry?: [number, number];
  adjustedSl?: number;
  adjustedTp1?: number;
  adjustedTp2?: number;
  reason: string;
};

export type SwingPaReview = {
  verdict: 'confirmed' | 'adjusted' | 'no-trade';
  model: string;
  trendComment: string;
  activeSetupReview?: SwingPaSetupReview;
  limitSetupReviews: SwingPaSetupReview[];
  warnings: string[];
  summary: string;
};

const REVIEW_TOOL_NAME = 'record_swing_pa_review';

const SETUP_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['setupType', 'direction', 'verdict', 'reason'],
  properties: {
    setupType: { type: 'string' },
    direction: { type: 'string', enum: ['long', 'short'] },
    verdict: { type: 'string', enum: ['valid', 'adjusted', 'skip'] },
    adjustedConfidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    adjustedEntry: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    adjustedSl: { type: 'number' },
    adjustedTp1: { type: 'number' },
    adjustedTp2: { type: 'number' },
    reason: { type: 'string' }
  }
} as const;

const REVIEW_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'trendComment', 'limitSetupReviews', 'warnings', 'summary'],
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'adjusted', 'no-trade'] },
    trendComment: { type: 'string' },
    activeSetupReview: SETUP_REVIEW_SCHEMA,
    limitSetupReviews: { type: 'array', items: SETUP_REVIEW_SCHEMA },
    warnings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' }
  }
} as const;

const REVIEW_TIMEOUT_MS = 60_000;

function resolveModel(): string {
  return process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
}

function buildUserMessage(analysis: SwingPaAnalysis, dailyCandles: Candle[]): string {
  const last30 = dailyCandles.slice(-30);
  const candleText = last30
    .map((c) => {
      const date = c.openTime ? c.openTime.toISOString().slice(0, 10) : 'unknown';
      return `${date} | ${c.open} | ${c.high} | ${c.low} | ${c.close} | ${c.volume ?? 0}`;
    })
    .join('\n');

  return [
    'SwingPaAnalysis:',
    JSON.stringify(analysis, null, 2),
    '',
    'Last 30 daily candles (YYYY-MM-DD | open | high | low | close | volume):',
    candleText
  ].join('\n');
}

@Injectable()
export class SwingPaReviewService {
  private readonly logger = new Logger(SwingPaReviewService.name);

  async review(analysis: SwingPaAnalysis, dailyCandles: Candle[]): Promise<SwingPaReview | null> {
    const model = resolveModel();
    const apiKey = (process.env.CLAUDE_API_KEY ?? '').trim();
    this.logger.log(`[env] CLAUDE_API_KEY: ${apiKey ? apiKey.slice(0, 10) + '...' + apiKey.slice(-4) + ' len=' + apiKey.length : 'MISSING'}`);
    this.logger.log(`[env] CLAUDE_MODEL: ${model}`);

    try {
      const client = axios.create({
        baseURL: 'https://api.anthropic.com/v1',
        timeout: REVIEW_TIMEOUT_MS,
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
        max_tokens: 1500,
        system:
          'You are a senior pure price action swing trader reviewing an automated analysis. ' +
          "Review the setups strictly — prioritize R:R ≥ 2, zone quality (≥2 touches), " +
          "and trend alignment. Adjust or skip setups that don't meet the bar. " +
          'For each item in pendingLimitSetups, add a corresponding entry to limitSetupReviews — ' +
          'apply the same R:R ≥ 2 and zone quality criteria. ' +
          'If all limit setups are judged skip, or pendingLimitSetups is empty, you MUST add ' +
          'at least one replacement limit order to limitSetupReviews with verdict "adjusted". ' +
          'Choose the strongest support or resistance zone from srZones in the analysis data. ' +
          'Provide adjustedEntry [low, high], adjustedSl, adjustedTp1, and a reason in Vietnamese. ' +
          'Always respond in Vietnamese.',
        messages: [{ role: 'user', content: buildUserMessage(analysis, dailyCandles) }],
        tools: [
          {
            name: REVIEW_TOOL_NAME,
            description: 'Record structured swing PA review output.',
            input_schema: REVIEW_TOOL_SCHEMA
          }
        ],
        tool_choice: { type: 'tool', name: REVIEW_TOOL_NAME }
      });

      const toolInput = response.data.content?.find(
        (block) => block.type === 'tool_use' && block.name === REVIEW_TOOL_NAME
      )?.input as Record<string, unknown> | undefined;

      if (toolInput == null) {
        this.logger.warn('SwingPaReview: Claude response missing tool_use block');
        return null;
      }

      return {
        verdict: toolInput['verdict'] as SwingPaReview['verdict'],
        model,
        trendComment: toolInput['trendComment'] as string,
        activeSetupReview: toolInput['activeSetupReview'] as SwingPaSetupReview | undefined,
        limitSetupReviews: (toolInput['limitSetupReviews'] as SwingPaSetupReview[]) ?? [],
        warnings: (toolInput['warnings'] as string[]) ?? [],
        summary: toolInput['summary'] as string
      };
    } catch (error) {
      const axiosError = error as { response?: { status?: number; data?: unknown }; message?: string };
      this.logger.warn(`SwingPaReview failed: ${axiosError.message} | body: ${JSON.stringify(axiosError.response?.data)}`);
      return null;
    }
  }
}
