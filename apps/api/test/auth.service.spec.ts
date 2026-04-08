import { ConflictException, UnauthorizedException } from '@nestjs/common';

import { hashPassword } from '../src/modules/auth/auth.crypto';
import { AuthService } from '../src/modules/auth/auth.service';

describe('AuthService', () => {
  const now = new Date('2026-04-08T00:00:00.000Z');
  let userRepository: {
    create: jest.Mock;
    findByEmail: jest.Mock;
    findById: jest.Mock;
  };
  let sessionRepository: {
    create: jest.Mock;
    findValidByTokenHash: jest.Mock;
    deleteByTokenHash: jest.Mock;
    touch: jest.Mock;
  };
  let service: AuthService;

  beforeEach(() => {
    userRepository = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn()
    };
    sessionRepository = {
      create: jest.fn(),
      findValidByTokenHash: jest.fn(),
      deleteByTokenHash: jest.fn(),
      touch: jest.fn()
    };

    service = new AuthService(userRepository as never, sessionRepository as never, {
      cookieName: 'market_analysis_session',
      sessionTtlDays: 7,
      now: () => now
    });
  });

  it('registers a user with a hashed password', async () => {
    userRepository.findByEmail.mockResolvedValue(null);
    userRepository.create.mockImplementation(async (data: Record<string, unknown>) => ({
      id: 'user-1',
      email: data.email,
      name: data.name,
      passwordHash: data.passwordHash,
      createdAt: now,
      updatedAt: now
    }));

    const result = await service.register({
      email: 'alice@example.com',
      password: 'S3curePassword!',
      name: 'Alice'
    });

    expect(result).toMatchObject({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice'
    });
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'alice@example.com',
        name: 'Alice',
        passwordHash: expect.any(String)
      })
    );
    expect(userRepository.create.mock.calls[0]?.[0].passwordHash).not.toBe('S3curePassword!');
  });

  it('rejects duplicate emails during registration', async () => {
    userRepository.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com'
    });

    await expect(
      service.register({
        email: 'alice@example.com',
        password: 'S3curePassword!',
        name: 'Alice'
      })
    ).rejects.toThrow(ConflictException);
  });

  it('creates a session for valid credentials', async () => {
    userRepository.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice',
      passwordHash: await hashPassword('S3curePassword!'),
      createdAt: now,
      updatedAt: now
    });
    sessionRepository.create.mockImplementation(async (data: Record<string, unknown>) => ({
      id: 'session-1',
      ...data,
      createdAt: now,
      lastUsedAt: now
    }));

    const result = await service.login({
      email: 'alice@example.com',
      password: 'S3curePassword!'
    });

    expect(result.user).toMatchObject({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice'
    });
    expect(result.sessionToken).toEqual(expect.any(String));
    expect(sessionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tokenHash: expect.any(String),
        expiresAt: new Date('2026-04-15T00:00:00.000Z')
      })
    );
  });

  it('rejects invalid credentials', async () => {
    userRepository.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice',
      passwordHash: await hashPassword('S3curePassword!'),
      createdAt: now,
      updatedAt: now
    });

    await expect(
      service.login({
        email: 'alice@example.com',
        password: 'wrong-password'
      })
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns the current user from a valid session token', async () => {
    sessionRepository.findValidByTokenHash.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      expiresAt: new Date('2026-04-15T00:00:00.000Z'),
      user: {
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        passwordHash: 'hidden',
        createdAt: now,
        updatedAt: now
      }
    });

    const result = await service.getAuthenticatedUser('raw-session-token');

    expect(result).toMatchObject({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice'
    });
    expect(sessionRepository.touch).toHaveBeenCalledWith('session-1', now);
  });

  it('deletes the active session on logout', async () => {
    await service.logout('raw-session-token');

    expect(sessionRepository.deleteByTokenHash).toHaveBeenCalledWith(expect.any(String));
  });
});
