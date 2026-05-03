import { matchesSymbolFilter, matchesSourceFilter } from './trades-table';

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
