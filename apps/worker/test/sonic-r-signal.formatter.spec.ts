import { formatSonicRMessage } from '../src/modules/analysis/sonic-r-signal.formatter';
import type { SonicRSignal } from '../src/modules/analysis/sonic-r-signal.service';

describe('formatSonicRMessage', () => {
  it('formats a BUY signal with SL and target', () => {
    const signal: SonicRSignal = {
      symbol: 'BTCUSDT',
      timeframe: 'M30',
      direction: 'BUY',
      close: 83450,
      dragonHigh: 83100,
      dragonLow: 82800,
      atr: 350,
      stopLoss: 83100,
      target: 84150
    };

    const message = formatSonicRMessage(signal);

    expect(message).toContain('[BTCUSDT M30]');
    expect(message).toContain('BUY');
    expect(message).toContain('83,450.00');
    expect(message).toContain('83,100.00');
    expect(message).toContain('82,800.00');
    expect(message).toContain('350.00');
    expect(message).toContain('84,150.00');
  });

  it('formats a SELL signal with SL and target', () => {
    const signal: SonicRSignal = {
      symbol: 'ETHUSDT',
      timeframe: 'M30',
      direction: 'SELL',
      close: 3000,
      dragonHigh: 3200,
      dragonLow: 3100,
      atr: 80,
      stopLoss: 3080,
      target: 2840
    };

    const message = formatSonicRMessage(signal);

    expect(message).toContain('[ETHUSDT M30]');
    expect(message).toContain('SELL');
    expect(message).toContain('3,000.00');
    expect(message).toContain('3,080.00');
    expect(message).toContain('2,840.00');
  });

  it('formats a NEUTRAL signal without SL or target', () => {
    const signal: SonicRSignal = {
      symbol: 'BTCUSDT',
      timeframe: 'M30',
      direction: 'NEUTRAL',
      close: 83200,
      dragonHigh: 83280,
      dragonLow: 83100,
      atr: 200
    };

    const message = formatSonicRMessage(signal);

    expect(message).toContain('[BTCUSDT M30]');
    expect(message).toContain('NEUTRAL');
    expect(message).toContain('inside the Dragon');
    expect(message).not.toContain('SL:');
    expect(message).not.toContain('Target:');
  });
});
