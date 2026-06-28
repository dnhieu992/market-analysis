import { Injectable, Logger, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { createDailyAnalysisRepository, createTrackedSetupRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';
import { detectTrend, type Trend } from '../market/utils/trend';

type DailyAnalysisRepository = ReturnType<typeof createDailyAnalysisRepository>;
type TrackedSetupRepository = ReturnType<typeof createTrackedSetupRepository>;

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Quality gates applied to every extracted setup before it is persisted as
// trackable. These exist because the daily plan is free-form LLM prose, so a
// setup can be counter-trend, have a poor reward:risk, or sit at an entry the
// market will never reach before the plan is superseded — exactly the pattern
// that produced "toàn stoploss với không khớp" (all stop-outs or never-filled).
const MIN_RR = 1.5;
// Drop a setup whose entry zone is further than this from the current price:
// such "treo" (hanging) limit orders just churn to INVALID when the next day's
// plan supersedes them, without ever filling.
const MAX_ENTRY_DISTANCE_PCT = 0.035;

type ClaudeToolUseResponse = {
  content?: Array<{ type: string; name?: string; input?: unknown }>;
};

type QualityGateRow = {
  slot: string;
  direction: 'long' | 'short' | 'none';
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number | null;
  takeProfit2: number | null;
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

  constructor(
    @Optional() private readonly marketDataService?: MarketDataService,
    @Optional() httpClient?: AxiosInstance
  ) {
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

      const candidates = setups
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

      const rows = await this.applyQualityGates(symbol, candidates);

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

  /**
   * Deterministic quality gates run after LLM extraction, before persistence.
   * Rejects setups that historically led to losses or never-filled noise:
   *  - poor reward:risk (RR < {@link MIN_RR}),
   *  - counter-trend vs the D1 trend (e.g. a dip-buy LONG in a clear downtrend),
   *  - an entry zone too far from price to realistically fill ({@link MAX_ENTRY_DISTANCE_PCT}).
   * Trend / distance gates need live market data; if it's unavailable the RR gate
   * still applies and the rest fail open (never block on a data hiccup).
   */
  private async applyQualityGates<T extends QualityGateRow>(symbol: string, rows: T[]): Promise<T[]> {
    if (rows.length === 0) return rows;

    let trend: Trend = 'neutral';
    let currentPrice = 0;
    try {
      const d1 = (await this.marketDataService?.getCandles(symbol, '1d', 200)) ?? [];
      if (d1.length > 0) {
        trend = detectTrend(d1);
        currentPrice = d1[d1.length - 1]!.close;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Trend/price fetch failed for ${symbol} — skipping trend/distance gates: ${msg}`);
    }

    const kept: T[] = [];
    for (const row of rows) {
      const reason = this.rejectReason(row, trend, currentPrice);
      if (reason) {
        this.logger.log(`Gate rejected ${symbol} ${row.slot} ${row.direction}: ${reason}`);
        continue;
      }
      kept.push(row);
    }
    return kept;
  }

  /** Returns a human-readable reason to reject a setup, or null to keep it. */
  private rejectReason(row: QualityGateRow, trend: Trend, currentPrice: number): string | null {
    const entryMid = (row.entryLow + row.entryHigh) / 2;
    const risk = Math.abs(entryMid - row.stopLoss);
    if (risk <= 0) return 'invalid stop-loss (zero risk)';

    // Reward:risk — judged on TP1, falling back to TP2 when TP1 is absent.
    const tp = row.takeProfit1 ?? row.takeProfit2;
    if (tp != null) {
      const rr = Math.abs(tp - entryMid) / risk;
      if (rr < MIN_RR) return `RR ${rr.toFixed(2)} < ${MIN_RR}`;
    }

    // Trend alignment — never fade a clearly-trending D1.
    if (trend === 'bearish' && row.direction === 'long') return 'LONG counter-trend (D1 bearish)';
    if (trend === 'bullish' && row.direction === 'short') return 'SHORT counter-trend (D1 bullish)';

    // Entry reachability — drop far "hanging" limits that just churn to INVALID.
    if (currentPrice > 0) {
      const inside = currentPrice >= row.entryLow && currentPrice <= row.entryHigh;
      const distance = inside
        ? 0
        : Math.min(Math.abs(currentPrice - row.entryLow), Math.abs(currentPrice - row.entryHigh)) / currentPrice;
      if (distance > MAX_ENTRY_DISTANCE_PCT) {
        return `entry too far from price (${(distance * 100).toFixed(1)}% > ${(MAX_ENTRY_DISTANCE_PCT * 100).toFixed(1)}%)`;
      }
    }

    return null;
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
