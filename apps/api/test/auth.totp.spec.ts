import { base32Decode, base32Encode, matchTotp, totpCode } from '../src/modules/auth/auth.totp';
import { LoginLimiter } from '../src/modules/auth/login-limiter';

describe('TOTP', () => {
  // RFC 6238 appendix B, SHA-1 seed "12345678901234567890".
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('round-trips base32', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });

  it('matches the RFC test vectors (last 6 digits)', () => {
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(1234567890 / 30))).toBe('005924');
  });

  it('accepts ±1 step of drift and nothing further', () => {
    const now = new Date(1234567890 * 1000);
    const step = Math.floor(1234567890 / 30);
    expect(matchTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, totpCode(secret, step + 1), now)).toBe(step + 1);
    expect(matchTotp(secret, totpCode(secret, step - 2), now)).toBeNull();
    expect(matchTotp(secret, 'abcdef', now)).toBeNull();
  });
});

describe('LoginLimiter', () => {
  it('locks on the 5th failure and unlocks when the window passes', () => {
    const limiter = new LoginLimiter(5, 15 * 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) expect(limiter.fail('ip:x', t0 + i)).toBe(false);
    expect(limiter.lockedFor('ip:x', t0 + 10)).toBe(0);
    expect(limiter.fail('ip:x', t0 + 5)).toBe(true);
    expect(limiter.lockedFor('ip:x', t0 + 10)).toBeGreaterThan(14 * 60_000);
    expect(limiter.lockedFor('ip:x', t0 + 15 * 60_000 + 10)).toBe(0);
  });

  it('reset clears the counter', () => {
    const limiter = new LoginLimiter(2, 60_000);
    limiter.fail('k', 1);
    limiter.reset('k');
    expect(limiter.fail('k', 2)).toBe(false);
  });
});
