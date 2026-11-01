import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AUTH_OPTIONS } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [DatabaseModule, TelegramModule],
  providers: [
    {
      provide: AUTH_OPTIONS,
      useValue: {}
    },
    AuthService,
    AuthGuard
  ],
  controllers: [AuthController],
  exports: [AuthService]
})
export class AuthModule {}
