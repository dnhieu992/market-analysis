import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SCRYPT_KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;

  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [salt, key] = passwordHash.split(':');

  if (!salt || !key) {
    return false;
  }

  const derivedKey = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  const keyBuffer = Buffer.from(key, 'hex');

  if (derivedKey.length !== keyBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, keyBuffer);
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionToken() {
  const token = randomBytes(32).toString('hex');

  return {
    token,
    tokenHash: hashSessionToken(token)
  };
}
