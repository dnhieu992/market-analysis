/** Date helpers shared by the journal editor and the read-only entry dialog. */

/** Entries are keyed by UTC day — the same "today" the editor defaults to. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `2026-08-10` → `Chủ Nhật, 10/08/2026`. Rendered in UTC so it matches the entry key. */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
