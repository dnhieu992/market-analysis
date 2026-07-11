/**
 * Manual trigger for the daily spot-flip snapshot.
 *
 * Normally the worker runs this on cron at 00:15 UTC
 * (`SchedulerService.runSpotFlipDaily`). This script runs the *exact same*
 * worker service once against the live DB — useful to seed today's data
 * immediately (e.g. right after a deploy) instead of waiting for the cron.
 *
 * For every active coin on the /spot-flip watchlist it fetches live price +
 * hourly/daily klines, computes the shared spot-flip metrics, and upserts one
 * row per coin per UTC day into `spot_flip_daily`.
 *
 * Usage (needs DATABASE_URL — source the repo .env first):
 *   set -a && source .env && set +a && \
 *   pnpm ts-node --transpile-only --project apps/worker/tsconfig.json \
 *     scripts/run-spot-flip-snapshot.ts
 */
import { BinanceMarketDataService } from '../apps/worker/src/modules/market/binance-market-data.service';
import { SpotFlipDailyService } from '../apps/worker/src/modules/spot-flip-daily/spot-flip-daily.service';

async function main() {
  const binance = new BinanceMarketDataService();
  const service = new SpotFlipDailyService(binance);
  const result = await service.runDaily();
  console.log(`Spot-flip snapshot done — scanned: ${result.scanned}, failed: ${result.failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Snapshot failed:', err);
    process.exit(1);
  });
