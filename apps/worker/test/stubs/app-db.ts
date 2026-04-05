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
