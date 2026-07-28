/**
 * Monochrome candlestick-chart icon — inherits text colour via `currentColor`.
 * Shared by every /mexc tab so the "open the chart" affordance next to a coin
 * name looks identical in Positions, Setup and History.
 */
export function ChartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <rect x="7" y="10" width="3" height="6" rx="0.5" />
      <path d="M8.5 7v3M8.5 16v2" />
      <rect x="14" y="7" width="3" height="8" rx="0.5" />
      <path d="M15.5 4v3M15.5 15v2" />
    </svg>
  );
}
