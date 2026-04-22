import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { CompoundPortfolioService } from './compound-portfolio.service';
import { CreateCompoundPortfolioDto } from './dto/create-compound-portfolio.dto';
import { UpdateCompoundPortfolioDto } from './dto/update-compound-portfolio.dto';

@ApiTags('Compound Interest')
@ApiCookieAuth('market_analysis_session')
@Controller('compound-portfolios')
export class CompoundPortfolioController {
  constructor(
    @Inject(CompoundPortfolioService)
    private readonly service: CompoundPortfolioService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all compound portfolios for the authenticated user' })
  list(@Req() req: AuthenticatedRequest) {
    return this.service.listPortfolios(req.authUser!.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new compound portfolio' })
  create(@Req() req: AuthenticatedRequest, @Body() body: CreateCompoundPortfolioDto) {
    return this.service.createPortfolio(req.authUser!.id, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a compound portfolio by ID' })
  getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.getPortfolio(id, req.authUser!.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a compound portfolio' })
  update(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Body() body: UpdateCompoundPortfolioDto) {
    return this.service.updatePortfolio(id, req.authUser!.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a compound portfolio' })
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.removePortfolio(id, req.authUser!.id);
  }
}
