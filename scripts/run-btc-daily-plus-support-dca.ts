/**
 * BTC — DCA hàng ngày CỘNG mua thêm tại vùng hỗ trợ.
 *
 * User's plan: "vừa mua theo ngày, vừa mua tại các vùng hỗ trợ cứng".
 * Ngân sách tháng B được chia hai chân:
 *   - chân DAILY: `dailyShare` của B, rải đều mỗi ngày (ticket = B*share/30.44).
 *   - chân DIP:   phần còn lại KHÔNG tiêu ngay, cộng dồn vào một quỹ dự trữ (reserve)
 *                 và chỉ bắn ra khi giá về vùng hỗ trợ.
 * Đây chính là điểm khác biệt phải đo: mua-vùng-hỗ-trợ chỉ có nghĩa nếu bạn CHỊU ĐỂ TIỀN NẰM CHỜ.
 *
 * Hai cách định nghĩa "vùng hỗ trợ":
 *   `fixed` — giá giảm `dipPct`% so với đỉnh chạy kể từ lần mua dip gần nhất (tự khởi động lại,
 *             không cần lookahead). Đây là luật đã thắng ở run lot-grid 2026-08-07.
 *   `zone`  — cụm pivot-low xác nhận trước ngày giao dịch (không lookahead), gom cụm trong
 *             `zoneTol`%, giữ cụm có >= `minTouches` chạm; mua khi giá chạm cụm nằm dưới giá
 *             hiện tại, mỗi cụm chỉ mua lại sau `zoneCooldown` ngày.
 *
 * Chốt lời (tuỳ chọn): tp > 0 => bán SẠCH kho tại avgCost*(1+tp), tiền bán quay lại reserve,
 * DCA chạy tiếp. tp = 0 => thuần tích luỹ, không bán (đo giá vốn đạt được).
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-daily-plus-support-dca.ts [start] [end] [monthlyBudget] [feePctPerSide]
 */
import * as https from 'https';

const START = process.argv[2] ?? '2022-01-01';
const END = process.argv[3] ?? '2100-01-01';
const MONTHLY = Number(process.argv[4] ?? 200);
const FEE = Number(process.argv[5] ?? 0.05) / 100;

const BITSTAMP = 'https://www.bitstamp.net/api/v2/ohlc/btcusd/';

type Day = { ts: number; date: string; open: number; high: number; low: number; close: number };

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(s));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function fetchDaily(startSec: number): Promise<Day[]> {
  const out: Day[] = [];
  let cur = startSec;
  for (;;) {
    const res = await fetchJson(`${BITSTAMP}?step=86400&limit=1000&start=${cur}`);
    const rows: any[] = res?.data?.ohlc ?? [];
    if (!rows.length) break;
    let added = 0;
    for (const r of rows) {
      const ts = Number(r.timestamp);
      if (out.length && ts <= out[out.length - 1].ts) continue;
      out.push({
        ts,
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.close),
      });
      added++;
    }
    if (!added) break;
    cur = out[out.length - 1].ts + 86400;
  }
  return out;
}

/** Pivot lows confirmed k bars each side; only usable from index i+k onward (no lookahead). */
function pivotLows(days: Day[], k: number): { idx: number; price: number }[] {
  const out: { idx: number; price: number }[] = [];
  for (let i = k; i < days.length - k; i++) {
    let ok = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j !== i && days[j].low < days[i].low) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ idx: i + k, price: days[i].low }); // usable only after confirmation
  }
  return out;
}

type Cfg = {
  label: string;
  dailyShare: number; // 0..1 of monthly budget spent daily
  mode: 'fixed' | 'zone' | 'none';
  dipPct: number; // fixed mode: % below running high
  dipMult: number; // dip ticket = dipMult x daily ticket
  tp: number; // 0 = no selling
  zoneTol?: number;
  minTouches?: number;
  zoneCooldown?: number;
  pivotK?: number;
  zoneLookback?: number;
  /** Chân daily chỉ mua khi close < giá vốn hiện tại (tiền không tiêu chảy vào reserve). */
  belowAvgOnly?: boolean;
  /** Trần quỹ dự trữ, tính theo SỐ THÁNG ngân sách. Vượt trần thì phần thừa chảy vào lệnh mua ngày
   *  — chống "tiền nằm chết" khi dip không về. 0 = không giới hạn. */
  reserveCapMonths?: number;
};

