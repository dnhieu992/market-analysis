import { SettingsService } from '../src/modules/settings/settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let mockRepo: { findFirst: jest.Mock; upsert: jest.Mock };

  beforeEach(() => {
    mockRepo = { findFirst: jest.fn(), upsert: jest.fn() };
    service = new SettingsService(mockRepo as never);
  });

  describe('get', () => {
    it('returns null when no settings record exists', async () => {
      mockRepo.findFirst.mockResolvedValue(null);
      expect(await service.get()).toBeNull();
    });

    it('returns mapped record with trackingSymbols as string array', async () => {
      mockRepo.findFirst.mockResolvedValue({
        id: 'singleton',
        name: 'My Watchlist',
        trackingSymbols: ['BTCUSDT', 'ETHUSDT'],
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01')
      });
      const result = await service.get();
      expect(result?.name).toBe('My Watchlist');
      expect(result?.trackingSymbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    });

    it('returns empty array when trackingSymbols is not an array', async () => {
      mockRepo.findFirst.mockResolvedValue({
        id: 'singleton',
        name: 'X',
        trackingSymbols: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      const result = await service.get();
      expect(result?.trackingSymbols).toEqual([]);
    });
  });

  describe('upsert', () => {
    it('returns the upserted record with correct fields', async () => {
      mockRepo.upsert.mockResolvedValue({
        id: 'singleton',
        name: 'Updated',
        trackingSymbols: ['BTCUSDT'],
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02')
      });
      const result = await service.upsert({ name: 'Updated', trackingSymbols: ['BTCUSDT'] });
      expect(result.name).toBe('Updated');
      expect(result.trackingSymbols).toEqual(['BTCUSDT']);
    });

    it('calls repo.upsert with the provided data', async () => {
      mockRepo.upsert.mockResolvedValue({
        id: 'singleton',
        name: 'Test',
        trackingSymbols: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await service.upsert({ name: 'Test', trackingSymbols: [] });
      expect(mockRepo.upsert).toHaveBeenCalledWith({ name: 'Test', trackingSymbols: [] });
    });

    it('returns empty array when repository returns trackingSymbols as null', async () => {
      mockRepo.upsert.mockResolvedValue({
        id: 'singleton',
        name: 'Test',
        trackingSymbols: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      const result = await service.upsert({ name: 'Test', trackingSymbols: [] });
      expect(result.trackingSymbols).toEqual([]);
    });
  });
});
