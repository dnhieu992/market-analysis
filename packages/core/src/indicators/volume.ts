export function calculateVolumeRatio(volumes: number[], averageWindow = 20): number {
  // Need at least averageWindow previous candles + 1 current candle
  if (volumes.length < averageWindow + 1) {
    return 0;
  }

  // Exclude current (potentially unclosed) candle from the average window
  const latest = volumes[volumes.length - 1] ?? 0;
  const history = volumes.slice(-(averageWindow + 1), -1);
  const average = history.reduce((sum, value) => sum + value, 0) / history.length;

  if (average === 0) {
    return 0;
  }

  return Number((latest / average).toFixed(6));
}