function run(days: Day[], c: Cfg) {
  const dailyTicket = (MONTHLY * c.dailyShare) / 30.44;
  const reservePerDay = (MONTHLY * (1 - c.dailyShare)) / 30.44;
  const dipTicket = dailyTicket > 0 ? dailyTicket * c.dipMult : (MONTHLY / 30.44) * c.dipMult;

  let coins = 0;
  let cost = 0; // cost basis of open inventory
  let contributed = 0; // total cash put in (the "salary" you commit)
  let reserve = 0;
  let realised = 0;
  let dipBuys = 0;
  let dailyBuys = 0;
  let sells = 0;
  let ref = days[0].open; // running high since last dip buy
  let maxReserve = 0;
  let reserveDays = 0;

  const pivots = c.mode === 'zone' ? pivotLows(days, c.pivotK ?? 4) : [];
  const zoneUsed = new Map<number, number>(); // zone price -> last used index

  const buy = (usd: number, price: number, fromReserve: boolean) => {
    if (usd <= 0) return;
    const got = (usd * (1 - FEE)) / price;
    coins += got;
    cost += usd;
    if (fromReserve) reserve -= usd;
  };

  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    contributed += dailyTicket + reservePerDay;
    reserve += reservePerDay;

    // ---- chân DAILY: mua tại close mỗi ngày (+ phần reserve tràn trần) ----
    const cap = (c.reserveCapMonths ?? 0) * MONTHLY;
    let overflow = 0;
    if (cap > 0 && reserve > cap) {
      overflow = reserve - cap;
      reserve = cap;
    }
    const avgNow = coins > 0 ? cost / coins : 0;
    const dailyAllowed = !c.belowAvgOnly || avgNow === 0 || d.close < avgNow;
    if (dailyTicket + overflow > 0) {
      if (dailyAllowed) {
        buy(dailyTicket + overflow, d.close, false);
        dailyBuys++;
      } else {
        reserve += dailyTicket + overflow; // để dành, mua ở vùng hỗ trợ
      }
    }

    // ---- chân DIP ----
    if (c.mode === 'fixed') {
      if (d.high > ref) ref = d.high;
      const trigger = ref * (1 - c.dipPct / 100);
      if (d.low <= trigger && reserve >= dipTicket) {
        const px = Math.min(trigger, d.open);
        buy(dipTicket, px, true);
        dipBuys++;
        ref = px;
      }
    } else if (c.mode === 'zone') {
      // build zone clusters from pivots confirmed strictly before today
      const lookback = c.zoneLookback ?? 500;
      const usable = pivots.filter((p) => p.idx <= i && p.idx >= i - lookback);
      if (usable.length) {
        const tol = (c.zoneTol ?? 3) / 100;
        const sorted = [...usable].sort((a, b) => b.price - a.price);
        const clusters: { price: number; touches: number }[] = [];
        for (const p of sorted) {
          const hit = clusters.find((z) => Math.abs(z.price - p.price) / z.price <= tol);
          if (hit) {
            hit.price = (hit.price * hit.touches + p.price) / (hit.touches + 1);
            hit.touches++;
          } else clusters.push({ price: p.price, touches: 1 });
        }
        const cd = c.zoneCooldown ?? 20;
        const candidates = clusters
          .filter((z) => z.touches >= (c.minTouches ?? 2) && z.price < d.open)
          .filter((z) => {
            const last = zoneUsed.get(Math.round(z.price));
            return last === undefined || i - last >= cd;
          })
          .sort((a, b) => b.price - a.price);
        const z = candidates[0];
        if (z && d.low <= z.price && reserve >= dipTicket) {
          buy(dipTicket, Math.min(z.price, d.open), true);
          dipBuys++;
          zoneUsed.set(Math.round(z.price), i);
        }
      }
    }

    // ---- chốt lời ----
    if (c.tp > 0 && coins > 0) {
      const avg = cost / coins;
      const target = avg * (1 + c.tp / 100);
      if (d.high >= target) {
        const proceeds = coins * target * (1 - FEE);
        realised += proceeds - cost;
        reserve += proceeds;
        coins = 0;
        cost = 0;
        sells++;
        ref = target;
      }
    }

    if (reserve > maxReserve) maxReserve = reserve;
    if (reserve > dipTicket) reserveDays++;
  }

  const last = days[days.length - 1].close;
  const avgCost = coins > 0 ? cost / coins : 0;
  const mtm = coins * last + reserve;
  return {
    label: c.label,
    dailyBuys,
    dipBuys,
    sells,
    contributed,
    deployed: contributed - reserve,
    reserve,
    coins,
    avgCost,
    realised,
    unreal: coins * last - cost,
    equity: mtm,
    roi: ((mtm - contributed) / contributed) * 100,
    idlePct: (reserveDays / days.length) * 100,
    maxReserve,
  };
}

