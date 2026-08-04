import { PrismaClient } from '@prisma/client';

const SYMBOL = process.argv[2];
if (!SYMBOL) throw new Error('usage: node write-symbol-note.mjs <SYMBOL> [--dry]');
const DRY = process.argv.includes('--dry');

const p = new PrismaClient();
const rows = await p.bitgetTrade.findMany({
  where: { symbol: SYMBOL, status: 'closed' },
  orderBy: { openedAt: 'asc' },
});
if (!rows.length) throw new Error(`no closed trades for ${SYMBOL}`);
const openCount = await p.bitgetTrade.count({ where: { symbol: SYMBOL, status: 'open' } });

const dayKey = (d) => d.toISOString().slice(0, 10);
const from = new Date(rows[0].openedAt);
from.setUTCHours(0, 0, 0, 0);
const res = await fetch(
  `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1d&startTime=${from.getTime()}&limit=60`);
if (!res.ok) throw new Error(`binance ${res.status}`);
const dayOpen = new Map((await res.json()).map((k) => [dayKey(new Date(k[0])), Number(k[1])]));

const pad = (n) => String(n).padStart(2, '0');
const ict = (d) => {
  const x = new Date(d.getTime() + 7 * 3600e3);
  return `${pad(x.getUTCDate())}/${pad(x.getUTCMonth() + 1)} ${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
};
const hourIct = (d) => new Date(d.getTime() + 7 * 3600e3).getUTCHours();
const dur = (a, b) => {
  const m = Math.round((b.getTime() - a.getTime()) / 60000);
  return `${Math.floor(m / 60)}h${pad(m % 60)}m`;
};
const notional = (r) => r.openAvgPrice * r.openTotalPos;
const netPct = (r) => (r.netProfit / notional(r)) * 100;
const grossPct = (r) => (r.pnl / notional(r)) * 100;
const intraday = (r) => {
  const o = dayOpen.get(dayKey(r.openedAt));
  return o ? ((r.openAvgPrice - o) / o) * 100 : null;
};
const holdH = (r) => (r.closedAt - r.openedAt) / 3600e3;
const sgn = (n, d = 2) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(d);

// mode over a fixed-width bin. Returns the fullest bin: size, value range, and
// the records in it — so a second metric can be reported for the *same* trades
// instead of re-running the mode and landing on a different cluster.
const mode = (recs, pick, width) => {
  const bins = new Map();
  for (const r of recs) {
    const v = pick(r);
    if (v == null) continue;
    const k = Math.floor(v / width);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(r);
  }
  if (!bins.size) return null;
  const sorted = [...bins.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  const top = sorted[0][1].length;
  // Every value in its own bin => there is no repeated value; a "mode" would be
  // an arbitrary pick. Several bins tied at the top => report the tie, not one.
  const tied = sorted.filter(([, v]) => v.length === top).map(([, v]) => {
    const s = v.map(pick).sort((a, b) => a - b);
    return { n: v.length, lo: s[0], hi: s[s.length - 1], members: v };
  });
  return { ...tied[0], top, tied, degenerate: top === 1 };
};
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const rangeOf = (recs, pick) => {
  const s = recs.map(pick).sort((a, b) => a - b);
  return { lo: s[0], hi: s[s.length - 1] };
};
const sideBreak = (v) => {
  const parts = [];
  const l = v.filter((r) => r.holdSide === 'long').length;
  const s = v.filter((r) => r.holdSide === 'short').length;
  if (l) parts.push(`${l} LONG`);
  if (s) parts.push(`${s} SHORT`);
  return parts.join(' + ') || '—';
};
const outcome = (v) => {
  const w = v.filter((r) => r.netProfit > 0);
  const l = v.filter((r) => r.netProfit <= 0);
  const parts = [`**thắng ${w.length}${w.length ? ` (${sideBreak(w)})` : ''}**`];
  if (l.length) parts.push(`lỗ ${l.length} (${sideBreak(l)})`);
  return parts.join(', ');
};
const band = (m, d = 2) => (Math.abs(m.hi - m.lo) < 0.005 ? `${sgn(m.lo, d)}%` : `${sgn(m.lo, d)}…${sgn(m.hi, d)}%`);
const wr = (v) => `${v.filter((r) => r.netProfit > 0).length}/${v.length}, WR ${((v.filter((r) => r.netProfit > 0).length / v.length) * 100).toFixed(0)}%`;

const W = rows.filter((r) => r.netProfit > 0);
const longs = rows.filter((r) => r.holdSide === 'long');
const shorts = rows.filter((r) => r.holdSide === 'short');
const rate = (v) => (v.length ? v.filter((r) => r.netProfit > 0).length / v.length : -1);
const bestSide = rate(longs) >= rate(shorts) ? longs : shorts;
const otherSide = bestSide === longs ? shorts : longs;
const nameOf = (v) => (v === longs ? 'LONG' : 'SHORT');
const best = rows.reduce((a, r) => (r.pnl > a.pnl ? r : a));

const mNet = mode(W, netPct, 0.1);
const mDip = mode(rows, intraday, 0.2);
const mHold = mode(rows, holdH, 1);
const openBucket = (() => {
  const b = new Map();
  rows.forEach((r) => { const k = Math.floor(hourIct(r.openedAt) / 4) * 4; b.set(k, (b.get(k) || []).concat(r)); });
  const sorted = [...b.entries()].sort((a, b2) => b2[1].length - a[1].length || a[0] - b2[0]);
  const top = sorted[0][1].length;
  const tied = sorted.filter(([, v]) => v.length === top).map(([h, members]) => ({ h, members }));
  return { ...tied[0], tied };
})();
const nightless = rows.every((r) => hourIct(r.openedAt) >= 8);

const lines = [
  `- 🏆 **Thắng nhiều nhất: ${nameOf(bestSide)}** — **${wr(bestSide)}**` +
    (otherSide.length ? ` (${nameOf(otherSide)} ${wr(otherSide)})` : ` (chưa có lệnh ${nameOf(otherSide)})`),
];
if (mNet) {
  if (mNet.degenerate) {
    // no repeated close level — list them instead of inventing a mode
    const all = W.map(netPct).sort((a, b) => b - a).map((v) => sgn(v)).join('% · ') + '%';
    lines.push(`- 🎯 **Chốt lãi: không có mức lặp lại** — ${W.length} lệnh thắng chốt ở ${all} (median ${sgn(median(W.map(netPct)))}%)`);
  } else {
    const g = rangeOf(mNet.members, grossPct); // same trades as the net mode
    lines.push(`- 🎯 **Chốt lãi hay gặp nhất: ${band(mNet)} net** — ${mNet.n}/${W.length} lệnh thắng rơi vào dải này (gross ${band(g)})`);
  }
}
if (mDip) {
  if (mDip.degenerate) {
    lines.push(`- 📉 **Δ so với 00:00 UTC lúc vào lệnh: không có mức lặp lại** — ${rows.map(intraday).filter((v) => v != null).sort((a, b) => a - b).map((v) => sgn(v)).join('% · ')}%`);
  } else if (mDip.tied.length > 1) {
    lines.push(`- 📉 **Δ so với 00:00 UTC lúc vào lệnh: ${mDip.tied.length} vùng ngang nhau (${mDip.top} lệnh mỗi vùng)** — ` +
      mDip.tied.map((t) => `${band(t)} (${outcome(t.members)})`).join('; '));
  } else {
    lines.push(`- 📉 **Δ so với 00:00 UTC lúc vào lệnh, hay gặp nhất: ${band(mDip)}** — ${mDip.n}/${rows.length} lệnh: ${outcome(mDip.members)}`);
  }
}
lines.push(mHold.degenerate
  ? `- ⏱ **Giữ lệnh: không có mức lặp lại** — median ${median(rows.map(holdH)).toFixed(1)}h (từ ${Math.min(...rows.map(holdH)).toFixed(1)}h đến ${Math.max(...rows.map(holdH)).toFixed(1)}h)`
  : `- ⏱ **Giữ lệnh hay gặp nhất: ${Math.floor(mHold.lo)}–${Math.ceil(mHold.hi)}h** — ${mHold.n}/${rows.length} lệnh`);
const suffix = nightless ? '. Chưa từng mở lệnh 0h–7h' : '';
lines.push(openBucket.tied.length > 1
  ? `- 🕐 **Giờ mở: ${openBucket.tied.length} khung ngang nhau (${openBucket.members.length} lệnh mỗi khung)** — ` +
    openBucket.tied.map((t) => `**${t.h}h–${t.h + 3}h** (${outcome(t.members)})`).join('; ') + suffix
  : `- 🕐 **Giờ mở hay dùng nhất: ${openBucket.h}h–${openBucket.h + 3}h VN** — ${openBucket.members.length}/${rows.length} lệnh: ${outcome(openBucket.members)}` + suffix);
lines.push(`- 🔥 **Lãi gross cao nhất: ${sgn(grossPct(best))}% (${sgn(best.pnl, 3)}$)** — ${best.holdSide.toUpperCase()} mở **${ict(best.openedAt)}** → đóng **${ict(best.closedAt)}**, giữ ${dur(best.openedAt, best.closedAt)}`);

const coin = SYMBOL.replace(/USDT$/, '');
const note = `## ${SYMBOL} — reference vào lệnh

${lines.join('\n')}

_${rows.length} lệnh đã đóng${openCount ? ` · ${openCount} lệnh đang mở (chưa tính)` : ''} · tự sinh từ \`bitget_trades\` + Binance 1d · ${ict(new Date())}_`;

console.log(note);
console.log('\n--- %d chars%s', note.length, DRY ? ' (DRY RUN, không ghi DB)' : '');
console.log('[debug] all trades:', rows.map((r) =>
  `${r.holdSide} ${ict(r.openedAt)}→${ict(r.closedAt)} Δ${r.holdSide && intraday(r) != null ? sgn(intraday(r)) : '?'}% net${sgn(netPct(r))}% ${dur(r.openedAt, r.closedAt)}`).join('\n              '));

if (!DRY) {
  await p.bitgetSymbolNote.upsert({
    where: { symbol: SYMBOL },
    create: { symbol: SYMBOL, note },
    update: { note },
  });
  console.log('\n[written to bitget_symbol_notes]', SYMBOL, coin);
}
await p.$disconnect();
