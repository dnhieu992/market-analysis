import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException
} from '@nestjs/common';
import { createAuthDeviceRepository, createSessionRepository, createUserRepository } from '@app/db';

import { AUTH_DEVICE_REPOSITORY, SESSION_REPOSITORY, USER_REPOSITORY } from '../database/database.providers';
import { TelegramService } from '../telegram/telegram.service';
import {
  createBackupCode,
  createOpaqueToken,
  createSessionToken,
  decryptSecret,
  encryptSecret,
  hashBackupCode,
  hashPassword,
  hashSessionToken,
  verifyPassword
} from './auth.crypto';
import {
  AUTH_COOKIE_NAME,
  AUTH_OPTIONS,
  BACKUP_CODE_COUNT,
  LOGIN_CHALLENGE_TTL_MS,
  MAX_LOGIN_FAILURES,
  MIN_PASSWORD_LENGTH,
  SESSION_MAX_DAYS,
  SESSION_TTL_DAYS,
  TRUSTED_DEVICE_DAYS
} from './auth.constants';
import { generateTotpSecret, matchTotp, otpauthUrl } from './auth.totp';
import type { AuthUser } from './auth.types';
import { LoginLimiter } from './login-limiter';

type UserRepository = ReturnType<typeof createUserRepository>;
type SessionRepository = ReturnType<typeof createSessionRepository>;
type AuthDeviceRepository = ReturnType<typeof createAuthDeviceRepository>;
type UserRow = NonNullable<Awaited<ReturnType<UserRepository['findById']>>>;

type AuthServiceOptions = {
  cookieName?: string;
  sessionTtlDays?: number;
  now?: () => Date;
};

/** Who is asking — recorded on sessions/devices and used for rate limiting. */
export type RequestContext = {
  ip: string | null;
  userAgent: string | null;
  /** Raw trusted-device cookie, when the browser sent one. */
  deviceToken: string | null;
};

type ChallengeStage = 'change-password' | 'enroll-totp' | 'totp';

type Challenge = {
  userId: string;
  email: string;
  stage: ChallengeStage;
  /** Secret shown as QR during enrollment; saved only once a code proves it. */
  pendingSecret?: string;
  attempts: number;
  expiresAt: number;
};

export type IssuedToken = { token: string; expiresAt: Date };

export type LoginStep =
  | { step: ChallengeStage; challenge: string }
  | {
      step: 'done';
      user: AuthUser;
      session: IssuedToken;
      /** Set when the browser asked to be trusted. */
      device?: IssuedToken;
      /** Shown once, right after 2FA is turned on. */
      backupCodes?: string[];
    };

/** Constant-time-ish stand-in so an unknown email costs as much as a wrong password. */
const DUMMY_PASSWORD_HASH =
  '00000000000000000000000000000000:' + '0'.repeat(128);

