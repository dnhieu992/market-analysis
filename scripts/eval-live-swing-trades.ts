/* Pull live swing-trading signals from the DB and evaluate them. */
import { prisma } from '../packages/db/src/client';

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

async function main() {
  const all = await prisma.swingTradingSignal.findMany({ orderBy: { detectedAt: 'asc' } });
  console.log(`Total signals: ${all.length}`);
  if (all.length === 0) return;

  console.log(`First detectedAt: ${all[0]!.detectedAt.toISOString()}  Last: ${all[all.length - 1]!.detectedAt.toISOString()}`);

  // status breakdown
  const byStatus: Record<string, number> = {};
  for (const s of all) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  console.log('Status:', byStatus);

  // mode breakdown (PAPER vs LIVE)
  const byMode: Record<string, number> = {};
  for (const s of all) byMode[s.mode] = (byMode[s.mode] ?? 0) + 1;
  console.log('Mode:', byMode);

  // legKind breakdown
  const byLeg: Record<string, number> = {};
  for (const s of all) byLeg[s.legKind] = (byLeg[s.legKind] ?? 0) + 1;
  console.log('LegKind:', byLeg);

  const closed = all.filter((s) => s.status === 'CLOSED' && s.pnlUsd != null);
  const active = all.filter((s) => s.status === 'ACTIVE');

  console.log(`\n=== CLOSED: ${closed.length} | ACTIVE: ${active.length} ===`);

  // Per-symbol stats on closed trades
  const symbols = [...new Set(all.map((s) => s.symbol))].sort();
  console.log('\nsymbol      tf    | closed  win  loss  win%   sumPnl$    avgWin$   avgLoss$   bestLeg   worstLeg');
  let grandPnl = 0;
  for (const sym of symbols) {
    const cs = closed.filter((s) => s.symbol === sym);
    if (cs.length === 0) continue;
    const wins = cs.filter((s) => (s.pnlUsd ?? 0) > 0);
    const losses = cs.filter((s) => (s.pnlUsd ?? 0) < 0);
    const sum = cs.reduce((a, s) => a + (s.pnlUsd ?? 0), 0);
    grandPnl += sum;
    const avgWin = wins.length ? wins.reduce((a, s) => a + (s.pnlUsd ?? 0), 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((a, s) => a + (s.pnlUsd ?? 0), 0) / losses.length : 0;
    const best = Math.max(...cs.map((s) => s.pnlUsd ?? 0));
    const worst = Math.min(...cs.map((s) => s.pnlUsd ?? 0));
    const tf = cs[0]!.timeframe;
    console.log(
      `${sym.padEnd(11)} ${tf.padEnd(4)} | ${String(cs.length).padStart(6)}  ${String(wins.length).padStart(3)}  ${String(losses.length).padStart(4)}  ` +
        `${fmt((wins.length / cs.length) * 100).padStart(5)}%  ${('$' + fmt(sum)).padStart(9)}  ${('$' + fmt(avgWin)).padStart(8)}  ${('$' + fmt(avgLoss)).padStart(9)}  ` +
        `${('$' + fmt(best)).padStart(8)}  ${('$' + fmt(worst)).padStart(8)}`,
    );
  }
  console.log(`\nGrand realized PnL (closed): $${fmt(grandPnl)}`);

  // Unrealized on active (mark not available here; just list)
  if (active.length) {
    console.log('\n=== ACTIVE positions ===');
    for (const s of active) {
      console.log(
        `${s.symbol} ${s.timeframe} ${s.direction} ${s.legKind} entry=${s.entryPrice} SL=${s.stopLoss} qty=${s.quantity ?? '?'} ` +
          `kv=${s.keyValue} entryDist=${s.entryLineDistancePct != null ? fmt(s.entryLineDistancePct) + '%' : '?'} since=${s.detectedAt.toISOString().slice(0, 16)}`,
      );
    }
  }

  // Distribution of entryLineDistancePct on closed trades (how far from line we entered)
  const withDist = closed.filter((s) => s.entryLineDistancePct != null);
  if (withDist.length) {
    const ds = withDist.map((s) => s.entryLineDistancePct as number).sort((a, b) => a - b);
    const q = (p: number) => ds[Math.min(ds.length - 1, Math.floor(p * ds.length))]!;
    console.log(`\nentryLineDistancePct on closed (n=${ds.length}): min ${fmt(ds[0]!)}% p25 ${fmt(q(0.25))}% median ${fmt(q(0.5))}% p75 ${fmt(q(0.75))}% max ${fmt(ds[ds.length - 1]!)}%`);
  }

  // Recent 15 closed trades detail
  console.log('\n=== Last 15 CLOSED trades ===');
  const recent = closed.slice(-15);
  for (const s of recent) {
    const pnl = s.pnlUsd ?? 0;
    const held = s.closedAt ? ((s.closedAt.getTime() - s.detectedAt.getTime()) / 36e5).toFixed(0) + 'h' : '?';
    console.log(
      `${s.detectedAt.toISOString().slice(0, 16)} ${s.symbol.padEnd(8)} ${s.direction.padEnd(5)} ${s.legKind.padEnd(4)} ` +
        `entry=${String(s.entryPrice).padStart(10)} exit=${String(s.closedPrice ?? '?').padStart(10)} held=${held.padStart(5)} pnl=${(pnl >= 0 ? '+' : '') + fmt(pnl)}$`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
