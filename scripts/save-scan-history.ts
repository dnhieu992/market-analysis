/**
 * Save a scan/analysis run into a strategy's History tab (StrategyHistory table).
 *
 * Used by the `spot-scan` skill so each scan + fundamental DD is logged automatically,
 * instead of being pasted by hand. Runs on the server (needs .env DATABASE_URL).
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/save-scan-history.ts --title "Scan $100M–$1B · 18/09/2026" --file /path/to/content.md
 *     [--strategy "Spot Scan"]
 *
 * `--file` is a UTF-8 markdown file; alternatively pass `--content "..."` inline.
 */
import * as fs from 'node:fs';
import { prisma } from '@app/db';

function arg(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main() {
  const strategyName = arg('strategy') ?? 'Spot Scan';
  const title = arg('title');
  const file = arg('file');
  const inline = arg('content');

  if (!title) throw new Error('Missing --title');
  const content = file ? fs.readFileSync(file, 'utf8') : inline;
  if (!content || !content.trim()) throw new Error('Missing content (pass --file <path> or --content "...")');

  const strategy = await prisma.tradingStrategy.findFirst({ where: { name: strategyName } });
  if (!strategy) throw new Error(`Strategy "${strategyName}" not found`);

  const entry = await prisma.strategyHistory.create({
    data: { strategyId: strategy.id, title: title.trim(), content },
  });
  const count = await prisma.strategyHistory.count({ where: { strategyId: strategy.id } });
  console.log(`[save-scan-history] saved to "${strategyName}" — id=${entry.id} (${content.length} chars). Total entries: ${count}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[save-scan-history] failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
