'use client';

import type { MexcQqeTfSignal } from '@web/shared/api/types';

import { CHART_TIMEFRAMES, type ChartTimeframe } from './setup-chart-dialog';

/** Per-coin QQE state keyed by timeframe, matching the chart-view timeframes. */
export type QqeMap = Record<string, Record<string, MexcQqeTfSignal | null>>;

// A QQE signal is only "live" for this many closed candles after it fires; older
// flips are treated as stale and hidden.
const QQE_SIGNAL_VALID_BARS = 5;

export const isLiveSignal = (sig: MexcQqeTfSignal | null | undefined): sig is MexcQqeTfSignal =>
  sig != null && sig.barsSince != null && sig.barsSince < QQE_SIGNAL_VALID_BARS;

/** Strip the USDT suffix — the QQE API keys its response by the bare coin symbol. */
export const bareQqeSymbol = (s: string) => s.trim().toUpperCase().replace(/USDT$/, '');

/**
 * Only the timeframes with a QQE signal still live (flipped within the last 5
 * closed candles) are shown — the timeframe label itself is coloured green for
 * Long, red for Short. Used by the MEXC Setup tab (the Bitget page has its
 * own copy under widgets/bitget);
 * `timeframes` narrows which switcher columns a page reports on.
 */
export function QqeCell({
  signals,
  timeframes = CHART_TIMEFRAMES,
}: {
  signals: Record<string, MexcQqeTfSignal | null> | undefined;
  timeframes?: readonly ChartTimeframe[];
}) {
  const live = timeframes.filter(({ tf }) => isLiveSignal(signals?.[tf]));
  if (live.length === 0) return <span className="bg-qqe-none">—</span>;
  return (
    <div className="bg-qqe-grid">
      {live.map(({ label, tf }) => {
        const sig = signals![tf]!;
        const cls = sig.state === 'long' ? 'bg-qqe--long' : 'bg-qqe--short';
        const title =
          `${label}: QQE ${sig.state === 'long' ? 'Long' : 'Short'}` +
          (sig.barsSince === 0 ? ' · vừa xuất hiện' : ` · ${sig.barsSince} nến trước`);
        return (
          <span key={tf} className={`bg-qqe-tf-badge ${cls}`} title={title}>
            {label}
          </span>
        );
      })}
    </div>
  );
}
