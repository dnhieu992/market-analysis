import { matchesSymbolFilter, matchesSourceFilter, calcUnrealizedPnl } from './trades-table';

describe('matchesSymbolFilter', () => {
  it('returns true when filter is empty', () => {
    expect(matchesSymbolFilter('BTCUSDT', '')).toBe(true);
  });

  it('matches exact symbol case-insensitively', () => {
    expect(matchesSymbolFilter('BTCUSDT', 'btcusdt')).toBe(true);
  });

  it('matches partial symbol case-insensitively', () => {
    expect(matchesSymbolFilter('BTCUSDT', 'btc')).toBe(true);
  });

  it('returns false when symbol does not match filter', () => {
    expect(matchesSymbolFilter('ETHUSDT', 'btc')).toBe(false);
  });

  it('matches with mixed case in both symbol and filter', () => {
    expect(matchesSymbolFilter('BTCUSDT', 'BTC')).toBe(true);
  });
});

describe('matchesSourceFilter', () => {
  it('returns true when no sources selected', () => {
    expect(matchesSourceFilter('Binance', new Set())).toBe(true);
  });

  it('returns true when broker is in selected sources', () => {
    expect(matchesSourceFilter('Binance', new Set(['Binance', 'OKX']))).toBe(true);
  });

  it('returns false when broker is not in selected sources', () => {
    expect(matchesSourceFilter('Bybit', new Set(['Binance', 'OKX']))).toBe(false);
  });

  it('returns true for null broker when no sources selected', () => {
    expect(matchesSourceFilter(null, new Set())).toBe(true);
  });

  it('returns false for null broker when sources are selected', () => {
    expect(matchesSourceFilter(null, new Set(['Binance']))).toBe(false);
  });
});

describe('calcUnrealizedPnl', () => {
  it('returns null when quantity is missing', () => {
    expect(calcUnrealizedPnl(100, 110, null, 'long')).toBeNull();
  });

  it('calculates profit for long position when price rises', () => {
    expect(calcUnrealizedPnl(100, 110, 2, 'long')).toBe(20);
  });

  it('calculates loss for long position when price falls', () => {
    expect(calcUnrealizedPnl(100, 90, 2, 'long')).toBe(-20);
  });

  it('calculates profit for short position when price falls', () => {
    expect(calcUnrealizedPnl(100, 90, 2, 'short')).toBe(20);
  });

  it('calculates loss for short position when price rises', () => {
    expect(calcUnrealizedPnl(100, 110, 2, 'short')).toBe(-20);
  });
});