function table(rows: ReturnType<typeof run>[], last: number) {
  const h = [
    'config',
    'daily',
    'dip',
    'sell',
    'nạp $',
    'giá TB',
    'vs spot',
    'BTC',
    'reserve',
    'equity',
    'ROI%',
  ];
  const body = rows.map((r) => [
    r.label,
    String(r.dailyBuys),
    String(r.dipBuys),
    String(r.sells),
    r.contributed.toFixed(0),
    r.avgCost ? r.avgCost.toFixed(0) : '-',
    r.avgCost ? (((last - r.avgCost) / r.avgCost) * 100).toFixed(1) + '%' : '-',
    r.coins.toFixed(5),
    r.reserve.toFixed(0),
    r.equity.toFixed(0),
    r.roi.toFixed(1),
  ]);
  const w = h.map((x, i) => Math.max(x.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(w[i])).join(' | ');
  console.log(line(h));
  console.log(w.map((x) => '-'.repeat(x)).join('-+-'));
  body.forEach((b) => console.log(line(b)));
}

const WINDOWS: { name: string; from: string; to: string }[] = [
  { name: 'CHOP+RECOVERY 2022-01 → nay', from: '2022-01-01', to: '2026-08-09' },
  { name: 'BULL 2017-01 → 2021-12', from: '2017-01-01', to: '2021-12-31' },
  { name: 'BEAR hiện tại 2025-10 → nay', from: '2025-10-06', to: '2026-08-09' },
  { name: 'BEAR 2021-11 → 2023-01', from: '2021-11-10', to: '2023-01-31' },
];

const CAP = 3; // trần reserve = 3 tháng ngân sách

function configs(): Cfg[] {
  const zoneOpts = { zoneTol: 3, minTouches: 2, zoneCooldown: 20, pivotK: 4, zoneLookback: 500 };
  const out: Cfg[] = [
    { label: '100% daily (baseline)', dailyShare: 1, mode: 'none', dipPct: 0, dipMult: 0, tp: 0 },
  ];
  for (const share of [0.7, 0.5]) {
    for (const dip of [5, 8, 12]) {
      out.push({
        label: `${Math.round(share * 100)}/${Math.round((1 - share) * 100)} + dip −${dip}% (cap ${CAP}m)`,
        dailyShare: share,
        mode: 'fixed',
        dipPct: dip,
        dipMult: 4,
        tp: 0,
        reserveCapMonths: CAP,
      });
    }
  }
  out.push({
    label: `50/50 + ZONE pivot (cap ${CAP}m)`,
    dailyShare: 0.5,
    mode: 'zone',
    dipPct: 0,
    dipMult: 4,
    tp: 0,
    reserveCapMonths: CAP,
    ...zoneOpts,
  });
  out.push({
    label: '100% daily, chỉ mua dưới avg',
    dailyShare: 1,
    mode: 'none',
    dipPct: 0,
    dipMult: 0,
    tp: 0,
    belowAvgOnly: true,
  });
  out.push({
    label: `70/30 + dip −5%, dưới avg (cap ${CAP}m)`,
    dailyShare: 0.7,
    mode: 'fixed',
    dipPct: 5,
    dipMult: 4,
    tp: 0,
    reserveCapMonths: CAP,
    belowAvgOnly: true,
  });
  out.push({
    label: '50/50 + dip −8% (KHÔNG cap)',
    dailyShare: 0.5,
    mode: 'fixed',
    dipPct: 8,
    dipMult: 4,
    tp: 0,
  });
  return out;
}

(async () => {
  const earliest = WINDOWS.reduce((a, w) => (w.from < a ? w.from : a), WINDOWS[0].from);
  const all = await fetchDaily(Math.floor(new Date(earliest + 'T00:00:00Z').getTime() / 1000));

  for (const w of WINDOWS) {
    const days = all.filter((d) => d.date >= w.from && d.date <= w.to);
    if (days.length < 60) continue;
    const last = days[days.length - 1].close;
    console.log(
      `\n### ${w.name} — ${days[0].date} → ${days[days.length - 1].date} (${(days.length / 365).toFixed(2)}y) · ` +
        `$${MONTHLY}/tháng · fee ${(FEE * 100).toFixed(3)}%/side · giá đầu $${days[0].open.toFixed(0)} → cuối $${last.toFixed(0)}`,
    );
    table(
      configs().map((c) => run(days, c)),
      last,
    );
  }

  // ---------- có chốt lời, chỉ trên cửa sổ chính ----------
  const main = all.filter((d) => d.date >= START && d.date <= END);
  const lastMain = main[main.length - 1].close;
  console.log('\n### CÓ CHỐT LỜI (bán sạch kho tại avgCost x (1+tp), DCA chạy tiếp) — ' + START + ' → nay');
  const rowsB: ReturnType<typeof run>[] = [];
  for (const tp of [6, 10, 15, 25]) {
    rowsB.push(run(main, { label: `100% daily · TP ${tp}%`, dailyShare: 1, mode: 'none', dipPct: 0, dipMult: 0, tp }));
    rowsB.push(
      run(main, {
        label: `50/50 + dip −8% · TP ${tp}%`,
        dailyShare: 0.5,
        mode: 'fixed',
        dipPct: 8,
        dipMult: 4,
        tp,
      }),
    );
  }
  table(rowsB, lastMain);
})();
