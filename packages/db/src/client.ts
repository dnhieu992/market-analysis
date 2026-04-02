import { PrismaClient } from '@prisma/client';

declare global {
  var __appPrismaClient__: PrismaClient | undefined;
}

export const prisma = globalThis.__appPrismaClient__ ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__appPrismaClient__ = prisma;
}
