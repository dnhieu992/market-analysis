import { HttpException, UnauthorizedException } from '@nestjs/common';

import { hashBackupCode, hashPassword, hashSessionToken } from '../src/modules/auth/auth.crypto';
import { AuthService, type RequestContext } from '../src/modules/auth/auth.service';
import { totpCode, totpStep } from '../src/modules/auth/auth.totp';

type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
  totpLastStep: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/** In-memory stand-ins for the three repositories the service uses. */
function createFakes() {
  const users = new Map<string, User>();
  const sessions: Array<{ id: string; userId: string; tokenHash: string; expiresAt: Date; createdAt: Date; lastUsedAt: Date; userAgent?: string | null; ip?: string | null }> = [];
  const backupCodes: Array<{ userId: string; codeHash: string; usedAt: Date | null }> = [];
  const devices: Array<{ id: string; userId: string; tokenHash: string; expiresAt: Date; createdAt: Date; lastUsedAt: Date }> = [];
  let seq = 0;

  const userRepository = {
    findByEmail: async (email: string) => [...users.values()].find((u) => u.email === email) ?? null,
    findById: async (id: string) => users.get(id) ?? null,
    setPassword: async (id: string, passwordHash: string, mustChangePassword: boolean, changedAt: Date) =>
      Object.assign(users.get(id)!, { passwordHash, mustChangePassword, passwordChangedAt: changedAt }),
    enableTotp: async (id: string, totpSecretEnc: string, enabledAt: Date, lastStep: number) =>
      Object.assign(users.get(id)!, { totpSecretEnc, totpEnabledAt: enabledAt, totpLastStep: lastStep }),
    claimTotpStep: async (id: string, step: number) => {
      const u = users.get(id)!;
      if (u.totpLastStep !== null && u.totpLastStep >= step) return false;
      u.totpLastStep = step;
      return true;
    }
  };
  const sessionRepository = {
    create: async (data: { userId: string; tokenHash: string; expiresAt: Date }) => {
      const row = { id: `s${++seq}`, createdAt: now, lastUsedAt: now, ...data };
      sessions.push(row);
      return row;
    },
    findValidByTokenHash: async (tokenHash: string) => {
      const s = sessions.find((x) => x.tokenHash === tokenHash);
      return s ? { ...s, user: users.get(s.userId) } : null;
    },
    deleteByTokenHash: jest.fn(async () => ({ count: 1 })),
    touch: jest.fn(async () => ({})),
    deleteOthers: async (userId: string, keepId: string | null) => {
      const before = sessions.length;
      for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i]!.userId === userId && sessions[i]!.id !== keepId) sessions.splice(i, 1);
      return { count: before - sessions.length };
    }
  };
  const deviceRepository = {
    replaceBackupCodes: async (userId: string, hashes: string[]) => {
      for (let i = backupCodes.length - 1; i >= 0; i--) if (backupCodes[i]!.userId === userId) backupCodes.splice(i, 1);
      backupCodes.push(...hashes.map((codeHash) => ({ userId, codeHash, usedAt: null })));
    },
    useBackupCode: async (userId: string, codeHash: string, usedAt: Date) => {
      const row = backupCodes.find((b) => b.userId === userId && b.codeHash === codeHash && !b.usedAt);
      if (!row) return false;
      row.usedAt = usedAt;
      return true;
    },
    countUnusedBackupCodes: async (userId: string) => backupCodes.filter((b) => b.userId === userId && !b.usedAt).length,
    createTrustedDevice: async (data: { userId: string; tokenHash: string; expiresAt: Date }) => {
      const row = { id: `d${++seq}`, createdAt: now, lastUsedAt: now, ...data };
      devices.push(row);
      return row;
    },
    findTrustedDevice: async (tokenHash: string) => devices.find((d) => d.tokenHash === tokenHash) ?? null,
    touchTrustedDevice: async () => ({})
  };

  return { users, sessions, backupCodes, devices, userRepository, sessionRepository, deviceRepository };
}

let now = new Date('2026-04-08T00:00:00.000Z');
const ctx: RequestContext = { ip: '1.2.3.4', userAgent: 'jest', deviceToken: null };

