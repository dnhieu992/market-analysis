export function calculateAtr(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): number {
  if (highs.length === 0 || lows.length === 0 || closes.length === 0) {
    return 0;
  }

  const trueRanges = highs.map((high, index) => {
    const low = lows[index] ?? high;
    const previousClose = closes[index - 1] ?? closes[index] ?? high;
    return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
  });

  const slice = trueRanges.slice(-period);
  const atr = slice.reduce((sum, value) => sum + value, 0) / slice.length;
  return Number(atr.toFixed(6));
}
