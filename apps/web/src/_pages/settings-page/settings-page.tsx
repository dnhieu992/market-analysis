import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { TrackingSettings } from '@web/shared/api/types';
import { SettingsFeed } from '@web/widgets/settings-feed/settings-feed';

async function loadSettings(): Promise<TrackingSettings | null> {
  const client = createServerApiClient();
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
