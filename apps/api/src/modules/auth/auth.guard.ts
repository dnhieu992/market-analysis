import { CanActivate, ExecutionContext, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AUTH_OPTIONS, PUBLIC_ROUTE_KEY } from './auth.constants';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';

type AuthGuardOptions = {
  cookieName?: string;
};

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cookieName: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    @Optional()
    @Inject(AUTH_OPTIONS)
    options: AuthGuardOptions = {}
  ) {
    this.cookieName = options.cookieName ?? process.env.SESSION_COOKIE_NAME ?? 'market_analysis_session';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionToken = readCookie(request.headers?.cookie, this.cookieName);

    if (!sessionToken) {
      throw new UnauthorizedException('Authentication required');
    }

    request.authUser = await this.authService.getAuthenticatedUser(sessionToken);

    return true;
  }
}

function readCookie(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(';')) {
    const [name, ...valueParts] = segment.trim().split('=');
    if (name === cookieName) {
      return valueParts.join('=');
    }
  }

  return null;
}
