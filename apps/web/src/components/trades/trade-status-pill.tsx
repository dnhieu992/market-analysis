type TradeStatusPillProps = Readonly<{
  status: string;
}>;

export function TradeStatusPill({ status }: TradeStatusPillProps) {
  const normalizedStatus = status.toLowerCase();
  const pillClass =
    normalizedStatus === 'open'
      ? 'trade-status-pill trade-status-pill-open'
      : normalizedStatus === 'closed'
        ? 'trade-status-pill trade-status-pill-closed'
        : 'trade-status-pill';

  return <span className={pillClass}>{status}</span>;
}