const TEMP_PASSWORDS = new Set(['super-admin']);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly cookieName: string;
  private readonly sessionTtlDays: number;
  private readonly now: () => Date;
  private readonly limiter = new LoginLimiter();
  private readonly challenges = new Map<string, Challenge>();

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    @Inject(SESSION_REPOSITORY)
    private readonly sessionRepository: SessionRepository,
    @Inject(AUTH_DEVICE_REPOSITORY)
    private readonly deviceRepository: AuthDeviceRepository,
    @Optional()
    @Inject(AUTH_OPTIONS)
    options: AuthServiceOptions = {},
    @Optional()
    private readonly telegram?: TelegramService
  ) {
    this.cookieName = options.cookieName ?? process.env.SESSION_COOKIE_NAME ?? AUTH_COOKIE_NAME;
    this.sessionTtlDays = options.sessionTtlDays ?? Number(process.env.SESSION_TTL_DAYS ?? SESSION_TTL_DAYS);
    this.now = options.now ?? (() => new Date());
  }

  get sessionCookieName(): string {
    return this.cookieName;
  }

  // ── Login flow ────────────────────────────────────────────────────────

  /** Step 1: email + password. Returns the next step (or a session on a trusted device). */
  async login(input: { email: string; password: string }, ctx: RequestContext): Promise<LoginStep> {
    const email = input.email.trim().toLowerCase();
    const user = await this.userRepository.findByEmail(email);
    const trustedDevice = user ? await this.findTrustedDevice(user.id, ctx.deviceToken) : null;
    // A trusted browser can't be locked out by someone hammering the email from elsewhere.
    this.assertNotLocked(ctx.ip, trustedDevice ? null : email);

    const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk) {
      this.recordFailure(ctx, email, 'mật khẩu');
      throw new UnauthorizedException('Sai email hoặc mật khẩu');
    }
    this.clearFailures(ctx, email);

    if (user.mustChangePassword) return this.openChallenge(user, 'change-password');
    if (!user.totpEnabledAt || !user.totpSecretEnc) return this.openChallenge(user, 'enroll-totp');
    if (trustedDevice) {
      await this.deviceRepository.touchTrustedDevice(trustedDevice.id, this.now());
      return this.finishLogin(user, ctx, { trustDevice: false, viaTrustedDevice: true });
    }
    return this.openChallenge(user, 'totp');
  }

  /** Forced change of a temporary password, before 2FA. */
  async completePasswordChange(challengeToken: string, newPassword: string, ctx: RequestContext): Promise<LoginStep> {
    const { challenge, user } = await this.takeChallenge(challengeToken, 'change-password', ctx);
    await this.assertNewPassword(user, newPassword);
    await this.userRepository.setPassword(user.id, await hashPassword(newPassword), false, this.now());
    this.challenges.delete(hashSessionToken(challengeToken));
    void this.alert(`🔑 Đã đổi mật khẩu tạm thành mật khẩu mới.${this.where(ctx)}`);

    const fresh = await this.requireUser(challenge.userId);
    if (!fresh.totpEnabledAt || !fresh.totpSecretEnc) return this.openChallenge(fresh, 'enroll-totp');
    return this.openChallenge(fresh, 'totp');
  }

  /** Generates (or re-shows) the secret the authenticator app should scan. */
  async startTotpSetup(challengeToken: string, ctx: RequestContext): Promise<{ secret: string; otpauthUrl: string }> {
    const { challenge } = await this.takeChallenge(challengeToken, 'enroll-totp', ctx);
    challenge.pendingSecret ??= generateTotpSecret();
    return { secret: challenge.pendingSecret, otpauthUrl: otpauthUrl(challenge.pendingSecret, challenge.email) };
  }

  /** Proves the scan with a first code, turns 2FA on and hands out backup codes. */
  async confirmTotpSetup(
    challengeToken: string,
    code: string,
    trustDevice: boolean,
    ctx: RequestContext
  ): Promise<LoginStep> {
    const { challenge, user } = await this.takeChallenge(challengeToken, 'enroll-totp', ctx);
    if (!challenge.pendingSecret) throw new BadRequestException('Chưa tạo mã QR');
    const step = matchTotp(challenge.pendingSecret, code, this.now());
    if (step === null) return this.failCode(challengeToken, challenge, ctx);

    await this.userRepository.enableTotp(user.id, encryptSecret(challenge.pendingSecret), this.now(), step);
    const backupCodes = await this.issueBackupCodes(user.id);
    this.challenges.delete(hashSessionToken(challengeToken));
    this.clearFailures(ctx, challenge.email);
    void this.alert(`🛡 Đã bật xác thực 2 lớp (TOTP).${this.where(ctx)}`);

    const done = await this.finishLogin(await this.requireUser(user.id), ctx, { trustDevice, viaTrustedDevice: false });
    return { ...done, backupCodes };
  }

  /** Step 2 on an untrusted browser: a 6-digit TOTP code or a backup code. */
  async verifySecondFactor(
    challengeToken: string,
    code: string,
    trustDevice: boolean,
    ctx: RequestContext
  ): Promise<LoginStep> {
    const { challenge, user } = await this.takeChallenge(challengeToken, 'totp', ctx);
    const usedBackup = await this.checkSecondFactor(user, code);
    if (usedBackup === null) return this.failCode(challengeToken, challenge, ctx);

    this.challenges.delete(hashSessionToken(challengeToken));
    this.clearFailures(ctx, challenge.email);
    if (usedBackup) {
      const left = await this.deviceRepository.countUnusedBackupCodes(user.id);
      void this.alert(`🧯 Đăng nhập bằng backup code — còn ${left} mã.${this.where(ctx)}`);
    }
    return this.finishLogin(user, ctx, { trustDevice, viaTrustedDevice: false });
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  async authenticate(sessionToken: string): Promise<{ user: AuthUser; sessionId: string }> {
    if (!sessionToken) {
      throw new UnauthorizedException('Authentication required');
    }

    const session = await this.sessionRepository.findValidByTokenHash(hashSessionToken(sessionToken));
    const now = this.now();

    if (!session || !session.user || session.expiresAt.getTime() <= now.getTime()) {
      throw new UnauthorizedException('Authentication required');
    }

    // Idle expiry slides forward on use, capped at SESSION_MAX_DAYS after login.
    const idleExpiry = addDays(now, this.sessionTtlDays);
    const hardExpiry = addDays(session.createdAt ?? now, SESSION_MAX_DAYS);
    const expiresAt = idleExpiry < hardExpiry ? idleExpiry : hardExpiry;
    await this.sessionRepository.touch(session.id, now, expiresAt);

    return { user: this.toAuthUser(session.user), sessionId: session.id };
  }

  async getAuthenticatedUser(sessionToken: string): Promise<AuthUser> {
    return (await this.authenticate(sessionToken)).user;
  }

  async logout(sessionToken: string | null | undefined): Promise<void> {
    if (!sessionToken) {
      return;
    }

    await this.sessionRepository.deleteByTokenHash(hashSessionToken(sessionToken));
  }

  async listSessions(userId: string, currentSessionId: string | null) {
    const rows = await this.sessionRepository.listActiveByUser(userId, this.now());
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent ?? null,
      ip: s.ip ?? null,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      current: s.id === currentSessionId
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.sessionRepository.deleteForUser(userId, sessionId);
    if (result.count === 0) throw new NotFoundException('Không tìm thấy phiên đăng nhập');
  }

  /** Logs out every other session and forgets every other trusted browser. */
  async revokeOtherSessions(userId: string, currentSessionId: string, ctx: RequestContext): Promise<{ sessions: number; devices: number }> {
    const keepDevice = await this.findTrustedDevice(userId, ctx.deviceToken);
    const sessions = await this.sessionRepository.deleteOthers(userId, currentSessionId);
    const devices = await this.deviceRepository.deleteOtherTrustedDevices(userId, keepDevice?.id ?? null);
    void this.alert(`🚪 Đã đăng xuất ${sessions.count} phiên và bỏ tin cậy ${devices.count} thiết bị khác.${this.where(ctx)}`);
    return { sessions: sessions.count, devices: devices.count };
  }

  async listTrustedDevices(userId: string, ctx: RequestContext) {
    const current = await this.findTrustedDevice(userId, ctx.deviceToken);
    const rows = await this.deviceRepository.listTrustedDevices(userId, this.now());
    return rows.map((d) => ({
      id: d.id,
      userAgent: d.userAgent ?? null,
      ip: d.ip ?? null,
      createdAt: d.createdAt,
      lastUsedAt: d.lastUsedAt,
      expiresAt: d.expiresAt,
      current: d.id === current?.id
    }));
  }

  async revokeTrustedDevice(userId: string, deviceId: string): Promise<void> {
    const result = await this.deviceRepository.deleteTrustedDevice(userId, deviceId);
    if (result.count === 0) throw new NotFoundException('Không tìm thấy thiết bị');
  }

  // ── Account security (signed in) ──────────────────────────────────────

  async getSecurity(userId: string) {
    const user = await this.requireUser(userId);
    return {
      totpEnabledAt: user.totpEnabledAt ?? null,
      backupCodesRemaining: await this.deviceRepository.countUnusedBackupCodes(userId),
      passwordChangedAt: user.passwordChangedAt ?? null
    };
  }

  /** Needs the current password and a 2FA code; logs out every other session. */
  async changePassword(
    userId: string,
    currentSessionId: string,
    input: { currentPassword: string; newPassword: string; code: string },
    ctx: RequestContext
  ): Promise<void> {
    const user = await this.requireUser(userId);
    this.assertNotLocked(ctx.ip, user.email);
    const passwordOk = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!passwordOk || (await this.checkSecondFactor(user, input.code)) === null) {
      this.recordFailure(ctx, user.email, 'đổi mật khẩu');
      throw new UnauthorizedException('Mật khẩu hiện tại hoặc mã xác thực không đúng');
    }
    this.clearFailures(ctx, user.email);
    await this.assertNewPassword(user, input.newPassword);
    await this.userRepository.setPassword(user.id, await hashPassword(input.newPassword), false, this.now());
    const { count } = await this.sessionRepository.deleteOthers(user.id, currentSessionId);
    void this.alert(`🔑 Đã đổi mật khẩu, đăng xuất ${count} phiên khác.${this.where(ctx)}`);
  }

  /** Replaces the backup codes after a fresh TOTP code. */
  async regenerateBackupCodes(userId: string, code: string, ctx: RequestContext): Promise<string[]> {
    const user = await this.requireUser(userId);
    this.assertNotLocked(ctx.ip, user.email);
    if (!user.totpSecretEnc || (await this.checkTotpOnly(user, code)) === false) {
      this.recordFailure(ctx, user.email, 'tạo lại backup code');
      throw new UnauthorizedException('Mã xác thực không đúng');
    }
    this.clearFailures(ctx, user.email);
    const codes = await this.issueBackupCodes(user.id);
    void this.alert(`🧾 Đã tạo lại ${codes.length} backup code (mã cũ hết hiệu lực).${this.where(ctx)}`);
    return codes;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private openChallenge(user: UserRow, stage: ChallengeStage): LoginStep {
    this.pruneChallenges();
    const { token, tokenHash } = createSessionToken();
    this.challenges.set(tokenHash, {
      userId: user.id,
      email: user.email,
      stage,
      attempts: 0,
      expiresAt: this.now().getTime() + LOGIN_CHALLENGE_TTL_MS
    });
    return { step: stage, challenge: token };
  }

  private async takeChallenge(token: string, stage: ChallengeStage, ctx: RequestContext) {
    const challenge = token ? this.challenges.get(hashSessionToken(token)) : undefined;
    if (!challenge || challenge.stage !== stage || challenge.expiresAt <= this.now().getTime()) {
      throw new UnauthorizedException('Phiên đăng nhập đã hết hạn, hãy nhập lại mật khẩu');
    }
    this.assertNotLocked(ctx.ip, challenge.email);
    return { challenge, user: await this.requireUser(challenge.userId) };
  }

  /** Wrong code: counts against the limiter and burns the challenge after MAX_LOGIN_FAILURES tries. */
  private failCode(token: string, challenge: Challenge, ctx: RequestContext): never {
    challenge.attempts += 1;
    if (challenge.attempts >= MAX_LOGIN_FAILURES) this.challenges.delete(hashSessionToken(token));
    this.recordFailure(ctx, challenge.email, 'mã 2FA');
    throw new UnauthorizedException('Mã xác thực không đúng');
  }

  private pruneChallenges(): void {
    const nowMs = this.now().getTime();
    for (const [key, c] of this.challenges) if (c.expiresAt <= nowMs) this.challenges.delete(key);
  }

  /** null = wrong; false = TOTP code accepted; true = a backup code was burned. */
  private async checkSecondFactor(user: UserRow, code: string): Promise<boolean | null> {
    if (!user.totpSecretEnc) return null;
    if (/^\s*\d{6}\s*$/.test(code)) return (await this.checkTotpOnly(user, code)) ? false : null;
    const used = await this.deviceRepository.useBackupCode(user.id, hashBackupCode(code), this.now());
    return used ? true : null;
  }

  private async checkTotpOnly(user: UserRow, code: string): Promise<boolean> {
    if (!user.totpSecretEnc) return false;
    const step = matchTotp(decryptSecret(user.totpSecretEnc), code, this.now());
    if (step === null) return false;
    // Replay guard: each 30 s code works once.
    return this.userRepository.claimTotpStep(user.id, step);
  }

  private async issueBackupCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => createBackupCode());
    await this.deviceRepository.replaceBackupCodes(userId, codes.map(hashBackupCode));
    return codes;
  }

  private async finishLogin(
    user: UserRow,
    ctx: RequestContext,
    opts: { trustDevice: boolean; viaTrustedDevice: boolean }
  ): Promise<Extract<LoginStep, { step: 'done' }>> {
    const issuedAt = this.now();
    const session = createSessionToken();
    const expiresAt = addDays(issuedAt, this.sessionTtlDays);
    await this.sessionRepository.create({
      userId: user.id,
      tokenHash: session.tokenHash,
      expiresAt,
      userAgent: truncate(ctx.userAgent, 255),
      ip: truncate(ctx.ip, 64)
    });

    let device: IssuedToken | undefined;
    if (opts.trustDevice) {
      const raw = createOpaqueToken();
      const deviceExpiry = addDays(issuedAt, TRUSTED_DEVICE_DAYS);
      await this.deviceRepository.createTrustedDevice({
        userId: user.id,
        tokenHash: raw.tokenHash,
        userAgent: truncate(ctx.userAgent, 255),
        ip: truncate(ctx.ip, 64),
        expiresAt: deviceExpiry
      });
      device = { token: raw.token, expiresAt: deviceExpiry };
    }

    if (!opts.viaTrustedDevice) {
      void this.alert(`🔐 Đăng nhập từ thiết bị mới${opts.trustDevice ? ' (đã tin cậy 30 ngày)' : ''}.${this.where(ctx)}`);
    }

    return { step: 'done', user: this.toAuthUser(user), session: { token: session.token, expiresAt }, device };
  }

  private async findTrustedDevice(userId: string, deviceToken: string | null) {
    if (!deviceToken) return null;
    const device = await this.deviceRepository.findTrustedDevice(hashSessionToken(deviceToken));
    if (!device || device.userId !== userId || device.expiresAt.getTime() <= this.now().getTime()) return null;
    return device;
  }

  private async assertNewPassword(user: UserRow, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > 128) {
      throw new BadRequestException(`Mật khẩu mới phải dài ${MIN_PASSWORD_LENGTH}–128 ký tự`);
    }
    if (TEMP_PASSWORDS.has(newPassword.toLowerCase()) || (await verifyPassword(newPassword, user.passwordHash))) {
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu cũ');
    }
  }

  private assertNotLocked(ip: string | null, email: string | null): void {
    const nowMs = this.now().getTime();
    const waitMs = Math.max(
      ip ? this.limiter.lockedFor(`ip:${ip}`, nowMs) : 0,
      email ? this.limiter.lockedFor(`email:${email}`, nowMs) : 0
    );
    if (waitMs > 0) {
      const minutes = Math.ceil(waitMs / 60_000);
      throw new HttpException(`Thử sai quá nhiều lần — thử lại sau ${minutes} phút`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFailure(ctx: RequestContext, email: string, what: string): void {
    const nowMs = this.now().getTime();
    const ipLocked = ctx.ip ? this.limiter.fail(`ip:${ctx.ip}`, nowMs) : false;
    const emailLocked = this.limiter.fail(`email:${email}`, nowMs);
    if (ipLocked || emailLocked) {
      void this.alert(`🚨 Sai ${what} ${MAX_LOGIN_FAILURES} lần — đã khoá đăng nhập 15 phút (${email}).${this.where(ctx)}`);
    }
  }

  private clearFailures(ctx: RequestContext, email: string): void {
    if (ctx.ip) this.limiter.reset(`ip:${ctx.ip}`);
    this.limiter.reset(`email:${email}`);
  }

  private async requireUser(userId: string): Promise<UserRow> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UnauthorizedException('Authentication required');
    return user;
  }

  private where(ctx: RequestContext): string {
    return `\nIP: ${ctx.ip ?? '?'}\nThiết bị: ${truncate(ctx.userAgent, 160) ?? '?'}`;
  }

  private async alert(text: string): Promise<void> {
    if (!this.telegram) return;
    try {
      await this.telegram.sendMessage(`[Market Analysis] ${text}`);
    } catch (error) {
      this.logger.warn(`Auth alert failed: ${String(error)}`);
    }
  }

  private toAuthUser(user: {
    id: string;
    email: string;
    name: string;
    symbolsTracking?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
  }): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      symbolsTracking: Array.isArray(user.symbolsTracking) ? (user.symbolsTracking as string[]) : [],
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function truncate(value: string | null, max: number): string | null {
  return value ? value.slice(0, max) : null;
}
