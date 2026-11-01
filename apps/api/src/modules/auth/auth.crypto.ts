import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
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

/** Random opaque token plus its sha256 — the hash is what gets stored. */
export function createOpaqueToken() {
  return createSessionToken();
}

const BACKUP_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** `xxxx-xxxx` recovery code (~39 bits); stored only as a hash. */
export function createBackupCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += BACKUP_CODE_ALPHABET[bytes[i]! % BACKUP_CODE_ALPHABET.length];
  }
  return out;
}

export function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(`backup:${normalizeBackupCode(code)}`).digest('hex');
}

function encryptionKey(): Buffer {
  const raw = (process.env.AUTH_ENC_KEY ?? '').trim();
  if (raw.length < 32) {
    throw new Error('AUTH_ENC_KEY is missing or shorter than 32 characters');
  }
  return createHash('sha256').update(raw).digest();
}

/** AES-256-GCM `iv:tag:ciphertext` (hex) — used for the TOTP secret at rest. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join(':');
}

export function decryptSecret(payload: string): string {
  const [iv, tag, ciphertext] = payload.split(':');
  if (!iv || !tag || !ciphertext) {
    throw new Error('Malformed encrypted secret');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8');
}
