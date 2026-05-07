import { calcUnrealizedPnl, getPageNumbers } from './trades-table';

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

describe('getPageNumbers', () => {
  it('returns all pages when total <= 7', () => {
    expect(getPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('shows ellipsis at end when current page is near start', () => {
    const pages = getPageNumbers(1, 10);
    expect(pages[0]).toBe(1);
    expect(pages).toContain('...');
    expect(pages[pages.length - 1]).toBe(10);
  });

  it('shows ellipsis at start when current page is near end', () => {
    const pages = getPageNumbers(10, 10);
    expect(pages[0]).toBe(1);
    expect(pages).toContain('...');
    expect(pages[pages.length - 1]).toBe(10);
  });
});
