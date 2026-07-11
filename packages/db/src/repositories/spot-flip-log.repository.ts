import { prisma } from '../client';

export function createSpotFlipLogRepository(client = prisma) {
  return {
    // Newest first — the dialog shows the running log top-down.
    findBySymbol(symbol: string) {
      return client.spotFlipLog.findMany({
        where: { symbol },
        orderBy: { createdAt: 'desc' },
      });
    },

    // Append-only: every save is a new timestamped entry.
    add(symbol: string, content: string) {
      return client.spotFlipLog.create({ data: { symbol, content } });
    },

    remove(id: string) {
      return client.spotFlipLog.delete({ where: { id } });
    },
  };
}