describe('AuthService', () => {
  let fakes: ReturnType<typeof createFakes>;
  let service: AuthService;
  let alerts: string[];

  beforeAll(() => {
    process.env.AUTH_ENC_KEY = 'test-key-test-key-test-key-test-key-0123';
  });

  beforeEach(async () => {
    now = new Date('2026-04-08T00:00:00.000Z');
    fakes = createFakes();
    alerts = [];
    fakes.users.set('user-1', {
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice',
      passwordHash: await hashPassword('super-admin'),
      mustChangePassword: true,
      passwordChangedAt: null,
      totpSecretEnc: null,
      totpEnabledAt: null,
      totpLastStep: null,
      createdAt: now,
      updatedAt: now
    });
    const telegram = { sendMessage: async (text: string) => { alerts.push(text); return { success: true }; } };
    service = new AuthService(
      fakes.userRepository as never,
      fakes.sessionRepository as never,
      fakes.deviceRepository as never,
      { cookieName: 'market_analysis_session', sessionTtlDays: 7, now: () => now },
      telegram as never
    );
  });

  /** Temp password → new password → TOTP enrollment; returns the base32 secret. */
  async function enroll(trustDevice = false) {
    const first = await service.login({ email: 'alice@example.com', password: 'super-admin' }, ctx);
    if (first.step !== 'change-password') throw new Error(`unexpected ${first.step}`);
    const second = await service.completePasswordChange(first.challenge, 'N3w-strong-pass', ctx);
    if (second.step !== 'enroll-totp') throw new Error(`unexpected ${second.step}`);
    const { secret } = await service.startTotpSetup(second.challenge, ctx);
    const done = await service.confirmTotpSetup(second.challenge, totpCode(secret, totpStep(now)), trustDevice, ctx);
    return { secret, done };
  }

  it('rejects an unknown email and a wrong password alike', async () => {
    await expect(service.login({ email: 'nobody@example.com', password: 'whatever1' }, ctx)).rejects.toThrow(UnauthorizedException);
    await expect(service.login({ email: 'alice@example.com', password: 'wrong-password' }, ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('locks after 5 failures, even for the right password, and alerts once', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(service.login({ email: 'alice@example.com', password: 'wrong-password' }, ctx)).rejects.toThrow(UnauthorizedException);
    }
    await expect(service.login({ email: 'alice@example.com', password: 'super-admin' }, ctx)).rejects.toThrow(HttpException);
    expect(alerts.filter((a) => a.includes('khoá'))).toHaveLength(1);

    now = new Date(now.getTime() + 16 * 60_000);
    await expect(service.login({ email: 'alice@example.com', password: 'super-admin' }, ctx)).resolves.toMatchObject({ step: 'change-password' });
  });

  it('forces a new password that is long enough and not the temporary one', async () => {
    const first = await service.login({ email: 'alice@example.com', password: 'super-admin' }, ctx);
    if (first.step !== 'change-password') throw new Error('expected change-password');
    await expect(service.completePasswordChange(first.challenge, 'short', ctx)).rejects.toThrow(/10–128/);
    await expect(service.completePasswordChange(first.challenge, 'super-admin', ctx)).rejects.toThrow(/khác mật khẩu cũ/);
    await expect(service.completePasswordChange(first.challenge, 'N3w-strong-pass', ctx)).resolves.toMatchObject({ step: 'enroll-totp' });
    expect(fakes.users.get('user-1')!.mustChangePassword).toBe(false);
  });

  it('enrolls TOTP, signs in and hands out 10 backup codes', async () => {
    const { secret, done } = await enroll();
    expect(done).toMatchObject({ step: 'done', user: { id: 'user-1' } });
    if (done.step !== 'done') throw new Error('expected done');
    expect(done.backupCodes).toHaveLength(10);
    expect(done.device).toBeUndefined();
    // Stored encrypted, never as the plain base32 secret.
    expect(fakes.users.get('user-1')!.totpSecretEnc).not.toContain(secret);
    expect(fakes.sessions).toHaveLength(1);
  });

  it('rejects a wrong enrollment code without enabling 2FA', async () => {
    const first = await service.login({ email: 'alice@example.com', password: 'super-admin' }, ctx);
    if (first.step !== 'change-password') throw new Error('expected change-password');
    const second = await service.completePasswordChange(first.challenge, 'N3w-strong-pass', ctx);
    if (second.step !== 'enroll-totp') throw new Error('expected enroll-totp');
    await service.startTotpSetup(second.challenge, ctx);
    await expect(service.confirmTotpSetup(second.challenge, '000000', false, ctx)).rejects.toThrow(UnauthorizedException);
    expect(fakes.users.get('user-1')!.totpEnabledAt).toBeNull();
  });

  it('asks for a code on the next login and refuses to reuse one', async () => {
    const { secret } = await enroll();
    now = new Date(now.getTime() + 60_000);

    const step = await service.login({ email: 'alice@example.com', password: 'N3w-strong-pass' }, ctx);
    if (step.step !== 'totp') throw new Error(`expected totp, got ${step.step}`);
    const code = totpCode(secret, totpStep(now));
    await expect(service.verifySecondFactor(step.challenge, code, false, ctx)).resolves.toMatchObject({ step: 'done' });

    const again = await service.login({ email: 'alice@example.com', password: 'N3w-strong-pass' }, ctx);
    if (again.step !== 'totp') throw new Error('expected totp');
    await expect(service.verifySecondFactor(again.challenge, code, false, ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a backup code exactly once', async () => {
    const { done } = await enroll();
    if (done.step !== 'done') throw new Error('expected done');
    const backup = done.backupCodes![0]!;

    const a = await service.login({ email: 'alice@example.com', password: 'N3w-strong-pass' }, ctx);
    if (a.step !== 'totp') throw new Error('expected totp');
    await expect(service.verifySecondFactor(a.challenge, backup.toUpperCase(), false, ctx)).resolves.toMatchObject({ step: 'done' });

    const b = await service.login({ email: 'alice@example.com', password: 'N3w-strong-pass' }, ctx);
    if (b.step !== 'totp') throw new Error('expected totp');
    await expect(service.verifySecondFactor(b.challenge, backup, false, ctx)).rejects.toThrow(UnauthorizedException);
    expect(fakes.backupCodes.find((c) => c.codeHash === hashBackupCode(backup))!.usedAt).not.toBeNull();
  });

  it('skips the code on a trusted device', async () => {
    const { done } = await enroll(true);
    if (done.step !== 'done' || !done.device) throw new Error('expected a trusted device');
    const trusted = { ...ctx, deviceToken: done.device.token };

    await expect(service.login({ email: 'alice@example.com', password: 'N3w-strong-pass' }, trusted)).resolves.toMatchObject({ step: 'done' });
    // Another browser still needs the code.
    await expect(service.login({ email: 'alice@example.com', password: 'N3w-strong-pass' }, ctx)).resolves.toMatchObject({ step: 'totp' });
  });

  it('slides the idle expiry but caps the session at 30 days', async () => {
    const { done } = await enroll();
    if (done.step !== 'done') throw new Error('expected done');

    now = new Date('2026-04-10T00:00:00.000Z');
    await service.authenticate(done.session.token);
    expect(fakes.sessionRepository.touch).toHaveBeenLastCalledWith(expect.any(String), now, new Date('2026-04-17T00:00:00.000Z'));

    const row = fakes.sessions[0]!;
    row.expiresAt = new Date('2026-05-30T00:00:00.000Z');
    now = new Date('2026-05-06T00:00:00.000Z');
    await service.authenticate(done.session.token);
    expect(fakes.sessionRepository.touch).toHaveBeenLastCalledWith(row.id, now, new Date('2026-05-08T00:00:00.000Z'));
  });

  it('rejects an expired session token', async () => {
    const { done } = await enroll();
    if (done.step !== 'done') throw new Error('expected done');
    fakes.sessions[0]!.expiresAt = new Date(now.getTime() - 1);
    await expect(service.authenticate(done.session.token)).rejects.toThrow(UnauthorizedException);
  });

  it('deletes the active session on logout', async () => {
    await service.logout('raw-session-token');

    expect(fakes.sessionRepository.deleteByTokenHash).toHaveBeenCalledWith(hashSessionToken('raw-session-token'));
  });
});
