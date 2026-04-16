import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { PortfolioService } from './portfolio.service';
import { CreatePortfolioDto } from './dto/create-portfolio.dto';
import { UpdatePortfolioDto } from './dto/update-portfolio.dto';

@ApiTags('Portfolio')
@ApiCookieAuth('market_analysis_session')
@Controller('portfolios')
export class PortfolioController {
  constructor(
    @Inject(PortfolioService)
    private readonly portfolioService: PortfolioService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all portfolios for the authenticated user' })
  listPortfolios(@Req() req: AuthenticatedRequest) {
    return this.portfolioService.listPortfolios(req.authUser!.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new portfolio' })
  createPortfolio(@Req() req: AuthenticatedRequest, @Body() body: CreatePortfolioDto) {
    return this.portfolioService.createPortfolio(req.authUser!.id, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a portfolio by ID' })
  getPortfolio(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.portfolioService.getPortfolio(id, req.authUser!.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a portfolio' })
  updatePortfolio(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Body() body: UpdatePortfolioDto) {
    return this.portfolioService.updatePortfolio(id, req.authUser!.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a portfolio' })
  removePortfolio(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.portfolioService.removePortfolio(id, req.authUser!.id);
  }
}
