import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthGuard } from '../src/modules/auth/auth.guard';

describe('AuthGuard', () => {
  let reflector: Reflector;
  let authService: {
    getAuthenticatedUser: jest.Mock;
  };
  let guard: AuthGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn()
    } as unknown as Reflector;
    authService = {
      getAuthenticatedUser: jest.fn()
    };
    guard = new AuthGuard(reflector, authService as never, {
      cookieName: 'market_analysis_session'
    });
  });

  it('allows public routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
  });

  it('rejects protected routes without a valid session cookie', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    await expect(guard.canActivate(createContext())).rejects.toThrow(UnauthorizedException);
  });

  it('attaches the authenticated user for protected routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    authService.getAuthenticatedUser.mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice'
    });
    const request = {
      headers: {
        cookie: 'market_analysis_session=raw-token'
      }
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(authService.getAuthenticatedUser).toHaveBeenCalledWith('raw-token');
    expect((request as Record<string, unknown>).authUser).toEqual({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice'
    });
  });
});

function createContext(
  request: Record<string, unknown> = {}
): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => class TestClass {},
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as unknown as ExecutionContext;
}
