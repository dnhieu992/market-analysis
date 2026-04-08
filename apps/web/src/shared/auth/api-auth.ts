import { headers } from 'next/headers';

import { createApiClient } from '@web/shared/api/client';

export function createServerApiClient() {
  const cookie = headers().get('cookie');

  return createApiClient({
    headers: cookie ? { cookie } : undefined
  });
}
