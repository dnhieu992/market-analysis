'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { AssetCategory } from '@web/shared/api/types';

/**
 * Validated categorical palette, assigned in fixed order and never cycled. The
 * three lightest slots sit below 3:1 against the page surface, which is why the
 * legend carries a visible text label and amount for every slice rather than
 * leaning on colour alone.
 */
const SERIES_COLORS = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
];

/** Anything past the 6th slice folds in here — a 7th generated hue would not be distinguishable. */
const OTHER_COLOR = '#8c8378';
const MAX_SLICES = SERIES_COLORS.length;

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
 * Slices are the share of the *positive* balances. A bucket can go negative if a
 * withdrawal was logged against money it never held; a negative slice has no
 * meaning in a part-to-whole chart, so those are dropped from the pie and shown
 * in the legend instead, where the real number can still be read.
 */
export function buildSlices(categories: AssetCategory[]): { slices: Slice[]; pieTotal: number } {
  const positive = categories
    .filter((c) => c.balanceUsdt > 0)
    .sort((a, b) => b.balanceUsdt - a.balanceUsdt);

  const pieTotal = positive.reduce((sum, c) => sum + c.balanceUsdt, 0);
  if (pieTotal <= 0) return { slices: [], pieTotal: 0 };

  const head = positive.slice(0, MAX_SLICES);
  const tail = positive.slice(MAX_SLICES);

  const slices: Slice[] = head.map((c, i) => ({
    name: c.label,
    value: c.balanceUsdt,
    pct: (c.balanceUsdt / pieTotal) * 100,
    // `head` is capped at SERIES_COLORS.length, so the index is always in range.
    color: SERIES_COLORS[i] ?? OTHER_COLOR,
  }));

  if (tail.length > 0) {
    const rest = tail.reduce((sum, c) => sum + c.balanceUsdt, 0);
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
  categories: AssetCategory[];
}>;

export function AllocationPie({ categories }: Props) {
  const { slices } = buildSlices(categories);

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

      {/* The legend doubles as the table view: every bucket, with its real number. */}
      <ul className="ma-legend">
        {slices.map((slice) => (
          <li key={slice.name} className="ma-legend-item">
            <span className="ma-legend-dot" style={{ background: slice.color }} />
            <span className="ma-legend-name">{slice.name}</span>
            <span className="ma-legend-value">{formatUsdt(slice.value)}</span>
            <span className="ma-legend-pct">{slice.pct.toFixed(1)}%</span>
          </li>
        ))}

        {categories
          .filter((c) => c.balanceUsdt <= 0)
          .map((c) => (
            <li key={c.id} className="ma-legend-item ma-legend-item--muted">
              <span className="ma-legend-dot ma-legend-dot--empty" />
              <span className="ma-legend-name">{c.label}</span>
              <span className="ma-legend-value">{formatUsdt(c.balanceUsdt)}</span>
              <span className="ma-legend-pct">—</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
