import { prisma } from '../client';

export function createSettingsRepository(client = prisma) {
  return {
    findFirst() {
      return client.settings.findFirst();
    },
    upsert(data: { name: string; trackingSymbols: string[] }) {
      return client.settings.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', name: data.name, trackingSymbols: data.trackingSymbols },
        update: { name: data.name, trackingSymbols: data.trackingSymbols }
      });
    }
  };
}
