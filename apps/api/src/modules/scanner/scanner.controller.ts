import { Body, Controller, Get, Inject, Post, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { UpdateScannerWatchlistDto } from './dto/update-scanner-watchlist.dto';
import { ScannerService } from './scanner.service';
import type { ScanResult } from './scanner.service';

@ApiTags('Scanner')
@ApiCookieAuth('market_analysis_session')
@Controller('scanner')
export class ScannerController {
  constructor(
    @Inject(ScannerService)
    private readonly scannerService: ScannerService
  ) {}

  @Get('watchlist')
  @ApiOperation({ summary: 'Get UT Bot scanner watchlist' })
  getWatchlist(): Promise<string[]> {
    return this.scannerService.getWatchlist();
  }

  @Put('watchlist')
  @ApiOperation({ summary: 'Update UT Bot scanner watchlist' })
  updateWatchlist(@Body() body: UpdateScannerWatchlistDto): Promise<string[]> {
    return this.scannerService.updateWatchlist(body.symbols);
  }

  @Post('scan')
  @ApiOperation({ summary: 'Scan watchlist coins with UT Bot indicator on 1D' })
  async scan(@Body() body: UpdateScannerWatchlistDto): Promise<ScanResult[]> {
    return this.scannerService.scan(body.symbols);
  }
}
