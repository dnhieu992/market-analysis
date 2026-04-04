import { formatPriceActionMessage } from '../src/modules/analysis/price-action-signal.formatter';
import type { PriceActionSignal } from '../src/modules/analysis/price-action-signal.service';

describe('formatPriceActionMessage', () => {
  it('formats a BUY signal with all four checks', () => {
    const signal: PriceActionSignal = {
      symbol: 'BTCUSDT',
      timeframe: 'M30',
      direction: 'BUY',
      close: 83450,
      atr: 350,
      trend: 'BULLISH',
      keyLevel: 82820,
      pattern: 'Engulfing',
      bosLevel: 83100,
      stopLoss: 82820,
      target: 84150
    };

    const msg = formatPriceActionMessage(signal);

    expect(msg).toContain('[BTCUSDT PA M30]');
    expect(msg).toContain('BUY Signal');
    expect(msg).toContain('83,450.00');
    expect(msg).toContain('82,820.00');
    expect(msg).toContain('84,150.00');
    expect(msg).toContain('✅ 4h trend: BULLISH');
    expect(msg).toContain('✅ Key level');
    expect(msg).toContain('✅ Pattern: Bullish Engulfing');
    expect(msg).toContain('✅ BOS retest');
    expect(msg).toContain('83,100.00');
  });

  it('formats a SELL signal', () => {
    const signal: PriceActionSignal = {
      symbol: 'ETHUSDT',
      timeframe: 'M30',
      direction: 'SELL',
      close: 3000,
      atr: 80,
      trend: 'BEARISH',
      keyLevel: 3200,
      pattern: 'Pin Bar',
      bosLevel: 3050,
      stopLoss: 3200,
      target: 2840
    };

    const msg = formatPriceActionMessage(signal);

    expect(msg).toContain('[ETHUSDT PA M30]');
    expect(msg).toContain('SELL Signal');
    expect(msg).toContain('✅ 4h trend: BEARISH');
    expect(msg).toContain('✅ Pattern: Bearish Pin Bar');
    expect(msg).toContain('3,200.00');
    expect(msg).toContain('2,840.00');
    expect(msg).toContain('3,000.00');       // Close value
    expect(msg).toContain('SL:');            // SL line present
    expect(msg).toContain('✅ Key level');   // key level check
    expect(msg).toContain('✅ BOS retest'); // BOS check
    expect(msg).not.toContain('No Signal'); // not a no-signal message
  });

  it('formats NO_SIGNAL with checkmarks and crosses', () => {
    const signal: PriceActionSignal = {
      symbol: 'BTCUSDT',
      timeframe: 'M30',
      direction: 'NO_SIGNAL',
      close: 83200,
      atr: 300,
      trend: 'BULLISH',
      keyLevel: 82900,
      pattern: null,
      bosLevel: null
    };

    const msg = formatPriceActionMessage(signal);

    expect(msg).toContain('[BTCUSDT PA M30]');
    expect(msg).toContain('No Signal');
    expect(msg).toContain('✅ 4h trend: BULLISH');
    expect(msg).toContain('✅ Key level');
    expect(msg).toContain('❌ Pattern: none detected');
    expect(msg).toContain('❌ BOS retest: no recent break');
    expect(msg).not.toContain('SL:');
    expect(msg).not.toContain('Target:');
  });

  it('formats NO_SIGNAL when trend is NEUTRAL', () => {
    const signal: PriceActionSignal = {
      symbol: 'BTCUSDT',
      timeframe: 'M30',
      direction: 'NO_SIGNAL',
      close: 83200,
      atr: 300,
      trend: 'NEUTRAL',
      keyLevel: null,
      pattern: null,
      bosLevel: null
    };

    const msg = formatPriceActionMessage(signal);

    expect(msg).toContain('No Signal');
    expect(msg).toContain('❌ 4h trend: NEUTRAL');
  });
});
