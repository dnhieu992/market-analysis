import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createSettingsRepository(client = prisma) {
  return {
    findFirst() {
      return client.settings.findFirst({ where: { id: 'singleton' } });
    },
    upsert(data: Pick<Prisma.SettingsUncheckedCreateInput, 'name' | 'trackingSymbols'>) {
      return client.settings.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', name: data.name, trackingSymbols: data.trackingSymbols },
        update: { name: data.name, trackingSymbols: data.trackingSymbols }
      });
    }
  };
}
