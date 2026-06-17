import { Injectable, Logger, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { createDailyAnalysisRepository, createTrackedSetupRepository } from '@app/db';

type DailyAnalysisRepository = ReturnType<typeof createDailyAnalysisRepository>;
type TrackedSetupRepository = ReturnType<typeof createTrackedSetupRepository>;

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

type ClaudeToolUseResponse = {
  content?: Array<{ type: string; name?: string; input?: unknown }>;
};

type ExtractedSetup = {
  slot: string;
  direction: 'long' | 'short' | 'none';
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  actionable: boolean;
};

const EXTRACTION_TOOL = {
  name: 'record_trade_setups',
  description:
    'Record the concrete, machine-trackable trade setups described in a daily trading plan. ' +
    'Return numeric price levels only (no text, no thousands separators). Use the same unit as the ' +
    'prices in the plan. If a level is given as a single price, set entryLow = entryHigh to that price. ' +
    'Only mark actionable = true when there is a real long/short setup with a stop loss and an entry.',
  input_schema: {
    type: 'object' as const,
    properties: {
      setups: {
        type: 'array',
        description: 'One item per distinct trade setup in the plan (e.g. primary and secondary).',
        items: {
          type: 'object',
          properties: {
            slot: {
              type: 'string',
              enum: ['primary', 'secondary'],
              description: 'primary for the main setup, secondary for an alternative/conditional setup.'
            },
            direction: { type: 'string', enum: ['long', 'short', 'none'] },
            entryLow: { type: ['number', 'null'], description: 'Lower bound of the entry zone.' },
            entryHigh: { type: ['number', 'null'], description: 'Upper bound of the entry zone.' },
            stopLoss: { type: ['number', 'null'] },
            takeProfit1: { type: ['number', 'null'] },
            takeProfit2: { type: ['number', 'null'] },
            actionable: {
              type: 'boolean',
              description: 'true only if this is a real tradeable setup (not a no-trade / wait note).'
            }
          },
          required: ['slot', 'direction', 'entryLow', 'entryHigh', 'stopLoss', 'actionable']
        }
      }
    },
    required: ['setups']
  }
};

/**
 * Parses the free-form daily plan markdown into structured, trackable trade
 * setups and persists them as TrackedSetup rows. Fully non-fatal — any failure
 * is logged and swallowed so plan generation is never blocked.
 */
@Injectable()
export class SetupExtractionService {
  private readonly logger = new Logger(SetupExtractionService.name);
  private readonly httpClient: AxiosInstance;
  private readonly dailyAnalysisRepository: DailyAnalysisRepository;
  private readonly trackedSetupRepository: TrackedSetupRepository;

  constructor(@Optional() httpClient?: AxiosInstance) {
    this.dailyAnalysisRepository = createDailyAnalysisRepository();
    this.trackedSetupRepository = createTrackedSetupRepository();
    this.httpClient =
      httpClient ??
      axios.create({
        baseURL: 'https://api.anthropic.com',
        timeout: 60_000,
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });
  }

  /** Extract + persist trackable setups for the given symbol's plan on `date` (defaults to today UTC). */
  async extractForSymbol(symbol: string, date?: Date): Promise<number> {
    try {
      const planDate = date ? new Date(date) : new Date();
      planDate.setUTCHours(0, 0, 0, 0);

      const record = await this.dailyAnalysisRepository.findByDate(symbol, planDate);
      if (!record) {
        this.logger.log(`No daily plan for ${symbol} on ${planDate.toISOString().slice(0, 10)} — skip extraction`);
        return 0;
      }

      if (await this.trackedSetupRepository.existsForPlan(record.id)) {
        this.logger.log(`Setups already extracted for ${symbol} plan ${record.id} — skip`);
        return 0;
      }

      const analysisText = this.readAnalysisText(record.aiOutputJson, record.summary);
      if (!analysisText) {
        this.logger.warn(`Empty plan text for ${symbol} — skip extraction`);
        return 0;
      }

      const setups = await this.callClaudeExtraction(symbol, analysisText);
      if (!setups || setups.length === 0) {
        this.logger.log(`No setups extracted for ${symbol}`);
        return 0;
      }

      const rows = setups
        .filter((s) => this.isPersistable(s))
        .map((s) => {
          const entryLow = Math.min(s.entryLow!, s.entryHigh ?? s.entryLow!);
          const entryHigh = Math.max(s.entryLow!, s.entryHigh ?? s.entryLow!);
          return {
            dailyAnalysisId: record.id,
            symbol,
            planDate,
            slot: s.slot === 'secondary' ? 'secondary' : 'primary',
            direction: s.direction,
            entryLow,
            entryHigh,
            stopLoss: s.stopLoss!,
            takeProfit1: Number.isFinite(s.takeProfit1 as number) ? s.takeProfit1 : null,
            takeProfit2: Number.isFinite(s.takeProfit2 as number) ? s.takeProfit2 : null,
            rawJson: JSON.stringify(s),
            status: 'PENDING'
          };
        });

      if (rows.length === 0) {
        this.logger.log(`No actionable setups for ${symbol} after filtering`);
        return 0;
      }

      await this.trackedSetupRepository.createMany(rows);
      this.logger.log(`Extracted ${rows.length} tracked setup(s) for ${symbol} (plan ${record.id})`);
      return rows.length;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Setup extraction failed for ${symbol} (non-fatal): ${msg}`);
      return 0;
    }
  }

  private isPersistable(s: ExtractedSetup): boolean {
    return (
      s.actionable === true &&
      (s.direction === 'long' || s.direction === 'short') &&
      Number.isFinite(s.stopLoss as number) &&
      Number.isFinite(s.entryLow as number)
    );
  }

  private readAnalysisText(aiOutputJson: string, summary: string): string {
    try {
      const parsed = JSON.parse(aiOutputJson) as { analysisText?: string };
      if (parsed?.analysisText && parsed.analysisText.trim().length > 0) {
        return parsed.analysisText;
      }
    } catch {
      // fall through to summary
    }
    return summary ?? '';
  }

  private async callClaudeExtraction(symbol: string, analysisText: string): Promise<ExtractedSetup[] | null> {
    const response = await this.httpClient.post<ClaudeToolUseResponse>('/v1/messages', {
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `Below is a daily trading plan for ${symbol} written in Vietnamese.`,
                'Extract the concrete trade setup(s) into structured numeric levels using the tool.',
                'Read entry / SL / TP / "vùng" prices from the prose. If a setup is a no-trade / observation,',
                'set actionable=false.',
                '',
                '=== PLAN ===',
                analysisText
              ].join('\n')
            }
          ]
        }
      ]
    });

    const toolUse = response.data.content?.find((b) => b.type === 'tool_use' && b.name === EXTRACTION_TOOL.name);
    const input = toolUse?.input as { setups?: ExtractedSetup[] } | undefined;
    return Array.isArray(input?.setups) ? input!.setups : null;
  }
}
