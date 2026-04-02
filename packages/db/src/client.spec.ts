import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createAnalysisRunRepository,
  createOrderRepository,
  createSignalRepository,
  createTelegramMessageLogRepository,
  prisma
} from './index';

describe('db package surface', () => {
  it('exports a prisma client instance and repository factories', () => {
    expect(prisma).toBeDefined();
    expect(typeof createAnalysisRunRepository).toBe('function');
    expect(typeof createSignalRepository).toBe('function');
    expect(typeof createOrderRepository).toBe('function');
    expect(typeof createTelegramMessageLogRepository).toBe('function');
  });

  it('defines the required unique candle key and indexes in the schema', () => {
    const schema = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8');

    expect(schema).toContain('@@unique([symbol, timeframe, candleCloseTime])');
    expect(schema).toContain('@@index([symbol, timeframe, candleCloseTime])');
    expect(schema).toContain('@@index([symbol, timeframe, createdAt])');
    expect(schema).toContain('@@index([symbol, status, openedAt])');
    expect(schema).toMatch(/rawIndicatorsJson\s+String\s+@db\.Text/);
    expect(schema).toMatch(/llmInputJson\s+String\s+@db\.Text/);
    expect(schema).toMatch(/llmOutputJson\s+String\s+@db\.Text/);
    expect(schema).toMatch(/summary\s+String\s+@db\.Text/);
    expect(schema).toMatch(/supportLevelsJson\s+String\s+@db\.Text/);
    expect(schema).toMatch(/resistanceLevelsJson\s+String\s+@db\.Text/);
    expect(schema).toMatch(/invalidation\s+String\s+@db\.Text/);
    expect(schema).toMatch(/bullishScenario\s+String\s+@db\.Text/);
    expect(schema).toMatch(/bearishScenario\s+String\s+@db\.Text/);
    expect(schema).toMatch(/note\s+String\?\s+@db\.Text/);
    expect(schema).toMatch(/content\s+String\s+@db\.Text/);
    expect(schema).toMatch(/errorMessage\s+String\?\s+@db\.Text/);
  });
});
