/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- jest mocks */
const rows = new Map<string, any>();
let cursor: Date | null = null;
const repo = {
  getCursor: jest.fn(async () => cursor),
  setCursor: jest.fn(async (_id: string, at: Date) => {
    cursor = at;
  }),
  findByDedupeKeys: jest.fn(async (keys: string[]) => [...rows.values()].filter((r) => keys.includes(r.dedupeKey))),
  create: jest.fn(async (data: any) => {
    const row = { id: `n${rows.size + 1}`, readAt: null, telegramSent: false, telegramTries: 0, ...data };
    rows.set(row.id, row);
    return row;
  }),
  refresh: jest.fn(async (id: string, data: any) => Object.assign(rows.get(id), data, { readAt: null, telegramSent: false })),
  markTelegram: jest.fn(async (id: string, r: { sent: boolean }) =>
    Object.assign(rows.get(id), { telegramSent: r.sent, telegramTries: rows.get(id).telegramTries + 1 }),
  ),
  listTelegramPending: jest.fn(async () => [...rows.values()].filter((r) => !r.telegramSent)),
};
jest.mock('@app/db', () => ({ createNotificationRepository: () => repo }));

import { classifyBitgetFill, bitgetOrderKind } from '../src/modules/order-fill-notify/bitget-fill.source';
import { classifyMexcDeal } from '../src/modules/order-fill-notify/mexc-fill.source';
import { formatOrderFill, summarizeOrderFills } from '../src/modules/order-fill-notify/order-fill.format';
import { OrderFillNotifyService } from '../src/modules/order-fill-notify/order-fill-notify.service';
import type { FillSource, PositionSnap, RawFill } from '../src/modules/order-fill-notify/order-fill.types';

const NOW = Date.parse('2026-11-08T10:00:00Z');

function fill(over: Partial<RawFill> = {}): RawFill {
  return {
    id: 't1', orderId: 'o1', symbol: 'AVAXUSDT', side: 'long', action: 'open',
    price: 8.65, size: 2.3, quote: 19.895, profit: 0, fee: -0.004, ts: NOW - 30_000, ...over,
  };
}

function makeSource(fills: RawFill[], positions: PositionSnap[] | null = []) {
  const src: FillSource & { fills: RawFill[] } = {
    exchange: 'bitget',
    fills,
    isConfigured: () => true,
    fetchFills: jest.fn(async () => src.fills),
    fetchOrderMeta: jest.fn(async () => ({ orderType: 'limit', kind: null })),
    fetchPositions: jest.fn(async () => positions),
  };
  return src;
}

function makeService() {
  process.env.TELEGRAM_CHAT_ID = 'chat';
  const telegram = { sendToChat: jest.fn(async (_chatId: string, _text: string) => ({ success: true })) };
  const svc = new OrderFillNotifyService(telegram as any);
  return { svc, telegram };
}

