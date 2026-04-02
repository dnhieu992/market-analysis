export function calculateVolumeRatio(volumes: number[], averageWindow = 20): number {
  if (volumes.length === 0) {
    return 0;
  }

  const latest = volumes[volumes.length - 1] ?? 0;
  const history = volumes.slice(-averageWindow);
  const average = history.reduce((sum, value) => sum + value, 0) / history.length;

  if (average === 0) {
    return 0;
  }

  return Number((latest / average).toFixed(6));
}
