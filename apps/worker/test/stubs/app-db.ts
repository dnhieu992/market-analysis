export const prisma = {};

export function createAnalysisRunRepository() {
  return {
    async create(data: unknown) {
      return data;
    }
  };
}

export function createSignalRepository() {
  return {
    async create(data: unknown) {
      return data;
    }
  };
}

export function createOrderRepository() {
  return {
    async create(data: unknown) {
      return data;
    }
  };
}

export function createTelegramMessageLogRepository() {
  return {
    async create(data: unknown) {
      return data;
    }
  };
}

// Generic no-op repositories — present so the full WorkerModule can be compiled
// in worker-bootstrap.spec without a live DB. Services store these at field-init
// but don't call methods during DI compilation.
function noopRepository() {
  return {} as Record<string, never>;
}

export const createSettingsRepository = noopRepository;
export const createTrackingCoinsRepository = noopRepository;
export const createUserRepository = noopRepository;
export const createBitgetTradeRepository = noopRepository;
export const createBitgetTradeJournalRepository = noopRepository;
export const createBitgetSyncStateRepository = noopRepository;
export const createMexcTradeRepository = noopRepository;
export const createMexcTradeJournalRepository = noopRepository;
export const createMexcSyncStateRepository = noopRepository;
export const createOkxTradeRepository = noopRepository;
export const createOkxTradeJournalRepository = noopRepository;
export const createOkxSyncStateRepository = noopRepository;

export function createDailyAnalysisRepository() {
  return {
    async create(data: unknown) {
      return data;
    },
    async findByDate(_symbol: string, _date: Date) {
      return null;
    },
    async listLatest(_symbol: string) {
      return [];
    }
  };
}