describe('OrderFillNotifyService', () => {
  beforeEach(() => {
    rows.clear();
    cursor = null;
    jest.clearAllMocks();
  });

  it('first run only anchors the cursor — no replay, no Telegram', async () => {
    const { svc, telegram } = makeService();
    const src = makeSource([fill()]);
    await svc.syncExchange(src, NOW);
    expect(cursor?.getTime()).toBe(NOW);
    expect(src.fetchFills).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
    expect(telegram.sendToChat).not.toHaveBeenCalled();
  });

  it('writes one notification per order (fills aggregated) and sends Telegram once', async () => {
    cursor = new Date(NOW - 60_000);
    const { svc, telegram } = makeService();
    const src = makeSource(
      [fill({ id: 't1', size: 1, quote: 8.6, price: 8.6 }), fill({ id: 't2', size: 1, quote: 8.8, price: 8.8 })],
      [{ symbol: 'AVAXUSDT', side: 'long', size: 2, avgPrice: 8.7 }],
    );
    const res = await svc.syncExchange(src, NOW);
    expect(res).toEqual({ created: 1, updated: 0 });
    const row = [...rows.values()][0];
    expect(row.dedupeKey).toBe('bitget:o1');
    expect(row.title).toBe('BG · LONG AVAXUSDT · Mở mới (Limit)');
    expect(row.payload.size).toBe(2);
    expect(row.payload.price).toBeCloseTo(8.7);
    expect(telegram.sendToChat).toHaveBeenCalledTimes(1);
    expect(row.telegramSent).toBe(true);

    // Same fills again (overlap window) → nothing new.
    const again = await svc.syncExchange(src, NOW + 15_000);
    expect(again).toEqual({ created: 0, updated: 0 });
    expect(telegram.sendToChat).toHaveBeenCalledTimes(1);
  });

  it('refreshes the order row when it fills more later ("khớp thêm")', async () => {
    cursor = new Date(NOW - 60_000);
    const { svc, telegram } = makeService();
    const src = makeSource([fill({ id: 't1', size: 1, quote: 8.65 })], [{ symbol: 'AVAXUSDT', side: 'long', size: 1, avgPrice: 8.65 }]);
    await svc.syncExchange(src, NOW);
    src.fills = [fill({ id: 't1', size: 1, quote: 8.65 }), fill({ id: 't2', size: 1, quote: 8.65, ts: NOW + 5_000 })];
    const res = await svc.syncExchange(src, NOW + 15_000);
    expect(res).toEqual({ created: 0, updated: 1 });
    const row = [...rows.values()][0];
    expect(row.payload.size).toBe(2);
    expect(row.payload.revision).toBe(2);
    expect(telegram.sendToChat).toHaveBeenCalledTimes(2);
    expect(telegram.sendToChat.mock.calls[1]?.[1]).toContain('khớp thêm');
    expect(src.fetchOrderMeta).toHaveBeenCalledTimes(1);
  });

  it('a failed Telegram push is retried later', async () => {
    cursor = new Date(NOW - 60_000);
    const { svc, telegram } = makeService();
    telegram.sendToChat.mockResolvedValueOnce({ success: false });
    await svc.syncExchange(makeSource([fill()]), NOW);
    expect([...rows.values()][0].telegramSent).toBe(false);
    await svc.retryTelegram(NOW + 60_000);
    expect(telegram.sendToChat).toHaveBeenCalledTimes(2);
    expect([...rows.values()][0].telegramSent).toBe(true);
  });
});

describe('order-fill formatting', () => {
  it('labels DCA vs new by the position after the fill', () => {
    const pos = [{ symbol: 'AVAXUSDT', side: 'long' as const, size: 4.6, avgPrice: 8.8 }];
    const s = summarizeOrderFills('bitget', [fill()], null, pos);
    expect(s.phase).toBe('dca');
    expect(formatOrderFill(s).body).toContain('Vị thế: 4.6 @ avg 8.8');
  });

  it('shows net PnL on a full close (TP)', () => {
    const s = summarizeOrderFills(
      'mexc',
      [fill({ side: 'short', action: 'close', symbol: 'BTCUSDT', price: 75210.6, size: 0.0006, quote: 45.126, profit: 0.47064, fee: -0.027 })],
      { kind: 'tp', orderType: 'market' },
      [],
    );
    const out = formatOrderFill(s);
    expect(out.title).toBe('MX · SHORT BTCUSDT · Đóng hết (TP · Market)');
    expect(out.body).toContain('PnL ròng +0.44 USDT');
    expect(out.telegram.startsWith('💰')).toBe(true);
  });

  it('unknown phase when positions could not be read', () => {
    const s = summarizeOrderFills('bitget', [fill()], null, null);
    expect(s.phase).toBeNull();
    expect(formatOrderFill(s).title).toBe('BG · LONG AVAXUSDT · Vào lệnh');
  });
});

describe('exchange classification', () => {
  it('Bitget hedge mode: side is the position direction', () => {
    expect(classifyBitgetFill('sell', 'close')).toEqual({ side: 'short', action: 'close' });
    expect(classifyBitgetFill('buy', 'open')).toEqual({ side: 'long', action: 'open' });
    expect(classifyBitgetFill('sell', 'burst_close_long')).toEqual({ side: 'long', action: 'liquidation' });
    expect(classifyBitgetFill('buy', 'buy_single')).toEqual({ side: null, action: 'unknown' });
    expect(bitgetOrderKind('pos_profit_market')).toBe('tp');
    expect(bitgetOrderKind('loss_market')).toBe('sl');
    expect(bitgetOrderKind('normal')).toBeNull();
  });

  it('MEXC deal side codes', () => {
    expect(classifyMexcDeal(1)).toEqual({ side: 'long', action: 'open' });
    expect(classifyMexcDeal(2)).toEqual({ side: 'short', action: 'close' });
    expect(classifyMexcDeal(3)).toEqual({ side: 'short', action: 'open' });
    expect(classifyMexcDeal(4)).toEqual({ side: 'long', action: 'close' });
  });
});
