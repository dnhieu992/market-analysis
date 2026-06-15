import {
  resolveKeyValue,
  OPTIMAL_KEY_VALUE,
  DEFAULT_KEY_VALUE,
} from '../src/modules/swing-trading/utbot-kv-table';

describe('resolveKeyValue', () => {
  it('uses a positive settings.keyValue as an explicit override', () => {
    expect(resolveKeyValue('BNBUSDT', '4h', 2)).toEqual({ keyValue: 2, source: 'settings' });
    // override wins even when a table entry exists (BNB:4h is 4 in the table)
    expect(resolveKeyValue('BNBUSDT', '4h', 1).keyValue).toBe(1);
  });

  it('falls back to the per-symbol/timeframe table when keyValue <= 0 (auto)', () => {
    expect(resolveKeyValue('BNBUSDT', '4h', 0)).toEqual({ keyValue: 4, source: 'table' });
    expect(resolveKeyValue('ETHUSDT', '1d', -1)).toEqual({ keyValue: 1, source: 'table' });
  });

  it('is case/whitespace-insensitive on symbol and timeframe', () => {
    expect(resolveKeyValue(' ethusdt ', ' 4H ', 0)).toEqual({ keyValue: 2, source: 'table' });
  });

  it('uses DEFAULT_KEY_VALUE when auto and no table entry exists', () => {
    expect(resolveKeyValue('DOGEUSDT', '4h', 0)).toEqual({
      keyValue: DEFAULT_KEY_VALUE,
      source: 'default',
    });
  });

  it('every table entry is a positive number', () => {
    for (const [key, kv] of Object.entries(OPTIMAL_KEY_VALUE)) {
      expect(kv).toBeGreaterThan(0);
      expect(key).toMatch(/^[A-Z0-9]+:[0-9a-z]+$/);
    }
  });
});
