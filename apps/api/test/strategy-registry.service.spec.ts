import * as fs from 'fs';
import * as path from 'path';
import { StrategyRegistryService } from '../src/modules/back-test/strategy-registry.service';

jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('StrategyRegistryService', () => {
  let service: StrategyRegistryService;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    service = new StrategyRegistryService();
  });

  describe('onModuleInit', () => {
    it('logs a warning when strategies directory does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      const warnSpy = jest.spyOn((service as never as { logger: { warn: jest.Mock } }).logger, 'warn').mockImplementation(() => {});

      service.onModuleInit();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('registers a valid strategy from a file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['ema-crossover.strategy.js'] as never);

      const fakeStrategy = {
        name: 'ema-crossover',
        description: 'Test strategy',
        defaultTimeframe: '4h',
        evaluate: jest.fn()
      };
      const FakeStrategyClass = jest.fn().mockImplementation(() => fakeStrategy);

      jest.doMock(
        path.join((service as never as { strategiesDir: string }).strategiesDir, 'ema-crossover.strategy.js'),
        () => ({ default: FakeStrategyClass }),
        { virtual: true }
      );

      service.onModuleInit();

      const list = service.listStrategies();
      expect(list).toContainEqual({
        name: 'ema-crossover',
        description: 'Test strategy',
        defaultTimeframe: '4h'
      });
    });

    it('skips the strategy.interface file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['strategy.interface.js', 'strategy.interface.ts'] as never);

      service.onModuleInit();

      expect(service.listStrategies()).toHaveLength(0);
    });

    it('skips a file whose export does not have a name property', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['broken.strategy.js'] as never);

      const BrokenClass = jest.fn().mockImplementation(() => ({ evaluate: jest.fn() })); // missing name

      jest.doMock(
        path.join((service as never as { strategiesDir: string }).strategiesDir, 'broken.strategy.js'),
        () => ({ default: BrokenClass }),
        { virtual: true }
      );

      service.onModuleInit();

      expect(service.listStrategies()).toHaveLength(0);
    });
  });

  describe('listStrategies', () => {
    it('returns an empty array before any strategies are loaded', () => {
      expect(service.listStrategies()).toEqual([]);
    });
  });

  describe('getStrategy', () => {
    it('returns undefined for an unknown strategy name', () => {
      expect(service.getStrategy('nonexistent')).toBeUndefined();
    });
  });
});
