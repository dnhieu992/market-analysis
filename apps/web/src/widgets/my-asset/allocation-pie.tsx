'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { AssetSummary } from '@web/shared/api/types';

/**
 * Validated categorical palette, assigned in fixed order and never cycled. Three
 * of the light-mode slots sit below 3:1 against the page surface, which is why
 * the legend carries a visible text label and amount for every slice rather than
 * leaning on colour alone.
 */
const SERIES_COLORS = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
];

/** Anything past the 8th slice folds in here — a 9th generated hue would not be distinguishable. */
const OTHER_COLOR = '#8c8378';
const MAX_SLICES = SERIES_COLORS.length;

/** The coins the trader wants called out by name; everything else groups together. */
const NAMED_COINS = ['BTC', 'ETH'];

/** One row of the allocation — a coin, a cash pile, or a deployed account. */
export type AllocationItem = {
  key: string;
  label: string;
  valueUsdt: number;
};

type Slice = {
  name: string;
  value: number;
  pct: number;
  color: string;
};

function formatUsdt(value: number): string {
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} USDT`;
}

/**
 * What the donut divides up is the book's *current value*, not the ledger:
 *
 *     coins at market + available USDT + each deployed account at current value
 *
 * which sums to exactly the `currentValueUsdt` in the hero. The spot bucket is
 * gone as a single slice — "3,163 USDT in spot" never said how much of it was
 * BTC — and available USDT is a slice of its own rather than a separate card,
 * because cash waiting to be deployed is an allocation like any other.
 */
export function buildAllocationItems(summary: AssetSummary): AllocationItem[] {
  const { available } = summary;

  const named = available.spotPositions.filter((p) => NAMED_COINS.includes(p.coinId));
  const rest = available.spotPositions.filter((p) => !NAMED_COINS.includes(p.coinId));

  const items: AllocationItem[] = named.map((p) => ({
    key: `coin:${p.coinId}`,
    label: p.coinId,
    valueUsdt: p.marketValueUsdt,
  }));

  // A group of one is just that coin — naming it beats hiding it behind "Khác (1)".
  if (rest.length === 1 && rest[0]) {
    items.push({
      key: `coin:${rest[0].coinId}`,
      label: rest[0].coinId,
      valueUsdt: rest[0].marketValueUsdt,
    });
  } else if (rest.length > 1) {
    items.push({
      key: 'coin:other',
      label: `Coin khác (${rest.length})`,
      valueUsdt: rest.reduce((sum, p) => sum + p.marketValueUsdt, 0),
    });
  }

  // Cash carries every bucket that is not spot and not deployed — wallet included —
  // so no cash goes missing now that the standalone available card is gone.
  items.push({
    key: 'available',
    label: 'USDT khả dụng',
    valueUsdt: available.availableUsdt,
  });

  // Marked to market, matching what the Vốn triển khai panel reports above.
  for (const bucket of available.deployed) {
    items.push({
      key: `deployed:${bucket.key}`,
      label: bucket.label,
      valueUsdt: bucket.currentValueUsdt,
    });
  }

  return items;
}

/**
 * Slices are the share of the *positive* values. An account can go negative if a
 * withdrawal was logged against money it never held; a negative slice has no
 * meaning in a part-to-whole chart, so those are dropped from the pie and shown
 * in the legend instead, where the real number can still be read.
 */
export function buildSlices(items: AllocationItem[]): { slices: Slice[]; pieTotal: number } {
  const positive = items.filter((i) => i.valueUsdt > 0).sort((a, b) => b.valueUsdt - a.valueUsdt);

  const pieTotal = positive.reduce((sum, i) => sum + i.valueUsdt, 0);
  if (pieTotal <= 0) return { slices: [], pieTotal: 0 };

  const head = positive.slice(0, MAX_SLICES);
  const tail = positive.slice(MAX_SLICES);

  const slices: Slice[] = head.map((item, i) => ({
    name: item.label,
    value: item.valueUsdt,
    pct: (item.valueUsdt / pieTotal) * 100,
    // `head` is capped at SERIES_COLORS.length, so the index is always in range.
    color: SERIES_COLORS[i] ?? OTHER_COLOR,
  }));

  if (tail.length > 0) {
    const rest = tail.reduce((sum, i) => sum + i.valueUsdt, 0);
    slices.push({
      name: `Khác (${tail.length})`,
      value: rest,
      pct: (rest / pieTotal) * 100,
      color: OTHER_COLOR,
    });
  }

  return { slices, pieTotal };
}

type Props = Readonly<{
  items: AllocationItem[];
}>;

export function AllocationPie({ items }: Props) {
  const { slices } = buildSlices(items);

  if (slices.length === 0) {
    return <p className="ma-empty">Chưa có số dư nào để phân bổ.</p>;
  }

  return (
    <div className="ma-donut-row">
      <div className="ma-chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={92}
              dataKey="value"
              // A 2px surface-coloured gap between segments, per the mark spec.
              strokeWidth={2}
              stroke="#ffffff"
              paddingAngle={1}
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <Cell key={slice.name} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [formatUsdt(Number(value)), String(name)]}
              contentStyle={{
                borderRadius: 12,
                border: '1px solid rgba(23, 18, 13, 0.12)',
                fontSize: '0.85rem',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* The legend doubles as the table view: every item, with its real number. */}
      <ul className="ma-legend">
        {slices.map((slice) => (
          <li key={slice.name} className="ma-legend-item">
            <span className="ma-legend-dot" style={{ background: slice.color }} />
            <span className="ma-legend-name">{slice.name}</span>
            <span className="ma-legend-value">{formatUsdt(slice.value)}</span>
            <span className="ma-legend-pct">{slice.pct.toFixed(1)}%</span>
          </li>
        ))}

        {items
          .filter((i) => i.valueUsdt <= 0)
          .map((item) => (
            <li key={item.key} className="ma-legend-item ma-legend-item--muted">
              <span className="ma-legend-dot ma-legend-dot--empty" />
              <span className="ma-legend-name">{item.label}</span>
              <span className="ma-legend-value">{formatUsdt(item.valueUsdt)}</span>
              <span className="ma-legend-pct">—</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
