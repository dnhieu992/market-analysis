import {
  BtcDaytradeArchiveService,
  dateKeyToDate,
  dateToKey,
  vnDateKey,
} from '../src/modules/deepseek/btc-daytrade-archive.service';
import type { StorageService } from '../src/modules/storage/storage.service';
import type { BtcDaytradeResult } from '../src/modules/deepseek/deepseek.service';

/** R2 off: charts are optional, and the archive must work without them. */
const storageOff = { enabled: false } as unknown as StorageService;

function result(generatedAt: string, direction: 'LONG' | 'SHORT', takeProfits: number[]): BtcDaytradeResult {
  return {
    analysis: `phân tích ${direction}`,
    signal: {
      direction,
      confidence: 'medium',
      entryFrom: 64000,
      entryTo: 64100,
      stopLoss: 63800,
      takeProfits,
      riskRewardModel: 2,
      riskReward: 1.9,
      riskPct: 0.4,
      timeframeBias: { '4h': 'bullish' },
      invalidation: 'đóng nến 15m dưới 63.8k',
      summary: `tóm tắt ${direction}`,
      warnings: [],
    },
    reasoning: null,
    model: 'deepseek-v4-pro',
    generatedAt,
    snapshot: { symbol: 'BTCUSDT', capturedAt: generatedAt, price: 64050, timeframes: [] } as never,
    usage: null,
  };
}

describe('BTC day-trade daily archive', () => {
  describe('Vietnam day key', () => {
    it('files a morning run under that day', () => {
      // 09:00 in Vietnam is 02:00 UTC the same date.
      expect(vnDateKey(new Date('2026-08-18T02:00:00.000Z'))).toBe('2026-08-18');
    });

    it('files a run just after Vietnam midnight under the NEW day', () => {
      // 18:30 UTC is 01:30 the next morning in Vietnam — the case a naive UTC
      // date would file under the previous day.
      expect(vnDateKey(new Date('2026-08-18T18:30:00.000Z'))).toBe('2026-08-19');
    });

    it('round-trips a key through the stored DATE value', () => {
      expect(dateToKey(dateKeyToDate('2026-08-18'))).toBe('2026-08-18');
      expect(dateKeyToDate('2026-08-18').toISOString()).toBe('2026-08-18T00:00:00.000Z');
    });
  });

  describe('one record per day', () => {
    const morning = '2026-08-18T02:00:00.000Z';
    const afterMidnightVn = '2026-08-18T18:30:00.000Z';

    it('overwrites the day on a re-run and counts the runs', async () => {
      const archive = new BtcDaytradeArchiveService(storageOff);

      const first = await archive.save(result(morning, 'LONG', [64500]), null);
      expect(first.date).toBe('2026-08-18');
      expect(first.runCount).toBe(1);

      const second = await archive.save(result(morning, 'SHORT', [63500, 63200]), null);
      expect(second.date).toBe('2026-08-18');
      expect(second.runCount).toBe(2);

      const stored = await archive.findByDate('2026-08-18');
      expect(stored?.signal?.direction).toBe('SHORT');
      expect(stored?.signal?.takeProfits).toEqual([63500, 63200]);
      expect(stored?.signal?.timeframeBias).toEqual({ '4h': 'bullish' });
      // R2 off, so no chart is attached — but the analysis is still logged.
      expect(stored?.chartUrl).toBeNull();
    });

    it('starts a new record after Vietnam midnight, not a new run of the old day', async () => {
      const archive = new BtcDaytradeArchiveService(storageOff);
      await archive.save(result(morning, 'LONG', [64500]), null);

      const next = await archive.save(result(afterMidnightVn, 'LONG', [64900]), null);
      expect(next.date).toBe('2026-08-19');
      expect(next.runCount).toBe(1);

      const history = await archive.history();
      expect(history.map((h) => h.date)).toEqual(['2026-08-19', '2026-08-18']);
    });

    it('returns null for a day that was never analysed', async () => {
      const archive = new BtcDaytradeArchiveService(storageOff);
      expect(await archive.findByDate('2020-01-01')).toBeNull();
    });
  });
});
