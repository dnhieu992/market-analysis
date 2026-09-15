import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load env BEFORE importing anything that reads it (@app/db instantiates Prisma,
// the service reads BINGX_* creds). __dirname = apps/worker/src/scripts → up 4 = repo root.
config({ path: resolve(__dirname, '../../../../.env') });

/**
 * One-off BingX backfill: pull TODAY's (00:00 UTC → now) closed trades AND the
 * currently-open positions into the Order table (source='bingx'), so /trades
 * reflects the account. The scheduled sync only reads live positions and, on its
 * first run, baselines-out whatever was already open — hence nothing showed.
 *
 * Run:  pnpm --filter worker exec ts-node src/scripts/bingx-backfill.ts
 */
async function main() {
  const { prisma } = await import('@app/db');
  const { BingxHistoryService } = await import('../modules/bingx-history/bingx-history.service');

  const svc = new BingxHistoryService();
  if (!svc.isConfigured()) {
    console.error('BingX credentials not configured (BINGX_API_KEY / BINGX_API_SECRET).');
    process.exit(1);
  }

  const now = new Date();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);
  console.log(`[bingx-backfill] window: ${new Date(dayStart).toISOString()} → ${now.toISOString()}`);

  // 1. Re-anchor with an empty baseline so still-open positions are ingested
  //    (and future closes reconciled) instead of being ignored as "pre-existing".
  await svc.resetAnchor(new Date(dayStart));
  console.log('[bingx-backfill] anchor reset (empty baseline).');

  // 2. Backfill positions CLOSED since 00:00 UTC today.
  const closedInserted = await svc.backfillClosedSince(dayStart);
  console.log(`[bingx-backfill] closed orders inserted: ${closedInserted}`);

  // 3. Ingest the currently-open positions via the normal sync path.
  const { opened, closed } = await svc.sync();
  console.log(`[bingx-backfill] sync → opened ${opened}, reconciled-closed ${closed}`);

  await prisma.$disconnect();
  console.log('[bingx-backfill] done.');
}

main().catch((err) => {
  console.error('[bingx-backfill] failed:', err);
  process.exit(1);
});
