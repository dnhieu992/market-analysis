import { WatchlistService } from '../src/modules/ema-signal/watchlist.service';

describe('WatchlistService', () => {
  let service: WatchlistService;

  beforeEach(() => {
    service = new WatchlistService();
  });

  describe('watch', () => {
    it('returns added when symbol is new for this chat', () => {
      expect(service.watch('BTCUSDT', 'chat-1')).toBe('added');
    });

    it('returns already_watching when same chat watches same symbol again', () => {
      service.watch('BTCUSDT', 'chat-1');
      expect(service.watch('BTCUSDT', 'chat-1')).toBe('already_watching');
    });

    it('returns added when a different chat watches the same symbol', () => {
      service.watch('BTCUSDT', 'chat-1');
      expect(service.watch('BTCUSDT', 'chat-2')).toBe('added');
    });
  });

  describe('unwatch', () => {
    it('returns removed when chat was watching the symbol', () => {
      service.watch('BTCUSDT', 'chat-1');
      expect(service.unwatch('BTCUSDT', 'chat-1')).toBe('removed');
    });

    it('returns not_watching when chat was not watching the symbol', () => {
      expect(service.unwatch('BTCUSDT', 'chat-1')).toBe('not_watching');
    });
  });

  describe('getWatchedSymbols', () => {
    it('returns empty array when nothing is watched', () => {
      expect(service.getWatchedSymbols()).toEqual([]);
    });

    it('returns symbols that have at least one watcher', () => {
      service.watch('BTCUSDT', 'chat-1');
      service.watch('ETHUSDT', 'chat-1');
      expect(service.getWatchedSymbols()).toEqual(expect.arrayContaining(['BTCUSDT', 'ETHUSDT']));
    });

    it('excludes symbols with no remaining watchers', () => {
      service.watch('BTCUSDT', 'chat-1');
      service.unwatch('BTCUSDT', 'chat-1');
      expect(service.getWatchedSymbols()).toEqual([]);
    });
  });

  describe('getChatIds', () => {
    it('returns all chatIds watching a symbol', () => {
      service.watch('BTCUSDT', 'chat-1');
      service.watch('BTCUSDT', 'chat-2');
      expect(service.getChatIds('BTCUSDT')).toEqual(expect.arrayContaining(['chat-1', 'chat-2']));
    });

    it('returns empty array for unwatched symbol', () => {
      expect(service.getChatIds('BTCUSDT')).toEqual([]);
    });
  });

  describe('lastSentCloseTime', () => {
    it('returns 0 for symbol with no history', () => {
      expect(service.getLastSentCloseTime('BTCUSDT')).toBe(0);
    });

    it('returns updated value after updateLastSentCloseTime', () => {
      service.updateLastSentCloseTime('BTCUSDT', 1234567890);
      expect(service.getLastSentCloseTime('BTCUSDT')).toBe(1234567890);
    });
  });
});
