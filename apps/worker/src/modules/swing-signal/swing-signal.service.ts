import { Injectable, Logger } from '@nestjs/common';
import { createUserRepository } from '@app/db';
import axios, { type AxiosInstance } from 'axios';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';
import { preProcess } from './swing-signal-preprocessor';
import { buildSwingSignalPrompt, SWING_SIGNAL_SYSTEM_PROMPT } from './swing-signal-prompt';
import {
  parseAiResponse,
  validateAnalysis,
  type SwingSignalAiResponse
} from './swing-signal-validator';
import { formatSwingSignalBreakoutMessage } from './swing-signal-formatter';

const CLAUDE_TIMEOUT_MS = 90_000;
const RATE_LIMIT_DELAY_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveModel(): string {
  const env = process.env.CLAUDE_MODEL ?? '';
  if (env === 'opus') return 'claude-opus-4-6';
  return 'claude-sonnet-4-6';
}

@Injectable()
export class SwingSignalService {
  private readonly logger = new Logger(SwingSignalService.name);
  private readonly userRepository = createUserRepository();
  private readonly claudeClient: AxiosInstance;

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly telegramService: TelegramService
  ) {
    this.claudeClient = axios.create({
      baseURL: 'https://api.anthropic.com/v1',
      timeout: CLAUDE_TIMEOUT_MS,
      headers: {
        'x-api-key': (process.env.CLAUDE_API_KEY ?? '').trim(),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });
  }

  async checkAll(): Promise<void> {
    const user = await this.userRepository.findFirst();
    const symbols: string[] = Array.isArray(user?.symbolsTracking)
      ? (user.symbolsTracking as string[])
      : [];

    if (symbols.length === 0) {
      this.logger.log('SwingSignal: no symbols to check (symbolsTracking empty)');
      return;
    }

    this.logger.log(
      `SwingSignal: starting daily scan for ${symbols.length} symbol(s): ${symbols.join(', ')}`
    );

    for (const symbol of symbols) {
      try {
        await this.analyzeSymbol(symbol);
      } catch (error) {
        this.logger.error(
          `SwingSignal failed for ${symbol}: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
      await sleep(RATE_LIMIT_DELAY_MS);
    }

    this.logger.log('SwingSignal: daily scan complete');
  }

  private async analyzeSymbol(symbol: string): Promise<void> {
    this.logger.log(`SwingSignal: analyzing ${symbol}`);

    // 1. Fetch multi-timeframe candles in parallel
    const [weekly, daily, fourHour] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1w', 150),
      this.marketDataService.getCandles(symbol, '1d', 365),
      this.marketDataService.getCandles(symbol, '4h', 360)
    ]);

    if (daily.length < 30) {
      this.logger.warn(`SwingSignal: insufficient candles for ${symbol}`);
      return;
    }

    // 2. Pre-process (code does all math)
    const processed = preProcess(symbol, weekly, daily, fourHour);

    // 3. Build user prompt
    const userPrompt = buildSwingSignalPrompt(processed);

    // 4. Call Claude
    const rawText = await this.callClaude(userPrompt);
    if (!rawText) {
      this.logger.warn(`SwingSignal: empty Claude response for ${symbol}`);
      return;
    }

    // 5. Parse JSON
    const analysis = parseAiResponse(rawText);
    if (!analysis) {
      this.logger.warn(`SwingSignal: failed to parse AI response for ${symbol}`);
      return;
    }

    // 6. Validate
    const validated = validateAnalysis(analysis, processed.currentPrice);

    this.logger.log(
      `SwingSignal: ${symbol} → ${validated.recommendation} (${validated.buy_setups.length} valid setups)`
    );

    // 7. Send if actionable
    if (validated.recommendation !== 'SKIP' && validated.buy_setups.length > 0) {
      const message = formatSwingSignalBreakoutMessage(validated);
      await this.sendTelegram(symbol, message);
    }
  }

  private async callClaude(userPrompt: string): Promise<string | null> {
    try {
      const response = await this.claudeClient.post<{
        content?: Array<{ type?: string; text?: string }>;
      }>('/messages', {
        model: resolveModel(),
        max_tokens: 4000,
        temperature: 0.2,
        system: [
          {
            type: 'text',
            text: SWING_SIGNAL_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [{ role: 'user', content: userPrompt }]
      });

      return (
        response.data.content?.find((block) => block.type === 'text')?.text?.trim() ?? null
      );
    } catch (error) {
      const candidate = error as {
        response?: { status?: number; data?: unknown };
        message?: string;
      };
      const status = candidate.response?.status;
      const details = candidate.response?.data
        ? `: ${JSON.stringify(candidate.response.data)}`
        : '';
      this.logger.warn(
        `SwingSignal: Claude API error${status ? ` HTTP ${status}` : ''}${details || ` — ${candidate.message ?? 'unknown'}`}`
      );
      return null;
    }
  }

  private async sendTelegram(symbol: string, message: string): Promise<void> {
    try {
      await this.telegramService.sendAnalysisMessage({
        content: message,
        messageType: 'swing-signal'
      });
      this.logger.log(`SwingSignal: signal sent for ${symbol}`);
    } catch (error) {
      this.logger.warn(
        `SwingSignal: Telegram send failed for ${symbol}: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  // Exposed for manual trigger / testing
  async analyzeOne(symbol: string): Promise<SwingSignalAiResponse | null> {
    const [weekly, daily, fourHour] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1w', 150),
      this.marketDataService.getCandles(symbol, '1d', 365),
      this.marketDataService.getCandles(symbol, '4h', 360)
    ]);

    if (daily.length < 30) return null;

    const processed = preProcess(symbol, weekly, daily, fourHour);
    const userPrompt = buildSwingSignalPrompt(processed);
    const rawText = await this.callClaude(userPrompt);
    if (!rawText) return null;

    const analysis = parseAiResponse(rawText);
    if (!analysis) return null;

    return validateAnalysis(analysis, processed.currentPrice);
  }
}
