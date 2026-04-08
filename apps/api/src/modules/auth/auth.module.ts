import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AUTH_OPTIONS } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [DatabaseModule],
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
