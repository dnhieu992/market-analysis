/**
 * A partial coin transfer between portfolios is booked as a sell/buy pair at average
 * cost (see `HoldingsService.transferPartial`). Both rows carry this note prefix — the
 * same literal as `TRANSFER_NOTE_PREFIX` in `apps/api/src/modules/holdings/holdings.service.ts`,
 * duplicated because the web app does not depend on the API's packages.
 */
export const TRANSFER_NOTE_PREFIX = '[transfer]';

/** True for either leg of a partial transfer — a bookkeeping move, not a trade. */
export function isTransferTransaction(tx: { note?: string | null }): boolean {
  return Boolean(tx.note?.startsWith(TRANSFER_NOTE_PREFIX));
}
