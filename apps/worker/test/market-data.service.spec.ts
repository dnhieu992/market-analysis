import { MarketDataService } from '../src/modules/market/market-data.service';
import { BinanceMarketDataService } from '../src/modules/market/binance-market-data.service';

describe('market data service', () => {
  it('maps Binance klines into internal candle objects', async () => {
    const binanceService = {
      fetchKlines: jest.fn().mockResolvedValue([
        [
          1711958400000,
          '68000.10',
          '68500.00',
          '67550.25',
          '68210.50',
          '1234.56',
          1711972799999
        ]
      ])
    } as unknown as jest.Mocked<BinanceMarketDataService>;

    const service = new MarketDataService(binanceService);
    const candles = await service.getCandles('BTCUSDT', '4h', 1);

    expect(candles).toEqual([
      {
        open: 68000.1,
        high: 68500,
        low: 67550.25,
        close: 68210.5,
        volume: 1234.56,
        openTime: new Date('2024-04-01T08:00:00.000Z'),
        closeTime: new Date('2024-04-01T11:59:59.999Z')
      }
    ]);
  });

  it('retries once before succeeding when the upstream request fails', async () => {
    const binanceService = {
      fetchKlines: jest
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce([
          [1711958400000, '68000', '68500', '67550', '68210', '1234.56', 1711972799999]
        ])
    } as unknown as jest.Mocked<BinanceMarketDataService>;

    const service = new MarketDataService(binanceService);
    const candles = await service.getCandles('BTCUSDT', '4h', 1);

    expect(candles).toHaveLength(1);
    expect(binanceService.fetchKlines).toHaveBeenCalledTimes(2);
  });

  it('surfaces an error after retry exhaustion', async () => {
    const binanceService = {
      fetchKlines: jest.fn().mockRejectedValue(new Error('socket hang up'))
    } as unknown as jest.Mocked<BinanceMarketDataService>;

    const service = new MarketDataService(binanceService);

    await expect(service.getCandles('BTCUSDT', '4h', 1)).rejects.toThrow(
      'Failed to fetch market candles for BTCUSDT after 2 attempts'
    );
  });
});
