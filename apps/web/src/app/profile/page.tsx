import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { UserProfile } from '@web/shared/api/types';
import { ProfilePage } from '@web/pages/profile-page/profile-page';

async function loadProfile(): Promise<UserProfile | null> {
  const client = createServerApiClient();
  try {
    return await client.fetchUserProfile();
  } catch {
    return null;
  }
}

export default async function Page() {
  const profile = await loadProfile();
  return <ProfilePage initial={profile} />;
}
