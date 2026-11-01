import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { toDataURL } from 'qrcode';

import { DEVICE_COOKIE_NAME } from './auth.constants';
import { buildCookie, clearCookie, readCookie, requestContext } from './auth.http';
import { AuthService, type LoginStep } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { LoginChallengeDto, LoginCodeDto, LoginDto, LoginNewPasswordDto } from './dto/login.dto';
import { ChangePasswordDto, TotpCodeDto } from './dto/security.dto';
import { Public } from './public.decorator';

type CookieResponse = { setHeader(name: string, value: string | string[]): void };

/**
 * Login is a small state machine: password → (forced new password) →
 * (TOTP enrollment | TOTP/backup code) → session. Every step but the last
 * answers `{ step, challenge }`; the last sets the cookies and answers
 * `{ step: 'done', user }`. Sign-up is not exposed — accounts come from the
 * auth CLI on the server.
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService
  ) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Step 1: email + password' })
  async login(@Body() body: LoginDto, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: CookieResponse) {
    return this.respond(await this.authService.login(body, this.ctx(request)), response);
  }

  @Post('login/password')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Replace a temporary password (forced on first login)' })
  async loginNewPassword(
    @Body() body: LoginNewPasswordDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: CookieResponse
  ) {
    return this.respond(await this.authService.completePasswordChange(body.challenge, body.newPassword, this.ctx(request)), response);
  }

  @Post('login/totp-setup')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Get the QR code / secret for the authenticator app' })
  async loginTotpSetup(@Body() body: LoginChallengeDto, @Req() request: AuthenticatedRequest) {
    const setup = await this.authService.startTotpSetup(body.challenge, this.ctx(request));
    return { ...setup, qrDataUrl: await toDataURL(setup.otpauthUrl, { margin: 1, width: 220 }) };
  }

  @Post('login/totp-enable')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the first code, turn 2FA on, sign in' })
  async loginTotpEnable(@Body() body: LoginCodeDto, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: CookieResponse) {
    return this.respond(
      await this.authService.confirmTotpSetup(body.challenge, body.code, body.trustDevice === true, this.ctx(request)),
      response
    );
  }

  @Post('login/totp')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Step 2: TOTP or backup code, sign in' })
  async loginTotp(@Body() body: LoginCodeDto, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: CookieResponse) {
    return this.respond(
      await this.authService.verifySecondFactor(body.challenge, body.code, body.trustDevice === true, this.ctx(request)),
      response
    );
  }

  @Post('logout')
  @Public()
  @ApiOperation({ summary: 'Logout and clear session cookie' })
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: CookieResponse) {
    const cookieName = this.authService.sessionCookieName;
    await this.authService.logout(readCookie(request.headers?.cookie, cookieName));
    response.setHeader('Set-Cookie', clearCookie(cookieName));
    return { success: true };
  }

  @Get('me')
  @ApiCookieAuth('market_analysis_session')
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  me(@Req() request: AuthenticatedRequest) {
    return request.authUser ?? null;
  }

  @Get('security')
  @ApiCookieAuth('market_analysis_session')
  @ApiOperation({ summary: '2FA status, backup codes left, last password change' })
  security(@Req() request: AuthenticatedRequest) {
    return this.authService.getSecurity(request.authUser!.id);
  }

  @Post('password')
  @HttpCode(200)
  @ApiCookieAuth('market_analysis_session')
  @ApiOperation({ summary: 'Change password (current password + 2FA code); logs out other sessions' })
  async changePassword(@Body() body: ChangePasswordDto, @Req() request: AuthenticatedRequest) {
    await this.authService.changePassword(request.authUser!.id, request.authSessionId!, body, this.ctx(request));
    return { success: true };
  }

  @Post('backup-codes')
  @HttpCode(200)
  @ApiCookieAuth('market_analysis_session')
  @ApiOperation({ summary: 'Replace the backup codes (needs a TOTP code)' })
  async regenerateBackupCodes(@Body() body: TotpCodeDto, @Req() request: AuthenticatedRequest) {
    return { backupCodes: await this.authService.regenerateBackupCodes(request.authUser!.id, body.code, this.ctx(request)) };
  }

  @Get('sessions')
  @ApiCookieAuth('market_analysis_session')
  @ApiOperation({ summary: 'Active sessions of the current user' })
  sessions(@Req() request: AuthenticatedRequest) {
    return this.authService.listSessions(request.authUser!.id, request.authSessionId ?? null);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  @ApiCookieAuth('market_analysis_session')
  @ApiOperation({ summary: 'Log out every other session and forget other trusted devices' })
  revokeOthers(@Req() request: AuthenticatedRequest) {
    return this.authService.revokeOtherSessions(request.authUser!.id, request.authSessionId!, this.ctx(request));
  }

  @Delete('sessions/:id')
  @ApiCookieAuth('market_analysis_session')
  @ApiOperation({ summary: 'Log out one session' })
  async revokeSession(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.authService.revokeSession(request.authUser!.id, id);
    return { success: true };
  }

  @Get('devices')
  @ApiCookieAuth('market_analysis_session')
  @ApiOperation({ summary: 'Trusted devices (skip 2FA for 30 days)' })
  devices(@Req() request: AuthenticatedRequest) {
    return this.authService.listTrustedDevices(request.authUser!.id, this.ctx(request));
  }

  @Delete('devices/:id')
  @ApiCookieAuth('market_analysis_session')
  @ApiOperation({ summary: 'Stop trusting one device' })
  async revokeDevice(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.authService.revokeTrustedDevice(request.authUser!.id, id);
    return { success: true };
  }

  private ctx(request: AuthenticatedRequest) {
    return requestContext(request, DEVICE_COOKIE_NAME);
  }

  /** Final step sets the session (+ trusted-device) cookies; earlier steps pass the challenge on. */
  private respond(result: LoginStep, response: CookieResponse) {
    if (result.step !== 'done') return result;
    const cookies = [buildCookie(this.authService.sessionCookieName, result.session.token, result.session.expiresAt)];
    if (result.device) cookies.push(buildCookie(DEVICE_COOKIE_NAME, result.device.token, result.device.expiresAt));
    response.setHeader('Set-Cookie', cookies);
    return { step: 'done' as const, user: result.user, backupCodes: result.backupCodes };
  }
}
