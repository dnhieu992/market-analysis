/**
 * BTC SHORT @ 00:00 UTC · TP = entry − $tpPts (absolute price points) · force-close 08:00 UTC · no stop.
 * Fixed $notional/trade (no compounding), fee feePct%/side.
 *
 * Rule (every day): SHORT at the OPEN of the 00:00 UTC 1h candle.
 *   - TP: if any candle in [00:00..07:00] trades down to entry − tpPts → exit there (profit).
 *   - No stop. If TP not hit, force-close at 08:00 UTC (= open of the 08:00 candle).
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-btc-short-0000-tp500-backtest.ts \
 *   [days] [feePctPerSide] [notional] [tpPts] [exitHour]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const SYMBOL = 'BTCUSDT', INTERVAL = '1h';

type Candle = { open: number; high: number; low: number; close: number; hour: number };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const out: Candle[] = []; let cur = startMs;
  while (cur < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) out.push({ open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), hour: new Date(k[0] as number).getUTCHours() });
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n));

async function main() {
  const [, , daysA, feeA, notA, tpA, ehA, enA, tpPctA] = process.argv;
  const days = Number(daysA ?? 365), fee = Number(feeA ?? 0.05), notional = Number(notA ?? 1000), tpPts = Number(tpA ?? 500), exitHour = Number(ehA ?? 8), ENTRY_HOUR = Number(enA ?? 0);
  const tpPct = Number(tpPctA ?? 0); // if >0, use a percentage TP instead of fixed $tpPts
  const usePct = tpPct > 0;
  const f = fee / 100;
  const endMs = Date.now(), startMs = endMs - days * 864e5;
  const c = await fetchKlines(SYMBOL, INTERVAL, startMs, endMs);

  let trades = 0, tpHits = 0, forced = 0, forcedWin = 0, net = 0, gross = 0, grossWin = 0, grossLoss = 0;
  for (let i = 0; i < c.length; i++) {
    if (c[i]!.hour !== ENTRY_HOUR) continue;
    const entry = c[i]!.open, tpPx = usePct ? entry * (1 - tpPct / 100) : entry - tpPts;
    const tpRet = usePct ? tpPct / 100 : tpPts / entry;
    let exitRet: number | null = null, hitTP = false;
    for (let j = i; j < c.length; j++) {
      if (j > i && c[j]!.hour === exitHour) { exitRet = (entry - c[j]!.open) / entry; break; } // force close (short: profit if price fell)
      if (c[j]!.low <= tpPx) { exitRet = tpRet; hitTP = true; break; }                          // TP hit (short)
      if (j - i > 14) { exitRet = (entry - c[j]!.close) / entry; break; }                       // safety
    }
    if (exitRet === null) continue;
    const g = notional * exitRet;
    const n = notional * ((1 + exitRet) * (1 - f) * (1 - f) - 1);
    trades++; gross += g; net += n;
    if (g >= 0) grossWin += g; else grossLoss += -g;
    if (hitTP) tpHits++; else { forced++; if (exitRet >= 0) forcedWin++; }
  }

  const tpLabel = usePct ? `−${tpPct}%` : `−$${tpPts} (price pts)`;
  console.log(`\n=== BTC SHORT @ ${String(ENTRY_HOUR).padStart(2, '0')}:00 UTC · TP = ${tpLabel} · force-close ${String(exitHour).padStart(2, '0')}:00 UTC · NO stop · ${days}d · $${notional}/trade · fee ${fee}%/side ===\n`);
  console.log(`  trades         : ${trades}`);
  console.log(`  TP hit         : ${tpHits} (${fmt(trades ? (tpHits / trades) * 100 : 0, 1)}%)`);
  console.log(`  forced close   : ${forced}  (of which ${forcedWin} green)`);
  console.log(`  gross win / loss: ${usd(grossWin)} / ${usd(-grossLoss)}`);
  console.log(`  GROSS P&L      : ${usd(gross)}  (avg ${usd(trades ? gross / trades : 0)}/trade)`);
  console.log(`  total fees     : ${usd(-(gross - net))}`);
  console.log(`  NET P&L        : ${usd(net)}  (avg ${usd(trades ? net / trades : 0)}/trade)\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
