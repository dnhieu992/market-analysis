import { Body, Controller, Get, Inject, Patch, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserService } from './user.service';

@ApiTags('User')
@ApiCookieAuth('market_analysis_session')
@Controller('user')
export class UserController {
  constructor(
    @Inject(UserService)
    private readonly userService: UserService
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  getProfile(@Req() request: AuthenticatedRequest) {
    return this.userService.getProfile(request.authUser!.id);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update current user profile' })
  updateProfile(@Req() request: AuthenticatedRequest, @Body() body: UpdateProfileDto) {
    return this.userService.updateProfile(request.authUser!.id, body);
  }
}
