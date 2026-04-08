import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { DailyAnalysisController } from '../src/modules/daily-analysis/daily-analysis.controller';
import { DailyAnalysisService } from '../src/modules/daily-analysis/daily-analysis.service';

const publishedPlan = {
  summary: 'BTCUSDT đang ở trạng thái chờ breakout xác nhận.',
  bias: 'Neutral',
  confidence: 38,
  status: 'WAIT',
  timeframeContext: {
    biasFrame: 'D1',
    setupFrame: 'H4',
    entryRefinementFrame: 'none',
    higherTimeframeView: 'D1 bullish nhưng H4 chưa confirm.',
    setupTimeframeView: 'H4 đang bearish và cần xác nhận.',
    alignment: 'conflicting'
  },
  marketState: {
    trendCondition: 'compressed',
    volumeCondition: 'very_weak',
    volatilityCondition: 'normal',
    keyObservation: 'Giá nén chặt, volume yếu, chưa có kèo đẹp.'
  },
  setupType: 'breakout',
  noTradeZone: 'Tránh vào khi H4 còn nằm trong biên nén.',
  primarySetup: {
    direction: 'long',
    trigger: 'H4 close trên 68408.37 kèm volume tốt.',
    entry: 'Chờ xác nhận rồi mới cân nhắc vào.',
    stopLoss: 'Dưới 68153.',
    takeProfit1: '68698.7',
    takeProfit2: '69310',
    riskReward: '1:2',
    invalidation: 'H4 close dưới 68153.'
  },
  secondarySetup: {
    direction: 'none',
    trigger: 'Chưa có setup phụ.',
    entry: 'Đứng ngoài.',
    stopLoss: 'N/A',
    takeProfit1: 'N/A',
    takeProfit2: 'N/A',
    riskReward: 'N/A',
    invalidation: 'N/A'
  },
  finalAction: 'Đứng ngoài cho tới khi breakout được xác nhận.',
  reasoning: [
    'D1 bullish nhưng H4 chưa xác nhận breakout.',
    'Draft hợp lý nhưng cần giữ trạng thái WAIT vì volume yếu.'
  ],
  atrConsistencyCheck: {
    result: 'WARNING',
    details: 'ATR phù hợp breakout nhưng chưa có xác nhận.'
  },
  logicConsistencyCheck: {
    result: 'PASS',
    details: 'Bias và hành động tạm thời còn nhất quán.'
  }
} as const;

const mockRecord = {
  id: 'daily-1',
  symbol: 'BTCUSDT',
  date: new Date('2026-04-05'),
  status: 'WAIT',
  d1Trend: 'bullish',
  h4Trend: 'bearish',
  d1S1: 81000,
  d1S2: 78500,
  d1R1: 85200,
  d1R2: 88500,
  h4S1: 82000,
  h4S2: 80400,
  h4R1: 83200,
  h4R2: 84100,
  aiOutput: publishedPlan,
  llmProvider: 'claude',
  llmModel: 'claude-3-7-sonnet-latest',
  pipelineDebugJson: '{"hardCheckResult":{"valid":true}}',
  aiOutputJson: JSON.stringify(publishedPlan),
  summary: '📅 BTCUSDT Daily Plan — 2026-04-05',
  createdAt: new Date()
};

describe('daily-analysis module', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists daily analysis records for a symbol', async () => {
    const service = app.get(DailyAnalysisService);
    const controller = app.get(DailyAnalysisController);

    jest.spyOn(service, 'list').mockResolvedValue([mockRecord as never]);

    await expect(controller.list({ symbol: 'BTCUSDT' })).resolves.toHaveLength(1);
  });

  it('returns latest daily analysis for a symbol', async () => {
    const service = app.get(DailyAnalysisService);
    const controller = app.get(DailyAnalysisController);

    jest.spyOn(service, 'getLatest').mockResolvedValue(mockRecord as never);

    await expect(controller.getLatest('BTCUSDT')).resolves.toMatchObject({
      symbol: 'BTCUSDT',
      status: 'WAIT',
      aiOutput: expect.objectContaining({
        bias: 'Neutral',
        status: 'WAIT'
      })
    });
  });
});
