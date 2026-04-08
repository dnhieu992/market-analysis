export function resolveTrackedSymbols(rawValue = process.env.TRACKED_SYMBOLS): string[] {
  const symbols = (rawValue ?? 'BTCUSDT')
    .split(',')
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  return symbols.length > 0 ? symbols : ['BTCUSDT'];
}
