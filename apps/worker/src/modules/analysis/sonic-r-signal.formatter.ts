import type { SonicRSignal } from './sonic-r-signal.service';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatSonicRMessage(signal: SonicRSignal): string {
  const header = `[${signal.symbol} ${signal.timeframe}]`;
  const dragon = `Dragon: ${fmt(signal.dragonLow)} – ${fmt(signal.dragonHigh)}`;

  if (signal.direction === 'NEUTRAL') {
    return [
      `${header} ⚪ NEUTRAL`,
      `Close:  ${fmt(signal.close)} USDT`,
      dragon,
      `Price is inside the Dragon`
    ].join('\n');
  }

  const icon = signal.direction === 'BUY' ? '🟢' : '🔴';

  return [
    `${header} ${icon} ${signal.direction} Signal`,
    `Close:  ${fmt(signal.close)} USDT`,
    dragon,
    `ATR:    ${fmt(signal.atr)}`,
    `SL:     ${fmt(signal.stopLoss!)} USDT`,
    `Target: ${fmt(signal.target!)} USDT`
  ].join('\n');
}
