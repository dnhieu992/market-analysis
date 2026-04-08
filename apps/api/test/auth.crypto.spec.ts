import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from '../src/modules/auth/auth.crypto';

describe('auth crypto helpers', () => {
  it('hashes and verifies passwords', async () => {
    const passwordHash = await hashPassword('S3curePassword!');

    await expect(verifyPassword('S3curePassword!', passwordHash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', passwordHash)).resolves.toBe(false);
  });

  it('creates a raw session token and stores only its hash', () => {
    const session = createSessionToken();

    expect(session.token).toEqual(expect.any(String));
    expect(session.token.length).toBeGreaterThan(20);
    expect(session.tokenHash).toBe(hashSessionToken(session.token));
    expect(session.tokenHash).not.toBe(session.token);
  });
});
