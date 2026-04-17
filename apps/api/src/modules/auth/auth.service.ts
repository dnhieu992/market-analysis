import { ConflictException, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { createSessionRepository, createUserRepository } from '@app/db';

import { SESSION_REPOSITORY, USER_REPOSITORY } from '../database/database.providers';
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from './auth.crypto';
import { AUTH_COOKIE_NAME, AUTH_OPTIONS, SESSION_TTL_DAYS } from './auth.constants';
import type { AuthUser } from './auth.types';

type UserRepository = ReturnType<typeof createUserRepository>;
type SessionRepository = ReturnType<typeof createSessionRepository>;

type AuthServiceOptions = {
  cookieName?: string;
  sessionTtlDays?: number;
  now?: () => Date;
};

@Injectable()
export class AuthService {
  private readonly cookieName: string;
  private readonly sessionTtlDays: number;
  private readonly now: () => Date;

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    @Inject(SESSION_REPOSITORY)
    private readonly sessionRepository: SessionRepository,
    @Optional()
    @Inject(AUTH_OPTIONS)
    options: AuthServiceOptions = {}
  ) {
    this.cookieName = options.cookieName ?? process.env.SESSION_COOKIE_NAME ?? AUTH_COOKIE_NAME;
    this.sessionTtlDays = options.sessionTtlDays ?? Number(process.env.SESSION_TTL_DAYS ?? SESSION_TTL_DAYS);
    this.now = options.now ?? (() => new Date());
  }

  async register(input: { email: string; password: string; name: string }): Promise<AuthUser> {
    const email = input.email.trim().toLowerCase();
    const existingUser = await this.userRepository.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const user = await this.userRepository.create({
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password)
    });

    return this.toAuthUser(user);
  }

  async login(input: { email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const user = await this.userRepository.findByEmail(email);

    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const issuedAt = this.now();
    const expiresAt = addDays(issuedAt, this.sessionTtlDays);
    const session = createSessionToken();

    await this.sessionRepository.create({
      userId: user.id,
      tokenHash: session.tokenHash,
      expiresAt
    });

    return {
      sessionToken: session.token,
      cookieName: this.cookieName,
      expiresAt,
      user: this.toAuthUser(user)
    };
  }

  async getAuthenticatedUser(sessionToken: string): Promise<AuthUser> {
    if (!sessionToken) {
      throw new UnauthorizedException('Authentication required');
    }

    const session = await this.sessionRepository.findValidByTokenHash(hashSessionToken(sessionToken));

    if (!session || !session.user || session.expiresAt.getTime() <= this.now().getTime()) {
      throw new UnauthorizedException('Authentication required');
    }

    await this.sessionRepository.touch(session.id, this.now());

    return this.toAuthUser(session.user);
  }

  async logout(sessionToken: string | null | undefined): Promise<void> {
    if (!sessionToken) {
      return;
    }

    await this.sessionRepository.deleteByTokenHash(hashSessionToken(sessionToken));
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
