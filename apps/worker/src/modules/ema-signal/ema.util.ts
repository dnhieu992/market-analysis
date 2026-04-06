export function calculateEma(prices: number[], period: number): number[] {
  if (prices.length < period) return [];

  const k = 2 / (period + 1);
  const seedValues = prices.slice(0, period);
  const seed = seedValues.reduce((sum, p) => sum + p, 0) / period;
  const result: number[] = [seed];

  for (let i = period; i < prices.length; i++) {
    const lastEma = result[result.length - 1];
    if (lastEma !== undefined) {
      result.push(prices[i]! * k + lastEma * (1 - k));
    }
  }

  return result;
}
