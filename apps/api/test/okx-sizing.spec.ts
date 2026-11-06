import { contractsFromMargin, floorToStep, fromInstId, toInstId } from '../src/modules/okx/okx.service';

describe('OKX sizing helpers', () => {
  it('maps symbols to SWAP instrument ids and back', () => {
    expect(toInstId('btc')).toBe('BTC-USDT-SWAP');
    expect(toInstId('ETHUSDT')).toBe('ETH-USDT-SWAP');
    expect(toInstId('SOL-USDT')).toBe('SOL-USDT-SWAP');
    expect(fromInstId('BTC-USDT-SWAP')).toBe('BTCUSDT');
  });

  it('floors to the lot step with the step precision', () => {
    expect(floorToStep(1.239, 0.01)).toBe('1.23');
    expect(floorToStep(7.99, 1)).toBe('7');
    expect(floorToStep(0.3, 0.1)).toBe('0.3');
  });

  it('turns margin × leverage into contracts (ctVal in coin)', () => {
    // $10 × 10 = $100 notional at $100,000, ctVal 0.01 BTC → 0.1 contract, lot 0.01.
    expect(contractsFromMargin(10, 10, 100_000, { ctVal: 0.01, lotSz: 0.01, minSz: 0.01 })).toBe('0.10');
    // $5 × 20 = $100 at $2.5, ctVal 10 → 4 contracts.
    expect(contractsFromMargin(5, 20, 2.5, { ctVal: 10, lotSz: 1, minSz: 1 })).toBe('4');
  });

  it('refuses a margin below the minimum contract size', () => {
    expect(() => contractsFromMargin(1, 1, 100_000, { ctVal: 0.01, lotSz: 0.01, minSz: 0.01 })).toThrow(/Ký quỹ quá nhỏ/);
  });
});
