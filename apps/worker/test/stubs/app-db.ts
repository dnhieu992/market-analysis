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

export function createDayTradingRepository() {
  // Day-trading specs construct the services then override `.repo` with a
  // per-test mock, so the default here only needs to exist (no-op shape).
  return {
    async logAction(data: unknown) {
      return data;
    },
  };
}

export function createDcaLadderRepository() {
  // DCA ladder specs construct the service then override `.repo` with a
  // per-test mock, so the default here only needs to exist (no-op shape).
  return {
    async getSettings() { return {}; },
    async getCurrentCycle(_symbol: string) { return null; },
    async getOrdersByCycle(_cycleId: string) { return []; },
    async updateOrder(_id: string, _data: unknown) { return; },
    async updateCycle(_id: string, _data: unknown) { return; },
  };
}

// Generic no-op repositories — present so the full WorkerModule can be compiled
// in worker-bootstrap.spec without a live DB. Services store these at field-init
// but don't call methods during DI compilation.
function noopRepository() {
  return {} as Record<string, never>;
}

export const createSettingsRepository = noopRepository;
export const createTrackedSetupRepository = noopRepository;
export const createTrackingCoinsRepository = noopRepository;
export const createSmallCapRadarRepository = noopRepository;
export const createUserRepository = noopRepository;
export const createLongSignalRepository = noopRepository;

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
