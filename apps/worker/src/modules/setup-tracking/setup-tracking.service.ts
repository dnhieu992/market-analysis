import { Injectable, Logger, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import type { Candle } from '@app/core';
import { createTrackedSetupRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';

type TrackedSetupRepository = ReturnType<typeof createTrackedSetupRepository>;
type TrackedSetupRow = Awaited<ReturnType<TrackedSetupRepository['listOpen']>>[number];

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// A PENDING setup that never fills within this many days is auto-expired.
const EXPIRY_DAYS = 3;
// Number of 1h candles fetched per symbol for the hourly tracking pass.
const TRACK_CANDLE_LIMIT = 48;

type ClaudeToolUseResponse = {
  content?: Array<{ type: string; name?: string; input?: unknown }>;
};

const VALIDITY_TOOL = {
  name: 'judge_setup_validity',
  description:
    'Judge whether a previously-planned, not-yet-filled trade setup is still valid given how price ' +
    'has moved since. Mark invalid when the premise is broken (e.g. structure flipped, level decisively ' +
    'lost, price ran away from the entry making the R:R no longer reasonable).',
  input_schema: {
    type: 'object' as const,
    properties: {
      valid: { type: 'boolean' },
      reason: { type: 'string', description: 'Short Vietnamese explanation (1-2 sentences).' }
    },
    required: ['valid', 'reason']
  }
};

/**
 * Tracks the lifecycle of extracted trade setups:
 *  - trackOpenSetups()  hourly  → PENDING→ENTERED→TP/SL using 1h candles.
 *  - reviewStaleSetups() daily   → EXPIRED (stale PENDING) + LLM INVALID check.
 * All Telegram / LLM calls are non-fatal.
 */
@Injectable()
export class SetupTrackingService {
  private readonly logger = new Logger(SetupTrackingService.name);
  private readonly trackedSetupRepository: TrackedSetupRepository;
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly telegramService: TelegramService,
    @Optional() httpClient?: AxiosInstance
  ) {
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

  /** Hourly: advance every open setup against fresh 1h candles. */
  async trackOpenSetups(): Promise<void> {
    const open = await this.trackedSetupRepository.listOpen();
    if (open.length === 0) {
      this.logger.log('No open tracked setups to check');
      return;
    }

    const bySymbol = new Map<string, TrackedSetupRow[]>();
    for (const setup of open) {
      const list = bySymbol.get(setup.symbol) ?? [];
      list.push(setup);
      bySymbol.set(setup.symbol, list);
    }

    for (const [symbol, setups] of bySymbol) {
      try {
        const candles = await this.marketDataService.getCandles(symbol, '1h', TRACK_CANDLE_LIMIT);
        if (candles.length === 0) continue;
        const lastPrice = candles[candles.length - 1]!.close;
        for (const setup of setups) {
          await this.processSetup(setup, candles, lastPrice);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Tracking failed for ${symbol} (non-fatal): ${msg}`);
      }
    }
  }

  private async processSetup(setup: TrackedSetupRow, candles: Candle[], lastPrice: number): Promise<void> {
    const since = setup.lastCheckedAt ? new Date(setup.lastCheckedAt).getTime() : 0;
    const fresh = candles.filter((c) => (c.openTime?.getTime() ?? 0) > since);

    const isLong = setup.direction === 'long';
    let status = setup.status;
    const update: Record<string, unknown> = {};
    const events: string[] = [];

    for (const c of fresh) {
      const t = c.closeTime ?? c.openTime ?? new Date();

      if (status === 'PENDING') {
        const entered = isLong ? c.low <= setup.entryHigh : c.high >= setup.entryLow;
        if (entered) {
          status = 'ENTERED';
          update.status = 'ENTERED';
          update.enteredAt = t;
          events.push('ENTERED');
        }
      }

      if (status === 'ENTERED') {
        // Conservative: a candle that touches both SL and TP is scored as SL.
        const slHit = isLong ? c.low <= setup.stopLoss : c.high >= setup.stopLoss;
        if (slHit) {
          status = 'SL_HIT';
          update.status = 'SL_HIT';
          update.slHitAt = t;
          update.closedAt = t;
          events.push('SL_HIT');
          break;
        }

        if (setup.takeProfit1 != null) {
          const tp1Hit = isLong ? c.high >= setup.takeProfit1 : c.low <= setup.takeProfit1;
          if (tp1Hit && !setup.tp1HitAt && update.tp1HitAt == null) {
            update.tp1HitAt = t;
            events.push('TP1_HIT');
            if (setup.takeProfit2 == null) {
              status = 'TP1_HIT';
              update.status = 'TP1_HIT';
              update.closedAt = t;
              break;
            }
          }
        }

        if (setup.takeProfit2 != null) {
          const tp2Hit = isLong ? c.high >= setup.takeProfit2 : c.low <= setup.takeProfit2;
          if (tp2Hit) {
            if (!setup.tp1HitAt && update.tp1HitAt == null) update.tp1HitAt = t;
            status = 'TP2_HIT';
            update.status = 'TP2_HIT';
            update.tp2HitAt = t;
            update.closedAt = t;
            events.push('TP2_HIT');
            break;
          }
        }
      }
    }

    update.lastCheckedAt = new Date();
    update.lastPrice = lastPrice;

    await this.trackedSetupRepository.update(setup.id, update);

    for (const event of events) {
      await this.notify(setup, event, lastPrice);
    }
  }

  /** Daily: expire stale PENDING setups and ask the LLM if older open setups are still valid. */
  async reviewStaleSetups(): Promise<void> {
    const open = await this.trackedSetupRepository.listOpen();
    if (open.length === 0) {
      this.logger.log('No open tracked setups to review');
      return;
    }

    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const candleCache = new Map<string, Candle[]>();

    for (const setup of open) {
      try {
        const planTime = new Date(setup.planDate).getTime();
        const ageDays = (todayUtc.getTime() - planTime) / 86_400_000;

        // Deterministic expiry for never-filled setups.
        if (setup.status === 'PENDING' && ageDays >= EXPIRY_DAYS) {
          await this.trackedSetupRepository.update(setup.id, {
            status: 'EXPIRED',
            closedAt: new Date(),
            invalidatedReason: `Không khớp lệnh sau ${EXPIRY_DAYS} ngày`
          });
          this.logger.log(`Setup ${setup.id} (${setup.symbol}) expired`);
          continue;
        }

        // LLM validity check only for setups from a previous day (skip today's fresh ones).
        if (planTime >= todayUtc.getTime()) continue;

        let candles = candleCache.get(setup.symbol);
        if (!candles) {
          candles = await this.marketDataService.getCandles(setup.symbol, '1d', 10);
          candleCache.set(setup.symbol, candles);
        }

        const verdict = await this.callClaudeValidity(setup, candles);
        if (verdict && verdict.valid === false) {
          await this.trackedSetupRepository.update(setup.id, {
            status: 'INVALID',
            closedAt: new Date(),
            invalidatedReason: verdict.reason || 'Setup không còn hợp lệ'
          });
          await this.notify(setup, 'INVALID', candles[candles.length - 1]?.close ?? 0, verdict.reason);
          this.logger.log(`Setup ${setup.id} (${setup.symbol}) marked INVALID: ${verdict.reason}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Review failed for setup ${setup.id} (non-fatal): ${msg}`);
      }
    }
  }

  private async callClaudeValidity(
    setup: TrackedSetupRow,
    candles: Candle[]
  ): Promise<{ valid: boolean; reason: string } | null> {
    const priceLines = candles
      .slice(-7)
      .map((c) => {
        const d = c.openTime ? c.openTime.toISOString().slice(0, 10) : '?';
        return `${d}: O=${c.open} H=${c.high} L=${c.low} C=${c.close}`;
      })
      .join('\n');
    const currentPrice = candles[candles.length - 1]?.close ?? 0;

    const response = await this.httpClient.post<ClaudeToolUseResponse>('/v1/messages', {
      model: CLAUDE_MODEL,
      max_tokens: 512,
      tools: [VALIDITY_TOOL],
      tool_choice: { type: 'tool', name: VALIDITY_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `Setup ${setup.symbol} (${setup.direction}) lập ngày ${new Date(setup.planDate)
                  .toISOString()
                  .slice(0, 10)}, hiện chưa kết thúc (status=${setup.status}).`,
                `Entry: ${setup.entryLow}-${setup.entryHigh} | SL: ${setup.stopLoss} | ` +
                  `TP1: ${setup.takeProfit1 ?? '-'} | TP2: ${setup.takeProfit2 ?? '-'}`,
                `Giá hiện tại: ${currentPrice}`,
                '',
                'Diễn biến giá D1 gần đây:',
                priceLines || '(không có dữ liệu)',
                '',
                'Setup này còn hợp lệ để chờ vào lệnh / giữ lệnh không? Dùng tool để trả lời.'
              ].join('\n')
            }
          ]
        }
      ]
    });

    const toolUse = response.data.content?.find((b) => b.type === 'tool_use' && b.name === VALIDITY_TOOL.name);
    const input = toolUse?.input as { valid?: boolean; reason?: string } | undefined;
    if (input == null || typeof input.valid !== 'boolean') return null;
    return { valid: input.valid, reason: input.reason ?? '' };
  }

  private async notify(setup: TrackedSetupRow, event: string, price: number, reason?: string): Promise<void> {
    const labels: Record<string, string> = {
      ENTERED: '✅ Đã khớp lệnh',
      TP1_HIT: '🎯 Chạm TP1',
      TP2_HIT: '🎯 Chạm TP2',
      SL_HIT: '🛑 Dính SL',
      INVALID: '⚠️ Setup không còn hợp lệ'
    };
    const dir = setup.direction === 'long' ? 'LONG' : 'SHORT';
    const lines = [
      `${labels[event] ?? event} — ${setup.symbol} ${dir}`,
      `Entry ${setup.entryLow}-${setup.entryHigh} | SL ${setup.stopLoss}` +
        (setup.takeProfit1 != null ? ` | TP1 ${setup.takeProfit1}` : '') +
        (setup.takeProfit2 != null ? ` | TP2 ${setup.takeProfit2}` : ''),
      `Giá: ${price}`
    ];
    if (reason) lines.push(reason);

    try {
      await this.telegramService.sendAnalysisMessage({
        content: lines.join('\n'),
        messageType: 'setup-tracking'
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Telegram notify failed for setup ${setup.id}: ${msg}`);
    }
  }
}
