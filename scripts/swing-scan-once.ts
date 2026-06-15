/**
 * One-off manual trigger of the swing-trading scan (proves the worker pipeline:
 * Bitget fetch → UTBot eval → DB write). Same code path the cron uses.
 *
 *   set -a && source .env && set +a && \
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/worker/tsconfig.json scripts/swing-scan-once.ts
 */
import 'reflect-metadata';
import { SwingBitgetService } from '../apps/worker/src/modules/swing-trading/bitget.service';
import { UtBotStrategyService } from '../apps/worker/src/modules/swing-trading/utbot-strategy.service';
import { SwingExecutorService } from '../apps/worker/src/modules/swing-trading/swing-executor.service';
import { SwingTradingService } from '../apps/worker/src/modules/swing-trading/swing-trading.service';

async function main() {
  const svc = new SwingTradingService(
    new SwingBitgetService(),
    new UtBotStrategyService(),
    new SwingExecutorService(),
  );
  await svc.runScan('manual-verify');
  console.log('Manual swing scan finished.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
