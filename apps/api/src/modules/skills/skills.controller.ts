import { Controller, Get, Param } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SkillsService } from './skills.service';

@ApiTags('Skills')
@ApiCookieAuth('market_analysis_session')
@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  @ApiOperation({ summary: 'List all available skills' })
  getAll() {
    return this.skillsService.getAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a skill by id' })
  getById(@Param('id') id: string) {
    return this.skillsService.getById(id);
  }
}
