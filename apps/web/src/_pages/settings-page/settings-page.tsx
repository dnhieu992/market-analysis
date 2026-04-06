import { createApiClient } from '@web/shared/api/client';
import type { TrackingSettings } from '@web/shared/api/types';
import { SettingsFeed } from '@web/widgets/settings-feed/settings-feed';

async function loadSettings(): Promise<TrackingSettings | null> {
  const client = createApiClient();
  try {
    return await client.fetchSettings();
  } catch {
    return null;
  }
}

export default async function SettingsPage() {
  const settings = await loadSettings();
  return <SettingsFeed initial={settings} />;
}
