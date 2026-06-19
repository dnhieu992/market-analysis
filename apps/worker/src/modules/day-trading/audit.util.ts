import type { Logger } from '@nestjs/common';

export type AuditAction =
  | 'SCAN_START'
  | 'SETUP_DETECTED'
  | 'SETUP_SKIPPED'
  | 'ORDER_PLACED'
  | 'ORDER_FAILED'
  | 'BE_MOVED'
  | 'CLOSED'
  | 'MANUAL_CLOSE'
  | 'RECONCILE_FIX';

type LogActionInput = {
  action: AuditAction;
  signalId?: string | null;
  symbol?: string | null;
  message: string;
  detailJson?: string | null;
};

type AuditRepo = { logAction: (data: LogActionInput) => Promise<unknown> };

/**
 * Fire-and-forget audit write. Persisting the trail must NEVER break the trading
 * flow, so failures are swallowed (logged as a warning) and the call does not
 * block the caller — pass `detail` as a plain object and it's JSON-stringified.
 */
export function audit(
  repo: AuditRepo,
  logger: Logger,
  entry: Omit<LogActionInput, 'detailJson'> & { detail?: unknown },
): void {
  const { detail, ...rest } = entry;
  void repo
    .logAction({ ...rest, detailJson: detail != null ? safeStringify(detail) : null })
    .catch((err) => logger.warn(`audit log (${entry.action}) failed: ${err instanceof Error ? err.message : String(err)}`));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
