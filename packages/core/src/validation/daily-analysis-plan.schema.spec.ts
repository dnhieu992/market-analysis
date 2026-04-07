import { dailyAnalysisPlanSchema } from './daily-analysis-plan.schema';

describe('daily analysis plan schema', () => {
  it('validates a structured daily analysis plan', () => {
    const parsed = dailyAnalysisPlanSchema.parse({
      analysis: 'BTC dang giu xu huong tang nhung H4 can xac nhan tiep dien.',
      bias: 'bullish',
      confidence: 78,
      tradePlan: {
        entryZone: 'Canh mua quanh 82,000-82,400 khi co xac nhan giu gia.',
        stopLoss: 'Dung lo neu dong cua duoi 80,500.',
        takeProfit: 'Chot loi tung phan tai 84,200 va 85,500.',
        invalidation: 'Vo cau truc H4 neu mat 80,500.'
      },
      scenarios: {
        bullishScenario: 'Neu giu duoc 82,000 thi gia co the mo rong len 84,200.',
        bearishScenario: 'Neu mat 82,000 thi gia de lui ve 80,500-79,000.'
      },
      riskNote: 'Khong nen duoi gia khi bien dong tang manh.',
      timeHorizon: 'intraday to 1 day'
    });

    expect(parsed.bias).toBe('bullish');
    expect(parsed.tradePlan.entryZone).toContain('82,000');
  });

  it('rejects malformed structured daily analysis output', () => {
    expect(() =>
      dailyAnalysisPlanSchema.parse({
        bias: 'bullish',
        confidence: 120
      })
    ).toThrow();
  });
});
