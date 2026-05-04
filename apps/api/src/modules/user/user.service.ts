import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createUserRepository } from '@app/db';

import { USER_REPOSITORY } from '../database/database.providers';
import type { UpdateProfileDto } from './dto/update-profile.dto';

type UserRepository = ReturnType<typeof createUserRepository>;

@Injectable()
export class UserService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository
  ) {}

  async getProfile(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      symbolsTracking: Array.isArray(user.symbolsTracking) ? (user.symbolsTracking as string[]) : [],
      dailySignalWatchlist: Array.isArray(user.dailySignalWatchlist) ? (user.dailySignalWatchlist as string[]) : [],
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = dto.name.trim();
    if (dto.symbolsTracking !== undefined) data['symbolsTracking'] = dto.symbolsTracking;
    if (dto.dailySignalWatchlist !== undefined) data['dailySignalWatchlist'] = dto.dailySignalWatchlist;

    if (Object.keys(data).length > 0) {
      await this.userRepository.updateProfile(userId, data);
    }

    return this.getProfile(userId);
  }
}
