import { prisma } from '../client';

/** 2FA backup codes and trusted (remembered) browsers of a user. */
export function createAuthDeviceRepository(client = prisma) {
  return {
    /** Replaces all of the user's backup codes with `codeHashes`. */
    async replaceBackupCodes(userId: string, codeHashes: string[]) {
      await client.$transaction([
        client.authBackupCode.deleteMany({ where: { userId } }),
        client.authBackupCode.createMany({ data: codeHashes.map((codeHash) => ({ userId, codeHash })) })
      ]);
    },
    /** Burns an unused code. Returns whether a code matched. */
    async useBackupCode(userId: string, codeHash: string, usedAt: Date): Promise<boolean> {
      const result = await client.authBackupCode.updateMany({
        where: { userId, codeHash, usedAt: null },
        data: { usedAt }
      });
      return result.count === 1;
    },
    countUnusedBackupCodes(userId: string) {
      return client.authBackupCode.count({ where: { userId, usedAt: null } });
    },
    deleteBackupCodes(userId: string) {
      return client.authBackupCode.deleteMany({ where: { userId } });
    },

    createTrustedDevice(data: { userId: string; tokenHash: string; userAgent: string | null; ip: string | null; expiresAt: Date }) {
      return client.trustedDevice.create({ data });
    },
    findTrustedDevice(tokenHash: string) {
      return client.trustedDevice.findUnique({ where: { tokenHash } });
    },
    touchTrustedDevice(id: string, lastUsedAt: Date) {
      return client.trustedDevice.update({ where: { id }, data: { lastUsedAt } });
    },
    listTrustedDevices(userId: string, now: Date) {
      return client.trustedDevice.findMany({
        where: { userId, expiresAt: { gt: now } },
        orderBy: { lastUsedAt: 'desc' }
      });
    },
    deleteTrustedDevice(userId: string, id: string) {
      return client.trustedDevice.deleteMany({ where: { id, userId } });
    },
    /** Every trusted device of the user except `keepId` (all of them when it is null). */
    deleteOtherTrustedDevices(userId: string, keepId: string | null) {
      return client.trustedDevice.deleteMany({
        where: keepId ? { userId, id: { not: keepId } } : { userId }
      });
    }
  };
}
