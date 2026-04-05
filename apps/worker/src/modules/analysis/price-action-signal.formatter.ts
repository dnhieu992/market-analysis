import type { PriceActionSignal } from './price-action-signal.service';
import type { Trend } from '../market/utils/trend';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function trendLabel(trend: Trend): string {
  if (trend === 'bullish') return 'BULLISH (HH+HL)';
  if (trend === 'bearish') return 'BEARISH (LH+LL)';
  return 'NEUTRAL';
}

function patternLabel(pattern: string | null, trend: Trend): string {
  if (!pattern) return '❌ Pattern: none detected';
  const side = trend === 'bullish' ? 'Bullish' : 'Bearish';
  return `✅ Pattern: ${side} ${pattern}`;
}

export function formatPriceActionMessage(signal: PriceActionSignal): string {
  const header = `[${signal.symbol} PA ${signal.timeframe}]`;
  const sep = '━━━━━━━━━━━━━━━━━━━';

  const trendCheck =
    signal.trend === 'neutral'
      ? `❌ 4h trend: NEUTRAL`
      : `✅ 4h trend: ${trendLabel(signal.trend)}`;

  const keyLevelCheck =
    signal.keyLevel !== null
      ? `✅ Key level: ${signal.trend === 'bullish' ? 'support' : 'resistance'} at ${fmt(signal.keyLevel)}`
      : `❌ Key level: none within range`;

  const patternCheck = patternLabel(signal.pattern, signal.trend);

  const bosCheck =
    signal.bosLevel !== null
      ? `✅ BOS retest: broke ${fmt(signal.bosLevel)}, retested`
      : `❌ BOS retest: no recent break`;

  if (signal.direction === 'NO_SIGNAL') {
    return [
      `${header} ⚪ No Signal`,
      sep,
      trendCheck,
      keyLevelCheck,
      patternCheck,
      bosCheck
    ].join('\n');
  }

  const icon = signal.direction === 'BUY' ? '🟢' : '🔴';

  return [
    `${header} ${icon} ${signal.direction} Signal`,
    sep,
    `Close:  ${fmt(signal.close)} USDT`,
    `SL:     ${fmt(signal.stopLoss ?? 0)} USDT  (key ${signal.trend === 'bullish' ? 'support' : 'resistance'})`,
    `Target: ${fmt(signal.target ?? 0)} USDT  (2×ATR)`,
    '',
    trendCheck,
    keyLevelCheck,
    patternCheck,
    bosCheck
  ].join('\n');
}
