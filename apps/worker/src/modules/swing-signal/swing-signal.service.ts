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
  validateAnalysisWithDetails,
  type SwingSignalAiResponse
} from './swing-signal-validator';
import { formatSwingSignalBreakoutMessage } from './swing-signal-formatter';

const CLAUDE_TIMEOUT_MS = 90_000;
const RATE_LIMIT_DELAY_MS = 1_500;

export type SymbolScanResult = {
  symbol: string;
  recommendation: string;
  validSetupCount: number;
  signalSent: boolean;
  summary: string;
  error?: string;
};

export type SwingScanSummary = {
  total: number;
  signals: number;
  skipped: number;
  errors: number;
  sentSymbols: string[];
  symbolResults: SymbolScanResult[];
};

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

  async checkAll(): Promise<SwingScanSummary> {
    const user = await this.userRepository.findFirst();
    const symbols: string[] = Array.isArray(user?.symbolsTracking)
      ? (user.symbolsTracking as string[])
      : [];

    const summary: SwingScanSummary = {
      total: symbols.length,
      signals: 0,
      skipped: 0,
      errors: 0,
      sentSymbols: [],
      symbolResults: []
    };

    if (symbols.length === 0) {
      this.logger.log('SwingSignal: no symbols to check (symbolsTracking empty)');
      return summary;
    }

    this.logger.log(
      `SwingSignal: starting daily scan for ${symbols.length} symbol(s): ${symbols.join(', ')}`
    );

    for (const symbol of symbols) {
      try {
        const result = await this.analyzeSymbol(symbol);
        if (result) {
          summary.symbolResults.push(result);
          if (result.signalSent) {
            summary.signals++;
            summary.sentSymbols.push(symbol);
          } else {
            summary.skipped++;
          }
        } else {
          summary.errors++;
          summary.symbolResults.push({
            symbol,
            recommendation: 'ERROR',
            validSetupCount: 0,
            signalSent: false,
            summary: 'Pipeline failed (API, candles, or parse error)',
            error: 'See server logs for details'
          });
        }
      } catch (error) {
        summary.errors++;
        const msg = error instanceof Error ? error.message : 'unknown error';
        this.logger.error(`SwingSignal failed for ${symbol}: ${msg}`);
        summary.symbolResults.push({
          symbol,
          recommendation: 'ERROR',
          validSetupCount: 0,
          signalSent: false,
          summary: msg,
          error: msg
        });
      }
      await sleep(RATE_LIMIT_DELAY_MS);
    }

    this.logger.log(
      `SwingSignal: scan complete — ${summary.signals} signal(s), ${summary.skipped} skipped, ${summary.errors} error(s)`
    );
    return summary;
  }

  private async analyzeSymbol(symbol: string): Promise<SymbolScanResult | null> {
    this.logger.log(`SwingSignal: analyzing ${symbol}`);

    // 1. Fetch multi-timeframe candles in parallel
    const [weekly, daily, fourHour] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1w', 150),
      this.marketDataService.getCandles(symbol, '1d', 365),
      this.marketDataService.getCandles(symbol, '4h', 360)
    ]);

    if (daily.length < 30) {
      this.logger.warn(`SwingSignal: insufficient candles for ${symbol}`);
      return null;
    }

    // 2. Pre-process (code does all math)
    const processed = preProcess(symbol, weekly, daily, fourHour);

    // 3. Build user prompt
    const userPrompt = buildSwingSignalPrompt(processed);

    // 4. Call Claude
    const rawText = await this.callClaude(userPrompt);
    if (!rawText) {
      this.logger.warn(`SwingSignal: empty Claude response for ${symbol}`);
      return null;
    }

    // 5. Parse JSON
    const analysis = parseAiResponse(rawText);
    if (!analysis) {
      this.logger.warn(`SwingSignal: failed to parse AI response for ${symbol}`);
      return null;
    }

    // 6. Validate
    const validated = validateAnalysis(analysis, processed.currentPrice);

    this.logger.log(
      `SwingSignal: ${symbol} → ${validated.recommendation} (${validated.buy_setups.length} valid setups)`
    );

    // 7. Send if actionable
    let signalSent = false;
    if (validated.recommendation !== 'SKIP' && validated.buy_setups.length > 0) {
      const message = formatSwingSignalBreakoutMessage(validated);
      await this.sendTelegram(symbol, message);
      signalSent = true;
    }

    return {
      symbol,
      recommendation: validated.recommendation,
      validSetupCount: validated.buy_setups.length,
      signalSent,
      summary: validated.summary
    };
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

  // Debug: full pipeline transparency for a single symbol
  async debugSymbol(symbol: string): Promise<SymbolDebugResult> {
    const [weekly, daily, fourHour] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1w', 150),
      this.marketDataService.getCandles(symbol, '1d', 365),
      this.marketDataService.getCandles(symbol, '4h', 360)
    ]);

    if (daily.length < 30) {
      return { stage: 'insufficient_candles', symbol };
    }

    const processed = preProcess(symbol, weekly, daily, fourHour);
    const userPrompt = buildSwingSignalPrompt(processed);
    const rawText = await this.callClaude(userPrompt);

    if (!rawText) {
      return { stage: 'api_failed', symbol };
    }

    const analysis = parseAiResponse(rawText);
    if (!analysis) {
      return { stage: 'parse_failed', symbol, rawSnippet: rawText.slice(0, 200) };
    }

    const { analysis: validated, rawSetupCount, rejections } = validateAnalysisWithDetails(
      analysis,
      processed.currentPrice
    );

    return {
      stage: 'validated',
      symbol,
      currentPrice: processed.currentPrice,
      recommendation: validated.recommendation,
      overallAssessment: validated.overall_assessment,
      trendAlignment: validated.trend_alignment,
      patternsCount: validated.patterns_detected.length,
      rawSetupCount,
      validSetupCount: validated.buy_setups.length,
      rejections,
      summary: validated.summary
    };
  }
}

export type SymbolDebugResult =
  | { stage: 'insufficient_candles'; symbol: string }
  | { stage: 'api_failed'; symbol: string }
  | { stage: 'parse_failed'; symbol: string; rawSnippet: string }
  | {
      stage: 'validated';
      symbol: string;
      currentPrice: number;
      recommendation: string;
      overallAssessment: string;
      trendAlignment: { weekly: string; daily: string; fourHour: string; aligned: boolean };
      patternsCount: number;
      rawSetupCount: number;
      validSetupCount: number;
      rejections: string[];
      summary: string;
    };
