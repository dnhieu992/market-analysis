import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BackTestService } from '../src/modules/back-test/back-test.service';
import { BackTestEngineService } from '../src/modules/back-test/back-test-engine.service';
import { StrategyRegistryService } from '../src/modules/back-test/strategy-registry.service';
import type { IBackTestStrategy } from '../src/modules/back-test/strategies/strategy.interface';
import type { BackTestSummary } from '../src/modules/back-test/types/back-test.types';
import type { Candle } from '@app/core';

function makeCandle(close: number): Candle {
  return {
    open: close - 5,
    high: close + 10,
    low: close - 10,
    close,
    volume: 1000,
    openTime: new Date('2024-01-01'),
    closeTime: new Date('2024-01-01')
  };
}

const mockStrategy: IBackTestStrategy = {
  name: 'ema-crossover',
  description: 'Test strategy',
  defaultTimeframe: '4h',
  evaluate: () => null
};

const mockSummary: BackTestSummary = {
  totalTrades: 5,
  wins: 3,
  losses: 2,
  winRate: 0.6,
  totalPnl: 500,
  maxDrawdown: 0.1,
  sharpeRatio: 1.2,
  trades: []
};

describe('BackTestService', () => {
  let service: BackTestService;
  let mockRegistry: jest.Mocked<Pick<StrategyRegistryService, 'listStrategies' | 'getStrategy'>>;
  let mockEngine: jest.Mocked<Pick<BackTestEngineService, 'run'>>;
  let mockMarketData: { getCandlesInRange: jest.Mock };
  let mockRepository: { create: jest.Mock; findById: jest.Mock; listByStrategy: jest.Mock; listLatest: jest.Mock; deleteById: jest.Mock };

  beforeEach(() => {
    mockRegistry = {
      listStrategies: jest.fn().mockReturnValue([{ name: 'ema-crossover', description: 'Test', defaultTimeframe: '4h' }]),
      getStrategy: jest.fn().mockReturnValue(mockStrategy)
    };

    mockEngine = {
      run: jest.fn().mockReturnValue(mockSummary)
    };

    mockMarketData = {
      getCandlesInRange: jest.fn().mockResolvedValue([makeCandle(100), makeCandle(110)])
    };

    mockRepository = {
      create: jest.fn().mockResolvedValue({ id: 'result-1', ...mockSummary }),
      findById: jest.fn(),
      listByStrategy: jest.fn().mockResolvedValue([]),
      listLatest: jest.fn().mockResolvedValue([]),
      deleteById: jest.fn().mockResolvedValue(undefined)
    };

    service = new BackTestService(
      mockRegistry as never,
      mockEngine as never,
      mockMarketData as never,
      mockRepository as never
    );
  });

  describe('listStrategies', () => {
    it('delegates to the strategy registry', () => {
      const result = service.listStrategies();
      expect(mockRegistry.listStrategies).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ name: 'ema-crossover', description: 'Test', defaultTimeframe: '4h' }]);
    });
  });

  describe('runBackTest', () => {
    const validDto = {
      strategy: 'ema-crossover',
      symbol: 'BTCUSDT',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-12-31T00:00:00.000Z'
    };

    it('returns summary with id and input params on success', async () => {
      const result = await service.runBackTest(validDto);

      expect(result.id).toBe('result-1');
      expect(result.strategy).toBe('ema-crossover');
      expect(result.symbol).toBe('BTCUSDT');
      expect(result.totalTrades).toBe(5);
      expect(result.winRate).toBe(0.6);
    });

    it('throws NotFoundException when strategy is not found', async () => {
      mockRegistry.getStrategy.mockReturnValue(undefined);

      await expect(service.runBackTest(validDto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when fewer than 2 candles are returned', async () => {
      mockMarketData.getCandlesInRange.mockResolvedValue([makeCandle(100)]);

      await expect(service.runBackTest(validDto)).rejects.toThrow(BadRequestException);
    });

    it('uses strategy defaultTimeframe when timeframe is not provided', async () => {
      await service.runBackTest(validDto);

      expect(mockMarketData.getCandlesInRange).toHaveBeenCalledWith(
        'BTCUSDT',
        '4h',
        new Date(validDto.from),
        new Date(validDto.to)
      );
    });

    it('uses provided timeframe over strategy default', async () => {
      await service.runBackTest({ ...validDto, timeframe: '1h' });

      expect(mockMarketData.getCandlesInRange).toHaveBeenCalledWith(
        'BTCUSDT',
        '1h',
        expect.any(Date),
        expect.any(Date)
      );
    });

    it('persists result to repository after successful run', async () => {
      await service.runBackTest(validDto);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'ema-crossover',
          symbol: 'BTCUSDT',
          totalTrades: 5,
          winRate: 0.6,
          status: 'completed'
        })
      );
    });

    it('calls engine.run with the fetched candles and strategy', async () => {
      const candles = [makeCandle(100), makeCandle(110)];
      mockMarketData.getCandlesInRange.mockResolvedValue(candles);

      await service.runBackTest(validDto);

      expect(mockEngine.run).toHaveBeenCalledWith(mockStrategy, candles, 'BTCUSDT');
    });
  });

  describe('listResults', () => {
    it('calls listByStrategy when strategy filter is provided', async () => {
      await service.listResults('ema-crossover', 'BTCUSDT');

      expect(mockRepository.listByStrategy).toHaveBeenCalledWith('ema-crossover', 'BTCUSDT');
      expect(mockRepository.listLatest).not.toHaveBeenCalled();
    });

    it('calls listLatest when no strategy filter is provided', async () => {
      await service.listResults();

      expect(mockRepository.listLatest).toHaveBeenCalledTimes(1);
      expect(mockRepository.listByStrategy).not.toHaveBeenCalled();
    });
  });

  describe('getResult', () => {
    it('returns the record with parsed trades when found', async () => {
      const trades = [{ entryPrice: 100, exitPrice: 120 }];
      const record = { id: 'result-1', strategy: 'ema-crossover', tradesJson: JSON.stringify(trades) };
      mockRepository.findById.mockResolvedValue(record);

      const result = await service.getResult('result-1');
      expect(result).toMatchObject({ id: 'result-1', strategy: 'ema-crossover' });
      expect(result.trades).toEqual(trades);
    });

    it('returns empty trades array when tradesJson is missing', async () => {
      const record = { id: 'result-1', strategy: 'ema-crossover' };
      mockRepository.findById.mockResolvedValue(record);

      const result = await service.getResult('result-1');
      expect(result.trades).toEqual([]);
    });

    it('throws NotFoundException when record is not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.getResult('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteResult', () => {
    it('deletes the record when found', async () => {
      mockRepository.findById.mockResolvedValue({ id: 'result-1', strategy: 'ema-crossover' });

      await service.deleteResult('result-1');

      expect(mockRepository.deleteById).toHaveBeenCalledWith('result-1');
    });

    it('throws NotFoundException when record is not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.deleteResult('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
