import type { AssetSummary } from '@web/shared/api/types';

/**
 * Validated categorical palette, assigned in fixed order and never cycled. Three
 * of the light-mode slots sit below 3:1 against the page surface, which is why
 * a legend built on these must carry a visible text label per slice rather than
 * leaning on colour alone.
 *
 * The only renderer left — `AssetSummaryCard` — overrides these with the overview's
 * own palette so both donuts on that page match; the values stay because
 * `buildSlices` is the tested seam and a slice without a colour is a half-built row.
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
