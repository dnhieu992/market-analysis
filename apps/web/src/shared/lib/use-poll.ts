'use client';

import { useEffect, useRef } from 'react';

/** What every live feed on the dashboard runs at — the same cadence the Bitget and MEXC feeds use. */
export const DASHBOARD_POLL_MS = 15_000;

/**
 * Runs `task` on an interval, with two rules that keep a background tab from doing pointless work:
 * ticks are skipped while the document is hidden, and one fires immediately when it becomes
 * visible again — so a tab left open for an hour shows fresh numbers the moment it is looked at
 * rather than up to a full interval of stale ones.
 *
 * `task` is held in a ref, so a caller can pass an inline closure without restarting the timer on
 * every render.
 */
export function usePoll(task: () => void, intervalMs: number): void {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    function run() {
      if (!document.hidden) taskRef.current();
    }

    const id = setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', run);
    };
  }, [intervalMs]);
}
