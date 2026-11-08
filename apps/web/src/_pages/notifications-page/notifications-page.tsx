import type { NotificationPage } from '@web/shared/api/types';
import { createServerApiClient } from '@web/shared/auth/api-auth';
import { NotificationsView } from '@web/widgets/notifications/notifications-view';

/** /notifications — order fills on Bitget + MEXC (also pushed to Telegram by the worker). */
export default async function NotificationsPage() {
  const initial = await createServerApiClient()
    .fetchNotifications({ limit: 30 })
    .catch((): NotificationPage | null => null);
  return <NotificationsView initial={initial} />;
}
