type OrderStatusPillProps = Readonly<{
  status: string;
}>;

export function OrderStatusPill({ status }: OrderStatusPillProps) {
  const normalizedStatus = status.toLowerCase();
  const pillClass =
    normalizedStatus === 'open'
      ? 'trade-status-pill trade-status-pill-open'
      : normalizedStatus === 'closed'
        ? 'trade-status-pill trade-status-pill-closed'
        : 'trade-status-pill';

  return <span className={pillClass}>{status}</span>;
}
