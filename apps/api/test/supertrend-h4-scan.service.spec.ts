import type { Candle } from '@app/core';

import { SupertrendH4ScanService } from '../src/modules/supertrend-scan/supertrend-h4-scan.service';
import type { MarketDataService } from '../src/modules/market/market-data.service';
import type { TelegramService } from '../src/modules/telegram/telegram.service';
import type { TrackingScanSymbolsService } from '../src/modules/supertrend-scan/tracking-scan-symbols.service';

const HOUR_4 = 4 * 60 * 60 * 1000;

/** Closed 4H candles ending in the past, so nothing is dropped as "in progress". */
function candlesFrom(closes: number[]): Candle[] {
  const end = Date.now() - HOUR_4;
  return closes.map((close, i) => {
    const closeTime = new Date(end - (closes.length - 1 - i) * HOUR_4);
    return {
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1000,
      openTime: new Date(closeTime.getTime() - HOUR_4),
      closeTime,
    };
  });
}

function wavyDown(length: number): number[] {
  return Array.from({ length }, (_, i) => 200 - i * 0.5 + Math.sin(i / 3) * 3);
}

/**
 * Climb with pullbacks (so RSI is not pinned at 100) closing on a six-candle
 * push — Supertrend bullish for a while, QQE bullish on the last bar.
 */
function uptrend(length = 260): Candle[] {
  const closes = Array.from(
    { length: Math.max(length - 6, 1) },
    (_, i) => 100 + i * 0.5 + Math.sin(i / 3) * 3
  );
  for (let i = 0; i < 6 && closes.length < length; i++) closes.push(closes[closes.length - 1]! + 5);
  return candlesFrom(closes);
}

/** Steady decline — Supertrend bearish, so it never reaches the QQE check. */
function downtrend(length = 260): Candle[] {
  return candlesFrom(wavyDown(length));
}

/** Long decline, then one candle that closes far above the Supertrend upper band. */
function freshFlip(length = 260): Candle[] {
  const closes = wavyDown(length);
  closes[closes.length - 1] = closes[closes.length - 2]! * 1.35;
  return candlesFrom(closes);
}

type Stubs = {
  service: SupertrendH4ScanService;
  sent: { text: string; parseMode?: string }[];
};

function makeService(
  candlesBySymbol: Record<string, Candle[] | 'throw'>,
  telegramSuccess = true
): Stubs {
  const sent: { text: string; parseMode?: string }[] = [];

  // The scan reads the /tracking-coins watchlist, not the whole exchange.
  const scanSymbols = {
    list: async () =>
      Object.keys(candlesBySymbol).map((symbol) => ({
        symbol,
        baseAsset: symbol.replace('USDT', ''),
      })),
  } as unknown as TrackingScanSymbolsService;

  const marketDataService = {
    getCandles: async (symbol: string) => {
      const entry = candlesBySymbol[symbol];
      if (entry === 'throw' || entry === undefined) throw new Error('klines failed');
      return entry;
    },
  } as unknown as MarketDataService;

  const telegramService = {
    sendMessage: async (text: string, options?: { parseMode?: 'HTML' | 'Markdown' }) => {
      sent.push({ text, parseMode: options?.parseMode });
      return { success: telegramSuccess };
    },
  } as unknown as TelegramService;

  return {
    service: new SupertrendH4ScanService(marketDataService, telegramService, scanSymbols),
    sent,
  };
}

describe('SupertrendH4ScanService', () => {
  it('reports each indicator on its own and the intersection separately', async () => {
    const { service, sent } = makeService({ AAAUSDT: uptrend(), BBBUSDT: downtrend() });

    const result = await service.scan('manual');

    expect(result.scanned).toBe(2);
    expect(result.supertrendBullish).toEqual(['AAA']);
    expect(result.bullish).toEqual(['AAA']);
    expect(result.flipped).toEqual([]);
    // The steady decline is bearish on both, so it appears in no list.
    expect(result.qqeBullish).toEqual(['AAA']);

    const text = sent[0]!.text;
    expect(text).toContain('SUPERTREND(10,3) BULLISH (1)');
    expect(text).toContain('QQE BULLISH (1)');
    expect(text).toContain('CẢ HAI (1)');
  });

  it('flags a Supertrend that flipped bearish → bullish on the last closed candle', async () => {
    const { service, sent } = makeService({ AAAUSDT: uptrend(), FLIPUSDT: freshFlip() });

    const result = await service.scan('manual');

    expect(result.flipped).toEqual(['FLIP']);
    expect(result.supertrendBullish).toEqual(['AAA', 'FLIP']);
    expect(result.bullish).toEqual(['AAA', 'FLIP']);
    // Flips go out in bold, holders in plain text.
    expect(sent[0]!.parseMode).toBe('HTML');
    expect(sent[0]!.text).toContain('<b>FLIP</b>');
    expect(sent[0]!.text).toContain('\nAAA');
  });

  it('skips coins with too little history and counts unfetchable ones as failed', async () => {
    const { service } = makeService({
      AAAUSDT: uptrend(),
      NEWUSDT: uptrend(50),
      DEADUSDT: 'throw',
    });

    const result = await service.scan('manual');

    expect(result.scanned).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.bullish).toEqual(['AAA']);
  });

  it('reports a Telegram failure without throwing', async () => {
    const { service } = makeService({ AAAUSDT: uptrend() }, false);

    const result = await service.scan('scheduled');

    expect(result.telegramSent).toBe(false);
    expect(result.bullish).toEqual(['AAA']);
  });

  it('keeps every section present when nothing is bullish', async () => {
    const { service, sent } = makeService({ BBBUSDT: downtrend() });

    const result = await service.scan('manual');

    expect(result.supertrendBullish).toEqual([]);
    expect(result.qqeBullish).toEqual([]);
    expect(result.bullish).toEqual([]);
    const text = sent[0]!.text;
    expect(text).toContain('SUPERTREND(10,3) BULLISH (0)');
    expect(text).toContain('QQE BULLISH (0)');
    expect(text).toContain('CẢ HAI (0)');
    expect(text.match(/Không có coin nào\./g)).toHaveLength(3);
  });

  it('refuses a second scan while one is in flight', async () => {
    const { service } = makeService({ AAAUSDT: uptrend() });

    const first = service.scan('scheduled');
    await expect(service.scan('manual')).rejects.toThrow(/already running/i);
    await first;
  });
});
