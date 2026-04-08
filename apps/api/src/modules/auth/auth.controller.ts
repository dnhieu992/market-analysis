import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';

import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { AuthenticatedRequest } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService
  ) {}

  @Post('register')
  @Public()
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('login')
  @Public()
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }) {
    const result = await this.authService.login(body);
    response.setHeader('Set-Cookie', buildSessionCookie(result.cookieName, result.sessionToken, result.expiresAt));

    return {
      user: result.user
    };
  }

  @Post('logout')
  @Public()
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }
  ) {
    const cookieName = process.env.SESSION_COOKIE_NAME ?? 'market_analysis_session';
    const sessionToken = readCookie(request.headers?.cookie, cookieName);
    await this.authService.logout(sessionToken);
    response.setHeader('Set-Cookie', clearSessionCookie(cookieName));

    return {
      success: true
    };
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return request.authUser ?? null;
  }
}

function buildSessionCookie(name: string, value: string, expiresAt: Date): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function clearSessionCookie(name: string): string {
  const parts = [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
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
