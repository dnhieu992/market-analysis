import axios from 'axios';
import { SwingPaReviewService } from '../src/modules/analysis/swing-pa-review.service';
import type { SwingPaAnalysis } from '../src/modules/analysis/swing-pa-analyzer';
import type { Candle } from '@app/core';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockAnalysis: SwingPaAnalysis = {
  symbol: 'BTCUSDT',
  currentPrice: 84000,
  trend: 'uptrend',
  swingHighs: [80000, 85000],
  swingLows: [75000, 78000],
  consecutiveHhCount: 3,
  consecutiveHlCount: 3,
  srZones: [
    { low: 77500, high: 78500, midpoint: 78000, touches: 3, role: 'support' }
  ],
  choch: { detected: false, from: 'uptrend', to: 'uptrend', brokenLevel: null },
  setup: {
    type: null, entryType: 'market', direction: null, confidence: 'low',
    limitPrice: null, entryZone: null, stopLoss: null, tp1: null, tp2: null,
    notes: ['No active setup']
  },
  pendingLimitSetups: [],
  avgVolume20: 1000,
  fibPivot: { high: 85000, low: 75000 },
  fibLevels: [],
  weeklyTrend: 'uptrend',
  invalidationLevel: 77900
};

const mockCandles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
  open: 80000 + i * 100,
  high: 80500 + i * 100,
  low: 79500 + i * 100,
  close: 80200 + i * 100,
  volume: 1000,
  openTime: new Date(`2026-01-${String(i + 1).padStart(2, '0')}`)
}));

describe('SwingPaReviewService', () => {
  let service: SwingPaReviewService;
  let capturedPostBody: Record<string, unknown> = {};

  beforeEach(() => {
    service = new SwingPaReviewService();
    mockedAxios.create.mockReturnValue({
      post: jest.fn().mockImplementation((_url, body) => {
        capturedPostBody = body as Record<string, unknown>;
        return Promise.resolve({
          data: {
            content: [
              {
                type: 'tool_use',
                name: 'record_swing_pa_review',
                input: {
                  verdict: 'no-trade',
                  trendComment: 'Test',
                  limitSetupReviews: [],
                  warnings: [],
                  summary: 'Test'
                }
              }
            ]
          }
        });
      })
    } as never);
  });

  it('system prompt instructs Claude to review each pendingLimitSetup', async () => {
    await service.review(mockAnalysis, mockCandles);
    const systemPrompt = capturedPostBody['system'] as string;
    expect(systemPrompt).toContain('pendingLimitSetups');
    expect(systemPrompt).toContain('limitSetupReviews');
  });

  it('system prompt instructs Claude to add replacement limit order when all setups skip', async () => {
    await service.review(mockAnalysis, mockCandles);
    const systemPrompt = capturedPostBody['system'] as string;
    expect(systemPrompt).toContain('adjusted');
    expect(systemPrompt).toContain('srZones');
    expect(systemPrompt).toContain('adjustedEntry');
  });
});
