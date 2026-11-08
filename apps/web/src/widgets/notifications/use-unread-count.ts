'use client';

import { useCallback, useEffect, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';

const api = createApiClient();
const POLL_MS = 30_000;

/** Fired after the user reads notifications so every badge refreshes at once. */
export const NOTIFICATIONS_CHANGED_EVENT = 'app:notifications-changed';

export function notifyNotificationsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

/** Unread notification count, polled every 30s (paused while the tab is hidden). */
export function useUnreadNotificationCount(): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    api
      .fetchNotificationUnreadCount()
      .then(setCount)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refresh]);

  return count;
}
