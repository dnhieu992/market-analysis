import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export function createUserRepository(client = prisma) {
  return {
    create(data: Prisma.UserCreateInput) {
      return client.user.create({ data });
    },
    findByEmail(email: string) {
      return client.user.findUnique({ where: { email } });
    },
    findById(id: string) {
      return client.user.findUnique({ where: { id } });
    },
    findFirst() {
      return client.user.findFirst();
    },
    updateSymbolsTracking(userId: string, symbols: string[]) {
      return client.user.update({
        where: { id: userId },
        data: { symbolsTracking: symbols },
      });
    },
    updateProfile(userId: string, data: Prisma.UserUpdateInput) {
      return client.user.update({ where: { id: userId }, data });
    },
    setPassword(userId: string, passwordHash: string, mustChangePassword: boolean, changedAt: Date) {
      return client.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword, passwordChangedAt: changedAt }
      });
    },
    enableTotp(userId: string, totpSecretEnc: string, enabledAt: Date, lastStep: number) {
      return client.user.update({
        where: { id: userId },
        data: { totpSecretEnc, totpEnabledAt: enabledAt, totpLastStep: lastStep }
      });
    },
    /**
     * Records `step` as the last accepted TOTP step — only if it is newer, so two
     * racing requests can't both spend the same code. Returns whether it won.
     */
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      const result = await client.user.updateMany({
        where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step }
      });
      return result.count === 1;
    },
    clearTotp(userId: string) {
      return client.user.update({
        where: { id: userId },
        data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null }
      });
    },
    list() {
      return client.user.findMany({ orderBy: { createdAt: 'asc' } });
    },
  };
}
